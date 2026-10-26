import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, WmsDocumentStatus, WmsDocumentType } from "../../generated/prisma/client";
import { requireTenantContext, lockTenant, recordTenantEvent, TenantError, type Actor } from "../tenancy/service";

type Tx = Prisma.TransactionClient;
export interface StockLineInput { productId: string; locationId: string; unitId: string; quantity: number }
export interface StockDraftInput { warehouseId: string; memo?: string; lines: StockLineInput[] }
const MAX = 2147483647;
const view = { lines: { orderBy: { position: "asc" as const } } };
const movementView = {
  document: { select: { number: true, type: true, postedAt: true, postedById: true } },
  line: { select: { unitCode: true, unitName: true, baseUnit: true, quantity: true, factor: true, baseQuantity: true, position: true } },
  product: { select: { code: true, name: true, baseUnit: true } },
  warehouse: { select: { code: true, name: true } },
  location: { select: { code: true, name: true } },
};
function quantity(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX) throw new TenantError(400, "invalid_quantity");
  return value;
}
function memo(value: unknown) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 500) throw new TenantError(400, "invalid_memo");
  return value.trim();
}
function validateLines(input: unknown): asserts input is StockLineInput[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new TenantError(400, "invalid_lines");
  for (const line of input) {
    if (!line || typeof line !== "object" || Object.keys(line).some(k => !["productId", "locationId", "unitId", "quantity"].includes(k)) || typeof line.productId !== "string" || typeof line.locationId !== "string" || typeof line.unitId !== "string") throw new TenantError(400, "invalid_lines");
    quantity(line.quantity);
  }
}
async function prepareLines(tx: Tx, tenantId: string, warehouseId: string, input: StockLineInput[]) {
  const warehouse = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: warehouseId } });
  if (!warehouse) throw new TenantError(404, "not_found");
  if (!warehouse.isActive) throw new TenantError(409, "master_inactive");
  const lines = [];
  for (let position = 0; position < input.length; position++) {
    const item = input[position];
    const [product, unit, location] = await Promise.all([
      tx.wmsProduct.findFirst({ where: { tenantId, id: item.productId } }),
      tx.wmsProductUnit.findFirst({ where: { tenantId, productId: item.productId, id: item.unitId } }),
      tx.wmsLocation.findFirst({ where: { tenantId, warehouseId, id: item.locationId } }),
    ]);
    if (!product || !unit || !location) throw new TenantError(404, "not_found");
    if (!product.isActive || !unit.isActive || !location.isActive) throw new TenantError(409, "master_inactive");
    const count = quantity(item.quantity), baseQuantity = count * unit.factor;
    if (!Number.isSafeInteger(baseQuantity) || baseQuantity > MAX) throw new TenantError(400, "quantity_overflow");
    lines.push({ productId: product.id, locationId: location.id, unitId: unit.id, unitCode: unit.code, unitName: unit.name, baseUnit: product.baseUnit, quantity: count, factor: unit.factor, unitVersion: unit.version, baseQuantity, position: position + 1 });
  }
  return lines;
}
async function document(tx: Tx, tenantId: string, id: string) {
  const result = await tx.wmsDocument.findFirst({ where: { tenantId, id }, include: view });
  if (!result) throw new TenantError(404, "not_found");
  return result;
}
function snapshotHash(doc: { id: string; type: WmsDocumentType; warehouseId: string; memo: string; lines: Array<{ position: number; productId: string; locationId: string; unitId: string; unitCode: string; unitName: string; baseUnit: string; quantity: number; factor: number; unitVersion: number; baseQuantity: number }> }) {
  const content = { id: doc.id, type: doc.type, warehouseId: doc.warehouseId, memo: doc.memo, lines: doc.lines.map(({ position, productId, locationId, unitId, unitCode, unitName, baseUnit, quantity: count, factor, unitVersion, baseQuantity }) => ({ position, productId, locationId, unitId, unitCode, unitName, baseUnit, quantity: count, factor, unitVersion, baseQuantity })) };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}
