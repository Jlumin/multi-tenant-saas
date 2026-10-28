import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { lockTenant, recordTenantEvent, requireTenantContext, TenantError, type Actor } from "../tenancy/service";

type Tx = Prisma.TransactionClient;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const versionOk = (value: number) => Number.isSafeInteger(value) && value > 0 && value < 2147483647;
const clean = (value: string, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const restaurantSelect = { id: true, tenantId: true, name: true, currency: true, isActive: true, version: true, createdAt: true, updatedAt: true } as const;
const categorySelect = { id: true, name: true, sortOrder: true, isActive: true, version: true } as const;
const itemSelect = { id: true, categoryId: true, code: true, name: true, description: true, price: true, isPublished: true, version: true } as const;
const tableSelect = { id: true, tableNumber: true, label: true, isActive: true, version: true, createdAt: true } as const;
const orderInclude = { lines: { orderBy: { id: "asc" as const } }, table: { select: { tableNumber: true, label: true } } };

async function owner(tx: Tx, actor: Actor, tenantId: string) { return requireTenantContext(tx, actor, tenantId, true); }
async function staff(tx: Tx, actor: Actor, tenantId: string) { return requireTenantContext(tx, actor, tenantId); }
async function restaurant(tx: Tx, tenantId: string) {
  const value = await tx.restaurant.findUnique({ where: { tenantId }, select: restaurantSelect });
  if (!value) throw new TenantError(404, "restaurant_not_found");
  return value;
}
function publicOrder(row: Prisma.RestaurantOrderGetPayload<{ include: typeof orderInclude }>) {
  return { id: row.id, orderNumber: row.orderNumber, status: row.status, currency: row.currency, totalAmount: row.totalAmount, createdAt: row.createdAt, table: row.table, lines: row.lines.map(line => ({ itemCode: line.itemCode, itemName: line.itemName, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal })) };
}

export function createRestaurant(db: PrismaClient, appURL: string) {
  return {
    async getSetup(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => { await staff(tx, actor, tenantId); const value = await tx.restaurant.findUnique({ where: { tenantId }, select: restaurantSelect }); return { restaurant: value }; });
    },
    async saveSetup(actor: Actor, tenantId: string, data: { name: string; currency?: string; isActive?: boolean; version?: number }, requestId?: string) {
      if (!clean(data.name, 120) || (data.currency !== undefined && !/^[A-Z]{3}$/.test(data.currency)) || (data.isActive !== undefined && typeof data.isActive !== "boolean")) throw new TenantError(400, "invalid_restaurant");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await owner(tx, actor, tenantId);
        const current = await tx.restaurant.findUnique({ where: { tenantId } });
        if (!current) {
          const created = await tx.restaurant.create({ data: { tenantId, name: data.name.trim(), currency: data.currency ?? "TWD", isActive: data.isActive ?? false, createdById: actor.id }, select: restaurantSelect });
          await recordTenantEvent(tx, tenantId, actor.id, "restaurant.created", created.id, requestId); return created;
        }
        if (!versionOk(data.version ?? 0) || current.version !== data.version) throw new TenantError(409, "version_conflict");
        const updated = await tx.restaurant.update({ where: { tenantId }, data: { name: data.name.trim(), ...(data.currency ? { currency: data.currency } : {}), ...(data.isActive !== undefined ? { isActive: data.isActive } : {}), version: { increment: 1 } }, select: restaurantSelect });
        await recordTenantEvent(tx, tenantId, actor.id, "restaurant.updated", updated.id, requestId); return updated;
      });
    },
    async categories(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => { await staff(tx, actor, tenantId); const r = await restaurant(tx, tenantId); return tx.restaurantMenuCategory.findMany({ where: { tenantId, restaurantId: r.id }, select: categorySelect, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }); });
    },
    async saveCategory(actor: Actor, tenantId: string, id: string | null, data: { name: string; sortOrder?: number; isActive?: boolean; version?: number }, requestId?: string) {
      if (!clean(data.name, 80) || (data.sortOrder !== undefined && !Number.isSafeInteger(data.sortOrder)) || (data.isActive !== undefined && typeof data.isActive !== "boolean")) throw new TenantError(400, "invalid_category");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await owner(tx, actor, tenantId); const r = await restaurant(tx, tenantId);
        if (!id) { const created = await tx.restaurantMenuCategory.create({ data: { tenantId, restaurantId: r.id, name: data.name.trim(), sortOrder: data.sortOrder ?? 0, createdById: actor.id }, select: categorySelect }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.category.created", created.id, requestId); return created; }
        if (!versionOk(data.version ?? 0)) throw new TenantError(400, "invalid_version");
        const current = await tx.restaurantMenuCategory.findFirst({ where: { tenantId, restaurantId: r.id, id } }); if (!current) throw new TenantError(404, "not_found"); if (current.version !== data.version) throw new TenantError(409, "version_conflict");
        const updated = await tx.restaurantMenuCategory.update({ where: { id }, data: { name: data.name.trim(), sortOrder: data.sortOrder ?? current.sortOrder, isActive: data.isActive ?? current.isActive, version: { increment: 1 } }, select: categorySelect }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.category.updated", id, requestId); return updated;
      });
    },
    async items(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => { await staff(tx, actor, tenantId); const r = await restaurant(tx, tenantId); return tx.restaurantMenuItem.findMany({ where: { tenantId, restaurantId: r.id }, select: itemSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }); });
    },
    async saveItem(actor: Actor, tenantId: string, id: string | null, data: { categoryId: string; code: string; name: string; description?: string; price: string; isPublished?: boolean; version?: number }, requestId?: string) {
      if (!clean(data.categoryId, 36) || !clean(data.code, 40) || !clean(data.name, 120) || typeof data.description !== "string" || data.description.length > 1000 || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(data.price) || (data.isPublished !== undefined && typeof data.isPublished !== "boolean")) throw new TenantError(400, "invalid_item");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await owner(tx, actor, tenantId); const r = await restaurant(tx, tenantId);
        const category = await tx.restaurantMenuCategory.findFirst({ where: { tenantId, restaurantId: r.id, id: data.categoryId, isActive: true }, select: { id: true } }); if (!category) throw new TenantError(400, "invalid_category");
        if (!id) { const created = await tx.restaurantMenuItem.create({ data: { tenantId, restaurantId: r.id, categoryId: data.categoryId, code: data.code.trim(), name: data.name.trim(), description: data.description, price: new Prisma.Decimal(data.price), isPublished: data.isPublished ?? false, createdById: actor.id }, select: itemSelect }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.item.created", created.id, requestId); return created; }
        if (!versionOk(data.version ?? 0)) throw new TenantError(400, "invalid_version");
        const current = await tx.restaurantMenuItem.findFirst({ where: { tenantId, restaurantId: r.id, id } }); if (!current) throw new TenantError(404, "not_found"); if (current.version !== data.version) throw new TenantError(409, "version_conflict");
        const updated = await tx.restaurantMenuItem.update({ where: { id }, data: { categoryId: data.categoryId, code: data.code.trim(), name: data.name.trim(), description: data.description, price: new Prisma.Decimal(data.price), isPublished: data.isPublished ?? current.isPublished, version: { increment: 1 } }, select: itemSelect }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.item.updated", id, requestId); return updated;
      }).catch(error => { if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "item_code_exists"); throw error; });
    },
    async tables(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => { await staff(tx, actor, tenantId); const r = await restaurant(tx, tenantId); return tx.restaurantTable.findMany({ where: { tenantId, restaurantId: r.id }, select: tableSelect, orderBy: [{ tableNumber: "asc" }] }); });
    },
    async createTable(actor: Actor, tenantId: string, data: { tableNumber: string; label: string }, requestId?: string) {
      if (!clean(data.tableNumber, 40) || !clean(data.label, 80)) throw new TenantError(400, "invalid_table");
      const token = randomBytes(32).toString("base64url");
      return db.$transaction(async tx => { await lockTenant(tx, tenantId); await owner(tx, actor, tenantId); const r = await restaurant(tx, tenantId); const row = await tx.restaurantTable.create({ data: { tenantId, restaurantId: r.id, tableNumber: data.tableNumber.trim(), label: data.label.trim(), qrTokenHash: hash(token), createdById: actor.id }, select: tableSelect }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.table.created", row.id, requestId); return { ...row, qrUrl: `${appURL}/restaurant/order/${token}` }; }).catch(error => { if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "table_number_exists"); throw error; });
    },
    async rotateTableQr(actor: Actor, tenantId: string, tableId: string, requestId?: string) {
      const token = randomBytes(32).toString("base64url");
      return db.$transaction(async tx => { await lockTenant(tx, tenantId); await owner(tx, actor, tenantId); const r = await restaurant(tx, tenantId); const current = await tx.restaurantTable.findFirst({ where: { tenantId, restaurantId: r.id, id: tableId } }); if (!current) throw new TenantError(404, "not_found"); await tx.restaurantTable.update({ where: { id: tableId }, data: { qrTokenHash: hash(token), version: { increment: 1 } } }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.table.qr_rotated", tableId, requestId); return { tableId, qrUrl: `${appURL}/restaurant/order/${token}` }; });
    },
    async updateTable(actor: Actor, tenantId: string, tableId: string, data: { label: string; isActive: boolean; version: number }, requestId?: string) {
      if (!clean(data.label, 80) || typeof data.isActive !== "boolean" || !versionOk(data.version)) throw new TenantError(400, "invalid_table");
      return db.$transaction(async tx => { await lockTenant(tx, tenantId); await owner(tx, actor, tenantId); const r = await restaurant(tx, tenantId); const current = await tx.restaurantTable.findFirst({ where: { tenantId, restaurantId: r.id, id: tableId } }); if (!current) throw new TenantError(404, "not_found"); if (current.version !== data.version) throw new TenantError(409, "version_conflict"); const updated = await tx.restaurantTable.update({ where: { id: tableId }, data: { label: data.label.trim(), isActive: data.isActive, version: { increment: 1 } }, select: tableSelect }); await recordTenantEvent(tx, tenantId, actor.id, "restaurant.table.updated", tableId, requestId); return updated; });
    },
    async publicMenu(token: string) {
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new TenantError(404, "not_found");
      const table = await db.restaurantTable.findFirst({
        where: { qrTokenHash: hash(token), isActive: true, restaurant: { isActive: true } },
        select: {
          id: true, tableNumber: true, label: true,
          restaurant: { select: {
            name: true, currency: true,
            categories: {
              where: { isActive: true }, orderBy: [{ sortOrder: "asc" }],
              select: {
                id: true, name: true,
                items: { where: { isPublished: true }, orderBy: [{ name: "asc" }], select: { id: true, code: true, name: true, description: true, price: true } },
              },
            },
          } },
        },
      });
      if (!table) throw new TenantError(404, "not_found");
      return { table: { label: table.label }, restaurant: { name: table.restaurant.name, currency: table.restaurant.currency }, categories: table.restaurant.categories.map(c => ({ id: c.id, name: c.name, items: c.items })) };
    },
    async submitPublicOrder(token: string, key: string, lines: { itemId: string; quantity: number }[], requestId?: string) {
      if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw new TenantError(404, "not_found");
      if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) throw new TenantError(400, "invalid_idempotency_key");
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50 || lines.some(line => !clean(line.itemId, 36) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) || new Set(lines.map(x => x.itemId)).size !== lines.length) throw new TenantError(400, "invalid_order");
      const tokenHash = hash(token), idempotencyKeyHash = hash(key), payloadHash = hash(JSON.stringify([...lines].sort((a,b) => a.itemId.localeCompare(b.itemId))));
      try {
        return await db.$transaction(async tx => {
          const table = await tx.restaurantTable.findFirst({ where: { qrTokenHash: tokenHash, isActive: true, restaurant: { isActive: true } }, select: { id: true, tenantId: true, restaurantId: true, restaurant: { select: { currency: true } } } }); if (!table) throw new TenantError(404, "not_found");
          await lockTenant(tx, table.tenantId);
          const existing = await tx.restaurantOrder.findFirst({ where: { tenantId: table.tenantId, restaurantId: table.restaurantId, idempotencyKeyHash }, include: orderInclude });
          if (existing) { if (existing.tableId !== table.id || existing.payloadHash !== payloadHash) throw new TenantError(409, "idempotency_conflict"); return publicOrder(existing); }
          const itemIds = lines.map(x => x.itemId);
          const items = await tx.restaurantMenuItem.findMany({ where: { tenantId: table.tenantId, restaurantId: table.restaurantId, id: { in: itemIds }, isPublished: true, category: { isActive: true } }, select: { id: true, code: true, name: true, price: true } });
          if (items.length !== itemIds.length) throw new TenantError(409, "menu_changed");
          const byId = new Map(items.map(item => [item.id, item]));
          const orderLines = lines.map(line => { const item = byId.get(line.itemId)!; const lineTotal = item.price.mul(line.quantity); return { itemId: item.id, itemCode: item.code, itemName: item.name, quantity: line.quantity, unitPrice: item.price, lineTotal }; });
          const total = orderLines.reduce((sum, line) => sum.add(line.lineTotal), new Prisma.Decimal(0));
          const order = await tx.restaurantOrder.create({ data: { tenantId: table.tenantId, restaurantId: table.restaurantId, tableId: table.id, orderNumber: `R-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`, currency: table.restaurant.currency, totalAmount: total, idempotencyKeyHash, payloadHash, lines: { create: orderLines } }, include: orderInclude });
          await recordTenantEvent(tx, table.tenantId, null, "restaurant.order.created", order.id, requestId); return publicOrder(order);
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (error instanceof TenantError) throw error;
        if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2002" || error.code === "P2034")) {
          const table = await db.restaurantTable.findFirst({ where: { qrTokenHash: tokenHash, isActive: true, restaurant: { isActive: true } }, select: { id: true, tenantId: true, restaurantId: true } });
          if (table) {
            const existing = await db.restaurantOrder.findFirst({ where: { tenantId: table.tenantId, restaurantId: table.restaurantId, idempotencyKeyHash }, include: orderInclude });
            if (existing && existing.tableId === table.id && existing.payloadHash === payloadHash) return publicOrder(existing);
          }
          throw new TenantError(409, "idempotency_conflict");
        }
        throw error;
      }
    },
    async orders(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => { await staff(tx, actor, tenantId); const r = await restaurant(tx, tenantId); const [items,total] = await Promise.all([tx.restaurantOrder.findMany({ where: { tenantId, restaurantId: r.id }, include: orderInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }), tx.restaurantOrder.count({ where: { tenantId, restaurantId: r.id } })]); return { items: items.map(publicOrder), total, limit, offset }; });
    },
    async transitionOrder(actor: Actor, tenantId: string, orderId: string, status: string, requestId?: string) {
      const allowed = ["accepted", "preparing", "ready", "completed", "cancelled"];
      if (!allowed.includes(status)) throw new TenantError(400, "invalid_status");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await staff(tx, actor, tenantId); const r = await restaurant(tx, tenantId);
        const current = await tx.restaurantOrder.findFirst({ where: { tenantId, restaurantId: r.id, id: orderId } }); if (!current) throw new TenantError(404, "not_found");
        const transitions: Record<string, string[]> = { pending: ["accepted", "cancelled"], accepted: ["preparing", "cancelled"], preparing: ["ready"], ready: ["completed"], completed: [], cancelled: [] };
        if (!transitions[current.status].includes(status)) throw new TenantError(409, "invalid_transition");
        const updated = await tx.restaurantOrder.update({ where: { id: orderId }, data: { status: status as "accepted" | "preparing" | "ready" | "completed" | "cancelled" }, include: orderInclude });
        await recordTenantEvent(tx, tenantId, actor.id, `restaurant.order.${status}`, orderId, requestId); return publicOrder(updated);
      });
    },
  };
}
