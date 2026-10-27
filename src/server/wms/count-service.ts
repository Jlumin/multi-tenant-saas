import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { lockTenant, recordTenantEvent, requireTenantContext, TenantError, type Actor } from "../tenancy/service";

type Tx = Prisma.TransactionClient;
const MAX = 2147483647;
const countView = {
  warehouse: { select: { id: true, code: true, name: true } },
  lines: { include: { product: { select: { id: true, code: true, name: true, baseUnit: true } }, location: { select: { id: true, code: true, name: true } } }, orderBy: { position: "asc" as const } },
  adjustmentDocument: { select: { id: true, number: true, status: true, postedAt: true } },
};
function integer(value: unknown, allowZero = false) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX) throw new TenantError(400, "invalid_quantity");
  return value;
}
async function findCount(tx: Tx, tenantId: string, id: string) {
  const record = await tx.wmsStockCount.findFirst({ where: { tenantId, id }, include: countView });
  if (!record) throw new TenantError(404, "not_found");
  return { ...record, snapshotRevision: record.snapshotRevision.toString() };
}
function countHash(count: { id: string; snapshotRevision: string; lines: Array<{ id: string; snapshotQuantity: number; countedQuantity: number | null; reason: string }> }) {
  return createHash("sha256").update(JSON.stringify({ id: count.id, snapshotRevision: count.snapshotRevision, lines: count.lines.map(({ id, snapshotQuantity, countedQuantity, reason }) => ({ id, snapshotQuantity, countedQuantity, reason })) })).digest("hex");
}
export function createStockCounts(db: PrismaClient) {
  return {
    async list(actor: Actor, tenantId: string, warehouseId?: string, limit = 20, offset = 0) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const where = { tenantId, ...(warehouseId ? { warehouseId } : {}) };
        const [items, total] = await Promise.all([
          tx.wmsStockCount.findMany({ where, include: countView, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
          tx.wmsStockCount.count({ where }),
        ]);
        return { items: items.map(item => ({ ...item, snapshotRevision: item.snapshotRevision.toString() })), total, limit, offset };
      });
    },
    async get(actor: Actor, tenantId: string, id: string) {
      return db.$transaction(async tx => { await requireTenantContext(tx, actor, tenantId); return findCount(tx, tenantId, id); });
    },
    async start(actor: Actor, tenantId: string, warehouseId: string, memo = "", requestId?: string) {
      if (typeof warehouseId !== "string" || typeof memo !== "string" || memo.length > 500) throw new TenantError(400, "invalid_payload");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const warehouse = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: warehouseId, isActive: true } });
        if (!warehouse) throw new TenantError(404, "not_found");
        const balances = await tx.wmsStockBalance.findMany({ where: { tenantId, warehouseId, quantity: { gt: 0 } }, orderBy: [{ locationId: "asc" }, { productId: "asc" }] });
        const id = randomUUID(), number = `COUNT-${randomUUID().slice(0, 8).toUpperCase()}`;
        await tx.wmsStockCount.create({ data: { id, tenantId, warehouseId, number, snapshotRevision: warehouse.stockRevision, memo: memo.trim(), createdById: actor.id } });
        if (balances.length) await tx.wmsStockCountLine.createMany({ data: balances.map((balance, index) => ({ tenantId, countId: id, warehouseId, productId: balance.productId, locationId: balance.locationId, snapshotQuantity: balance.quantity, position: index + 1 })) });
        await recordTenantEvent(tx, tenantId, actor.id, "wms.stock_count.started", id, requestId);
        return findCount(tx, tenantId, id);
      });
    },
    async addLine(actor: Actor, tenantId: string, id: string, productId: string, locationId: string, version: number, requestId?: string) {
      if (typeof productId !== "string" || typeof locationId !== "string" || !Number.isSafeInteger(version) || version < 1 || version >= MAX) throw new TenantError(400, "invalid_payload");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const count = await tx.wmsStockCount.findFirst({ where: { tenantId, id } });
        if (!count) throw new TenantError(404, "not_found");
        if (count.status !== "draft") throw new TenantError(409, "count_not_editable");
        if (count.version !== version) throw new TenantError(409, "version_conflict");
        const [product, location, existing, balance, lineCount] = await Promise.all([
          tx.wmsProduct.findFirst({ where: { tenantId, id: productId, isActive: true } }),
          tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: count.warehouseId, id: locationId, isActive: true } }),
          tx.wmsStockCountLine.findFirst({ where: { tenantId, countId: id, productId, warehouseId: count.warehouseId, locationId } }),
          tx.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId, productId, warehouseId: count.warehouseId, locationId } } }),
          tx.wmsStockCountLine.count({ where: { tenantId, countId: id } }),
        ]);
        if (!product || !location) throw new TenantError(404, "not_found");
        if (existing) throw new TenantError(409, "duplicate_count_line");
        await tx.wmsStockCountLine.create({ data: { tenantId, countId: id, warehouseId: count.warehouseId, productId, locationId, snapshotQuantity: balance?.quantity ?? 0, position: lineCount + 1 } });
        await tx.wmsStockCount.update({ where: { tenantId_id: { tenantId, id } }, data: { version: { increment: 1 } } });
        await recordTenantEvent(tx, tenantId, actor.id, "wms.stock_count.line_added", id, requestId);
        return findCount(tx, tenantId, id);
      });
    },
    async setLine(actor: Actor, tenantId: string, id: string, lineId: string, version: number, countedQuantity: number, reason = "", requestId?: string) {
      integer(countedQuantity, true);
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX || typeof reason !== "string" || reason.length > 200) throw new TenantError(400, "invalid_payload");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const count = await tx.wmsStockCount.findFirst({ where: { tenantId, id } });
        if (!count) throw new TenantError(404, "not_found");
        if (count.status !== "draft") throw new TenantError(409, "count_not_editable");
        if (count.version !== version) throw new TenantError(409, "version_conflict");
        const line = await tx.wmsStockCountLine.findFirst({ where: { tenantId, countId: id, id: lineId } });
        if (!line) throw new TenantError(404, "not_found");
        await tx.wmsStockCountLine.update({ where: { tenantId_countId_id: { tenantId, countId: id, id: lineId } }, data: { countedQuantity, reason: reason.trim() } });
        await tx.wmsStockCount.update({ where: { tenantId_id: { tenantId, id } }, data: { version: { increment: 1 } } });
        await recordTenantEvent(tx, tenantId, actor.id, "wms.stock_count.line_counted", lineId, requestId);
        return findCount(tx, tenantId, id);
      });
    },
    async cancel(actor: Actor, tenantId: string, id: string, version: number, requestId?: string) {
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX) throw new TenantError(400, "invalid_version");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const count = await tx.wmsStockCount.findFirst({ where: { tenantId, id } });
        if (!count) throw new TenantError(404, "not_found");
        if (count.status !== "draft") throw new TenantError(409, "count_not_cancellable");
        if (count.version !== version) throw new TenantError(409, "version_conflict");
        await tx.wmsStockCount.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "cancelled", version: { increment: 1 } } });
        await recordTenantEvent(tx, tenantId, actor.id, "wms.stock_count.cancelled", id, requestId);
        return findCount(tx, tenantId, id);
      });
    },
    async post(actor: Actor, tenantId: string, id: string, version: number, key: string, requestId: string) {
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX) throw new TenantError(400, "invalid_version");
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new TenantError(400, "invalid_idempotency_key");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const count = await findCount(tx, tenantId, id), countHashValue = countHash(count);
        if (count.status === "posted") {
          const adjustment = await tx.wmsDocument.findFirst({ where: { tenantId, stockCountId: id }, include: { lines: { orderBy: { position: "asc" } } } });
          const previous = await tx.wmsPostingKey.findUnique({ where: { tenantId_key: { tenantId, key } } });
          if (adjustment && previous?.documentId === adjustment.id && previous.payloadHash === countHashValue) return count;
          throw new TenantError(409, "idempotency_conflict");
        }
        if (count.status !== "draft") throw new TenantError(409, count.status === "stale" ? "count_stale" : "count_not_postable");
        if (count.version !== version) throw new TenantError(409, "version_conflict");
        if (count.lines.some(line => line.countedQuantity === null)) throw new TenantError(409, "count_incomplete");
        const warehouse = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: count.warehouseId, isActive: true } });
        if (!warehouse) throw new TenantError(409, "master_inactive");
        if (warehouse.stockRevision !== BigInt(count.snapshotRevision)) {
          await tx.wmsStockCount.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "stale", version: { increment: 1 } } });
          await recordTenantEvent(tx, tenantId, actor.id, "wms.stock_count.stale", id, requestId);
          return { ...await findCount(tx, tenantId, id), stale: true };
        }
        const diffs = [];
        for (const line of count.lines) {
          const delta = (line.countedQuantity as number) - line.snapshotQuantity;
          if (!delta) continue;
          const product = await tx.wmsProduct.findFirst({ where: { tenantId, id: line.productId, isActive: true }, include: { units: { where: { isBase: true, isActive: true }, take: 1 } } });
          const unit = product?.units[0];
          if (!product || !unit) throw new TenantError(409, "master_inactive");
          diffs.push({ line, product, unit, delta });
        }
        const documentId = randomUUID(), number = `ADJ-${randomUUID().slice(0, 8).toUpperCase()}`, postedAt = new Date();
        await tx.wmsStockCount.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "posted", postedAt, postedById: actor.id, version: { increment: 1 } } });
        await tx.wmsDocument.create({ data: { id: documentId, tenantId, warehouseId: count.warehouseId, stockCountId: id, number, type: "adjustment", status: "posted", memo: `盤點 ${count.number}：${count.memo}`.slice(0, 500), createdById: actor.id, postedById: actor.id, postedAt } });
        if (diffs.length) {
          const createdLines = await Promise.all(diffs.map(({ line, product, unit, delta }, index) => tx.wmsDocumentLine.create({ data: { tenantId, documentId, warehouseId: count.warehouseId, productId: line.productId, locationId: line.locationId, unitId: unit.id, unitCode: unit.code, unitName: unit.name, baseUnit: product.baseUnit, quantity: Math.abs(delta), factor: 1, unitVersion: unit.version, baseQuantity: Math.abs(delta), adjustmentDelta: delta, position: index + 1 } })));
          for (const line of createdLines) await tx.wmsStockMovement.create({ data: { tenantId, documentId, lineId: line.id, productId: line.productId, warehouseId: line.warehouseId, locationId: line.locationId, delta: line.adjustmentDelta as number, actorId: actor.id, requestId } });
        }
        await tx.wmsPostingKey.create({ data: { tenantId, key, documentId, payloadHash: countHashValue } });
        await recordTenantEvent(tx, tenantId, actor.id, "wms.stock_count.posted", id, requestId);
        return findCount(tx, tenantId, id);
      });
    },
  };
}
