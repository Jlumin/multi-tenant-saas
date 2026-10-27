import { createHash, createHmac, randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import type { PrismaClient } from "../../generated/prisma/client";
import { lockTenant, recordTenantEvent, requireTenantContext, TenantError, type Actor } from "../tenancy/service";

type CheckoutInput = { buyerName: string; buyerEmail: string; lines: Array<{ productId: string; quantity: number }> };
const orderSelect = {
  id: true, tenantId: true, storeId: true, orderNumber: true, status: true, currency: true,
  buyerName: true, buyerEmail: true, totalAmount: true, createdAt: true,
  lines: { select: { id: true, productId: true, productCode: true, productName: true, quantity: true, unitPrice: true, lineTotal: true }, orderBy: { id: "asc" as const } },
} as const;
function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new TenantError(503, "service_unavailable");
  return value;
}
function keyedDigest(value: string) { return createHmac("sha256", secret()).update(value).digest("hex"); }
function canonical(input: CheckoutInput) {
  return JSON.stringify({ buyerName: input.buyerName, buyerEmail: input.buyerEmail, lines: [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId)) });
}
function orderNumber() { return `ECOM-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`; }
function publicOrder(order: { orderNumber: string; status: string; currency: string; totalAmount: Prisma.Decimal; lines: Array<{ productCode: string; productName: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }> }, replayed: boolean) {
  return {
    orderNumber: order.orderNumber, status: order.status, currency: order.currency, totalAmount: order.totalAmount.toFixed(2), replayed,
    lines: order.lines.map(line => ({ productCode: line.productCode, productName: line.productName, quantity: line.quantity, unitPrice: line.unitPrice.toFixed(2), lineTotal: line.lineTotal.toFixed(2) })),
  };
}

export function createEcommerceOrders(db: PrismaClient) {
  return {
    async checkout(slug: string, key: string, input: CheckoutInput, requestId?: string) {
      const storeBySlug = await db.ecomStore.findUnique({ where: { slug }, select: { id: true, tenantId: true, isActive: true } });
      if (!storeBySlug) throw new TenantError(404, "not_found");
      const idempotencyKeyHash = createHash("sha256").update(key).digest("hex");
      const payloadHash = keyedDigest(canonical(input));
      return db.$transaction(async tx => {
        await lockTenant(tx, storeBySlug.tenantId);
        const store = await tx.ecomStore.findUnique({ where: { id: storeBySlug.id }, select: { id: true, tenantId: true, currency: true, isActive: true } });
        if (!store) throw new TenantError(404, "not_found");
        const prior = await tx.ecomOrder.findUnique({ where: { tenantId_storeId_idempotencyKeyHash: { tenantId: store.tenantId, storeId: store.id, idempotencyKeyHash } }, select: { ...orderSelect, payloadHash: true } });
        if (prior) {
          if (prior.payloadHash !== payloadHash) throw new TenantError(409, "idempotency_conflict");
          return publicOrder(prior, true);
        }
        if (!store.isActive) throw new TenantError(404, "not_found");
        const ids = input.lines.map(line => line.productId);
        const products = await tx.ecomProduct.findMany({ where: { tenantId: store.tenantId, storeId: store.id, id: { in: ids }, isPublished: true }, select: { id: true, code: true, name: true, price: true } });
        if (products.length !== ids.length) throw new TenantError(409, "products_unavailable");
        const byId = new Map(products.map(product => [product.id, product]));
        let total = new Prisma.Decimal(0);
        const lines = input.lines.map(line => {
          const product = byId.get(line.productId)!;
          const unitPrice = new Prisma.Decimal(product.price);
          const lineTotal = unitPrice.mul(line.quantity);
          total = total.add(lineTotal);
          return { tenantId: store.tenantId, storeId: store.id, productId: product.id, productCode: product.code, productName: product.name, quantity: line.quantity, unitPrice, lineTotal };
        });
        if (total.greaterThan("9999999999.99")) throw new TenantError(400, "order_total_too_large");
        const created = await tx.ecomOrder.create({ data: { tenantId: store.tenantId, storeId: store.id, orderNumber: orderNumber(), status: "submitted", currency: store.currency, buyerName: input.buyerName, buyerEmail: input.buyerEmail, totalAmount: total, idempotencyKeyHash, payloadHash }, select: { id: true } });
        await tx.ecomOrderLine.createMany({ data: lines.map(line => ({ ...line, orderId: created.id })) });
        const order = await tx.ecomOrder.findUniqueOrThrow({ where: { id: created.id }, select: orderSelect });
        await recordTenantEvent(tx, store.tenantId, null, "ecommerce.order.submitted", order.id, requestId);
        return publicOrder(order, false);
      }, { isolationLevel: "ReadCommitted" });
    },
    async list(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId, true);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true } });
        if (!store) throw new TenantError(404, "not_found");
        const where = { tenantId, storeId: store.id };
        const [items, total] = await Promise.all([
          tx.ecomOrder.findMany({ where, select: orderSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
          tx.ecomOrder.count({ where }),
        ]);
        return { items: items.map(item => ({ ...item, totalAmount: item.totalAmount.toFixed(2), lines: item.lines.map(line => ({ ...line, unitPrice: line.unitPrice.toFixed(2), lineTotal: line.lineTotal.toFixed(2) })) })), total, limit, offset };
      });
    },
    async detail(actor: Actor, tenantId: string, id: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId, true);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true } });
        if (!store) throw new TenantError(404, "not_found");
        const order = await tx.ecomOrder.findFirst({ where: { tenantId, storeId: store.id, id }, select: orderSelect });
        if (!order) throw new TenantError(404, "not_found");
        return { ...order, totalAmount: order.totalAmount.toFixed(2), lines: order.lines.map(line => ({ ...line, unitPrice: line.unitPrice.toFixed(2), lineTotal: line.lineTotal.toFixed(2) })) };
      });
    },
  };
}

export function validateCheckout(value: unknown): CheckoutInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TenantError(400, "invalid_payload");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !["buyerName", "buyerEmail", "lines"].includes(key))) throw new TenantError(400, "invalid_payload");
  if (typeof data.buyerName !== "string" || typeof data.buyerEmail !== "string" || !Array.isArray(data.lines) || data.lines.length < 1 || data.lines.length > 20) throw new TenantError(400, "invalid_payload");
  const buyerName = data.buyerName.trim(), buyerEmail = data.buyerEmail.trim().toLowerCase();
  if (!buyerName || buyerName.length > 120 || /[<>\r\n]/.test(buyerName) || buyerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new TenantError(400, "invalid_buyer");
  const lines = data.lines.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TenantError(400, "invalid_line");
    const line = entry as Record<string, unknown>;
    if (Object.keys(line).some(key => !["productId", "quantity"].includes(key)) || typeof line.productId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(line.productId) || !Number.isInteger(line.quantity) || (line.quantity as number) < 1 || (line.quantity as number) > 99) throw new TenantError(400, "invalid_line");
    return { productId: line.productId, quantity: line.quantity as number };
  });
  if (new Set(lines.map(line => line.productId)).size !== lines.length) throw new TenantError(400, "duplicate_product");
  return { buyerName, buyerEmail, lines };
}