export function createStock(db: PrismaClient) {
  return {
    async listDocuments(actor: Actor, tenantId: string, filter: { type?: WmsDocumentType; status?: WmsDocumentStatus }, limit: number, offset: number) {
      return db.$transaction(async tx => {
        const member = await requireTenantContext(tx, actor, tenantId);
        const where = { tenantId, ...(filter.type ? { type: filter.type } : {}), ...(filter.status ? { status: filter.status } : {}) };
        const [items, total] = await Promise.all([
          tx.wmsDocument.findMany({ where, include: view, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
          tx.wmsDocument.count({ where }),
        ]);
        return { items, total, limit, offset, role: member.role };
      });
    },
    async getDocument(actor: Actor, tenantId: string, id: string) {
      return db.$transaction(async tx => { await requireTenantContext(tx, actor, tenantId); return document(tx, tenantId, id); });
    },
    async createDraft(actor: Actor, tenantId: string, type: WmsDocumentType, input: StockDraftInput, requestId?: string) {
      validateLines(input.lines);
      if (typeof input.warehouseId !== "string") throw new TenantError(400, "invalid_payload");
      const description = memo(input.memo);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const lines = await prepareLines(tx, tenantId, input.warehouseId, input.lines);
        const id = randomUUID(), number = `${type === "inbound" ? "IN" : "OUT"}-${randomUUID().slice(0, 8).toUpperCase()}`;
        await tx.wmsDocument.create({ data: { id, tenantId, warehouseId: input.warehouseId, number, type, memo: description, createdById: actor.id } });
        await tx.wmsDocumentLine.createMany({ data: lines.map(line => ({ ...line, tenantId, documentId: id, warehouseId: input.warehouseId })) });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${type}.draft_created`, id, requestId);
        return document(tx, tenantId, id);
      });
    },
    async updateDraft(actor: Actor, tenantId: string, id: string, version: number, input: { memo?: string; lines?: StockLineInput[] }, requestId?: string) {
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX || input.memo === undefined && input.lines === undefined) throw new TenantError(400, "invalid_payload");
      if (input.lines !== undefined) validateLines(input.lines);
      const description = input.memo === undefined ? undefined : memo(input.memo);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const current = await document(tx, tenantId, id);
        if (current.status !== "draft") throw new TenantError(409, "document_not_editable");
        if (current.version !== version) throw new TenantError(409, "version_conflict");
        const prepared = input.lines === undefined ? undefined : await prepareLines(tx, tenantId, current.warehouseId, input.lines);
        await tx.wmsDocument.update({ where: { tenantId_id: { tenantId, id } }, data: { ...(description === undefined ? {} : { memo: description }), version: { increment: 1 } } });
        if (prepared) {
          await tx.wmsDocumentLine.deleteMany({ where: { tenantId, documentId: id } });
          await tx.wmsDocumentLine.createMany({ data: prepared.map(line => ({ ...line, tenantId, documentId: id, warehouseId: current.warehouseId })) });
        }
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${current.type}.draft_updated`, id, requestId);
        return document(tx, tenantId, id);
      });
    },
    async cancelDraft(actor: Actor, tenantId: string, id: string, version: number, requestId?: string) {
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX) throw new TenantError(400, "invalid_version");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const current = await document(tx, tenantId, id);
        if (current.status !== "draft") throw new TenantError(409, "document_not_cancellable");
        if (current.version !== version) throw new TenantError(409, "version_conflict");
        await tx.wmsDocument.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "cancelled", version: { increment: 1 } } });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${current.type}.cancelled`, id, requestId);
        return document(tx, tenantId, id);
      });
    },
    async post(actor: Actor, tenantId: string, id: string, version: number, key: string, requestId: string) {
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX) throw new TenantError(400, "invalid_version");
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new TenantError(400, "invalid_idempotency_key");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const current = await document(tx, tenantId, id), hash = snapshotHash(current);
        const previous = await tx.wmsPostingKey.findUnique({ where: { tenantId_key: { tenantId, key } } });
        if (previous) {
          if (previous.documentId !== id || previous.payloadHash !== hash || current.status !== "posted") throw new TenantError(409, "idempotency_conflict");
          return current;
        }
        if (current.status !== "draft") throw new TenantError(409, "document_not_postable");
        if (current.version !== version) throw new TenantError(409, "version_conflict");
        const warehouse = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: current.warehouseId, isActive: true } });
        if (!warehouse) throw new TenantError(409, "master_inactive");
        const pending = new Map<string, number>();
        for (const line of current.lines) {
          const [product, unit, location] = await Promise.all([
            tx.wmsProduct.findFirst({ where: { tenantId, id: line.productId, isActive: true } }),
            tx.wmsProductUnit.findFirst({ where: { tenantId, productId: line.productId, id: line.unitId, isActive: true } }),
            tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: current.warehouseId, id: line.locationId, isActive: true } }),
          ]);
          if (!product || !unit || !location) throw new TenantError(409, "master_inactive");
          if (unit.factor !== line.factor || unit.version !== line.unitVersion || product.baseUnit !== line.baseUnit || line.quantity * line.factor !== line.baseQuantity) throw new TenantError(409, "unit_changed");
          const balanceKey = `${line.productId}:${current.warehouseId}:${line.locationId}`;
          let balance = pending.get(balanceKey);
          if (balance === undefined) balance = (await tx.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId, productId: line.productId, warehouseId: current.warehouseId, locationId: line.locationId } } }))?.quantity ?? 0;
          const next = current.type === "inbound" ? balance + line.baseQuantity : balance - line.baseQuantity;
          if (next < 0) throw new TenantError(409, "insufficient_stock");
          if (next > MAX) throw new TenantError(409, "stock_overflow");
          pending.set(balanceKey, next);
        }
        const postedAt = new Date();
        await tx.wmsDocument.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "posted", postedById: actor.id, postedAt, version: { increment: 1 } } });
        try {
          for (const line of current.lines) {
            await tx.wmsStockMovement.create({ data: { tenantId, documentId: id, lineId: line.id, productId: line.productId, warehouseId: current.warehouseId, locationId: line.locationId, delta: current.type === "inbound" ? line.baseQuantity : -line.baseQuantity, actorId: actor.id, requestId } });
          }
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "P2004") throw new TenantError(409, current.type === "outbound" ? "insufficient_stock" : "stock_overflow");
          throw error;
        }
        await tx.wmsPostingKey.create({ data: { tenantId, key, documentId: id, payloadHash: hash } });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${current.type}.posted`, id, requestId);
        return document(tx, tenantId, id);
      });
    },
    async balances(actor: Actor, tenantId: string, filter: { productId?: string; warehouseId?: string; locationId?: string }, limit: number, offset: number) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const where = { tenantId, quantity: { gt: 0 }, ...(filter.productId ? { productId: filter.productId } : {}), ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}), ...(filter.locationId ? { locationId: filter.locationId } : {}) };
        const [items, total] = await Promise.all([tx.wmsStockBalance.findMany({ where, orderBy: [{ productId: "asc" }, { warehouseId: "asc" }, { locationId: "asc" }], take: limit, skip: offset }), tx.wmsStockBalance.count({ where })]);
        return { items, total, limit, offset };
      });
    },
    async movements(actor: Actor, tenantId: string, filter: { productId?: string; warehouseId?: string; locationId?: string }, limit: number, offset: number) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const where = { tenantId, ...(filter.productId ? { productId: filter.productId } : {}), ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}), ...(filter.locationId ? { locationId: filter.locationId } : {}) };
        const [items, total] = await Promise.all([tx.wmsStockMovement.findMany({ where, include: movementView, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }), tx.wmsStockMovement.count({ where })]);
        return { items, total, limit, offset };
      });
    },
    async getMovement(actor: Actor, tenantId: string, id: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const movement = await tx.wmsStockMovement.findFirst({ where: { tenantId, id }, include: movementView });
        if (!movement) throw new TenantError(404, "not_found");
        return movement;
      });
    },
  };
}
