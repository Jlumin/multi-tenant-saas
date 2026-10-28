import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { deliverMail } from "../platform";
import { lockTenant, recordTenantEvent, TenantError } from "../tenancy/service";
import { getWmsAvailableQuantity } from "../wms/ecommerce-contract";

type Mail = (message: { to: string; subject: string; text: string }) => Promise<void>;
function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new TenantError(503, "service_unavailable");
  return value;
}
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const emailHash = (email: string) => createHmac("sha256", secret()).update(email).digest("hex");

export function createRestockNotifications(db: PrismaClient, mail: Mail = deliverMail) {
  return {
    async subscribe(slug: string, productId: string, rawEmail: string, optIn: boolean, requestId?: string) {
      const email = rawEmail.trim().toLowerCase();
      if (optIn !== true) throw new TenantError(400, "explicit_opt_in_required");
      if (email.length > 254 || /[<>()",;\\]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TenantError(400, "invalid_email");
      const token = randomBytes(32).toString("base64url");
      return db.$transaction(async tx => {
        const store = await tx.ecomStore.findFirst({ where: { slug, isActive: true }, select: { id: true, tenantId: true, warehouseId: true } });
        if (!store || !store.warehouseId) throw new TenantError(404, "not_found");
        await lockTenant(tx, store.tenantId);
        const product = await tx.ecomProduct.findFirst({ where: { tenantId: store.tenantId, storeId: store.id, id: productId, isPublished: true, wmsProductId: { not: null } }, select: { wmsProductId: true } });
        if (!product?.wmsProductId) throw new TenantError(404, "not_found");
        const available = await getWmsAvailableQuantity(tx, store.tenantId, store.warehouseId, product.wmsProductId);
        if (available > 0) throw new TenantError(409, "already_in_stock");
        const hash = emailHash(email);
        const subscription = await tx.ecomRestockSubscription.upsert({
          where: { tenantId_storeId_productId_emailHash: { tenantId: store.tenantId, storeId: store.id, productId, emailHash: hash } },
          create: { tenantId: store.tenantId, storeId: store.id, productId, email, emailHash: hash, unsubscribeTokenHash: tokenHash(token) },
          update: { email, unsubscribeTokenHash: tokenHash(token), status: "active", notificationAttempts: 0, notifiedAt: null },
          select: { id: true },
        });
        await recordTenantEvent(tx, store.tenantId, null, "ecommerce.restock_subscription.created", subscription.id, requestId);
        return { registered: true };
      });
    },
    async unsubscribe(slug: string, token: string, requestId?: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TenantError(400, "invalid_unsubscribe_token");
      const store = await db.ecomStore.findFirst({ where: { slug }, select: { id: true, tenantId: true } });
      if (!store) throw new TenantError(404, "not_found");
      return db.$transaction(async tx => {
        await lockTenant(tx, store.tenantId);
        const subscription = await tx.ecomRestockSubscription.findFirst({ where: { tenantId: store.tenantId, storeId: store.id, unsubscribeTokenHash: tokenHash(token) } });
        if (!subscription) throw new TenantError(404, "not_found");
        if (subscription.status !== "unsubscribed") await tx.ecomRestockSubscription.update({ where: { id: subscription.id }, data: { status: "unsubscribed" } });
        await recordTenantEvent(tx, store.tenantId, null, "ecommerce.restock_subscription.unsubscribed", subscription.id, requestId);
        return { unsubscribed: true };
      });
    },
    async notifyRestocked(tenantId: string, warehouseId: string, productIds: string[]) {
      const stores = await db.ecomStore.findMany({ where: { tenantId, warehouseId, isActive: true }, select: { id: true, slug: true, warehouseId: true } });
      for (const store of stores) {
        const products = await db.ecomProduct.findMany({ where: { tenantId, storeId: store.id, isPublished: true, wmsProductId: { in: productIds } }, select: { id: true, name: true, wmsProductId: true } });
        for (const product of products) {
          const subscriptions = await db.$transaction(async tx => {
            await lockTenant(tx, tenantId);
            if (!product.wmsProductId || await getWmsAvailableQuantity(tx, tenantId, warehouseId, product.wmsProductId) < 1) return [];
            await tx.ecomRestockSubscription.updateMany({ where: { tenantId, storeId: store.id, productId: product.id, status: "notifying", updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } }, data: { status: "active" } });
            const active = await tx.ecomRestockSubscription.findMany({ where: { tenantId, storeId: store.id, productId: product.id, status: "active" }, select: { id: true, email: true } });
            const claimed = [];
            for (const item of active) {
              const token = randomBytes(32).toString("base64url");
              const changed = await tx.ecomRestockSubscription.updateMany({ where: { id: item.id, status: "active" }, data: { status: "notifying", unsubscribeTokenHash: tokenHash(token) } });
              if (changed.count) claimed.push({ ...item, token });
            }
            return claimed;
          });
          for (const subscription of subscriptions) {
            const origin = process.env.BETTER_AUTH_URL;
            if (!origin) { await db.ecomRestockSubscription.updateMany({ where: { id: subscription.id, status: "notifying" }, data: { status: "active" } }); continue; }
            const unsubscribe = new URL(`/shop/${encodeURIComponent(store.slug)}/unsubscribe`, origin);
            unsubscribe.searchParams.set("token", subscription.token);
            try {
              await mail({ to: subscription.email, subject: `商品到貨通知：${product.name}`, text: `${product.name} 已到貨，目前可於線上商店下單。\n${new URL(`/shop/${encodeURIComponent(store.slug)}`, origin)}\n\n若不想再收到此商品通知，請開啟以下連結並確認退訂：\n${unsubscribe}` });
              await db.$transaction(async tx => {
                await tx.ecomRestockSubscription.updateMany({ where: { id: subscription.id, status: "notifying" }, data: { status: "notified", notifiedAt: new Date(), notificationAttempts: { increment: 1 } } });
                await recordTenantEvent(tx, tenantId, null, "ecommerce.restock_notification.sent", subscription.id);
              });
            } catch {
              await db.ecomRestockSubscription.updateMany({ where: { id: subscription.id, status: "notifying" }, data: { status: "active", notificationAttempts: { increment: 1 } } });
            }
          }
        }
      }
    },
  };
}
