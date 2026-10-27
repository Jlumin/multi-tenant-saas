import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, WmsDocumentStatus, WmsDocumentType } from "../../generated/prisma/client";
import { requireTenantContext, lockTenant, recordTenantEvent, TenantError, type Actor } from "../tenancy/service";

type Tx = Prisma.TransactionClient;
export interface StockLineInput { productId: string; locationId: string; targetLocationId?: string; unitId: string; quantity: number }
export interface StockDraftInput { warehouseId: string; destinationWarehouseId?: string; memo?: string; lines: StockLineInput[] }
const MAX = 2147483647;
const view = { lines: { orderBy: { position: "asc" as const } } };
const movementView = {
  document: { select: { number: true, type: true, warehouseId: true, destinationWarehouseId: true, postedAt: true, postedById: true } },
  line: { select: { locationId: true, targetLocationId: true, unitCode: true, unitName: true, baseUnit: true, quantity: true, factor: true, baseQuantity: true, position: true } },
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
    if (!line || typeof line !== "object" || Object.keys(line).some(k => !["productId", "locationId", "targetLocationId", "unitId", "quantity"].includes(k)) || typeof line.productId !== "string" || typeof line.locationId !== "string" || typeof line.unitId !== "string" || line.targetLocationId !== undefined && typeof line.targetLocationId !== "string") throw new TenantError(400, "invalid_lines");
    quantity(line.quantity);
  }
}
async function prepareLines(tx: Tx, tenantId: string, warehouseId: string, input: StockLineInput[], destinationWarehouseId?: string) {
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
    let targetWarehouseId: string | undefined, targetLocationId: string | undefined;
    if (destinationWarehouseId) {
      const target = await tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: destinationWarehouseId, id: item.targetLocationId } });
      if (!item.targetLocationId || !target) throw new TenantError(404, "not_found");
      const destination = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: destinationWarehouseId, isActive: true } });
      if (!destination || !target.isActive) throw new TenantError(409, "master_inactive");
      if (warehouseId === destinationWarehouseId && location.id === target.id) throw new TenantError(400, "same_location");
      targetWarehouseId = destinationWarehouseId; targetLocationId = target.id;
    } else if (item.targetLocationId !== undefined) throw new TenantError(400, "invalid_lines");
    const count = quantity(item.quantity), baseQuantity = count * unit.factor;
    if (!Number.isSafeInteger(baseQuantity) || baseQuantity > MAX) throw new TenantError(400, "quantity_overflow");
    lines.push({ productId: product.id, locationId: location.id, ...(targetWarehouseId && targetLocationId ? { targetWarehouseId, targetLocationId } : {}), unitId: unit.id, unitCode: unit.code, unitName: unit.name, baseUnit: product.baseUnit, quantity: count, factor: unit.factor, unitVersion: unit.version, baseQuantity, position: position + 1 });
  }
  return lines;
}
async function document(tx: Tx, tenantId: string, id: string) {
  const result = await tx.wmsDocument.findFirst({ where: { tenantId, id }, include: view });
  if (!result) throw new TenantError(404, "not_found");
  return result;
}
function snapshotHash(doc: { id: string; type: WmsDocumentType; warehouseId: string; destinationWarehouseId: string | null; memo: string; reversalOfId?: string | null; lines: Array<{ position: number; productId: string; locationId: string; targetWarehouseId: string | null; targetLocationId: string | null; unitId: string; unitCode: string; unitName: string; baseUnit: string; quantity: number; factor: number; unitVersion: number; baseQuantity: number; adjustmentDelta?: number | null }> }) {
  const content = { id: doc.id, type: doc.type, warehouseId: doc.warehouseId, destinationWarehouseId: doc.destinationWarehouseId, reversalOfId: doc.reversalOfId ?? null, memo: doc.memo, lines: doc.lines.map(({ position, productId, locationId, targetWarehouseId, targetLocationId, unitId, unitCode, unitName, baseUnit, quantity: count, factor, unitVersion, baseQuantity, adjustmentDelta }) => ({ position, productId, locationId, targetWarehouseId, targetLocationId, unitId, unitCode, unitName, baseUnit, quantity: count, factor, unitVersion, baseQuantity, adjustmentDelta: adjustmentDelta ?? null })) };
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
      if (type !== "inbound" && type !== "outbound" && type !== "transfer" && type !== "opening") throw new TenantError(400, "invalid_type");
      validateLines(input.lines);
      if (typeof input.warehouseId !== "string") throw new TenantError(400, "invalid_payload");
      const description = memo(input.memo);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        if (type === "transfer" ? typeof input.destinationWarehouseId !== "string" : input.destinationWarehouseId !== undefined) throw new TenantError(400, "invalid_payload");
        const lines = await prepareLines(tx, tenantId, input.warehouseId, input.lines, input.destinationWarehouseId);
        const id = randomUUID(), prefix = type === "inbound" ? "IN" : type === "outbound" ? "OUT" : type === "transfer" ? "TR" : "OPEN", number = `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
        await tx.wmsDocument.create({ data: { id, tenantId, warehouseId: input.warehouseId, destinationWarehouseId: input.destinationWarehouseId, number, type, memo: description, createdById: actor.id } });
        await tx.wmsDocumentLine.createMany({ data: lines.map(line => ({ ...line, tenantId, documentId: id, warehouseId: input.warehouseId })) });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${type}.draft_created`, id, requestId);
        return document(tx, tenantId, id);
      });
    },
    async updateDraft(actor: Actor, tenantId: string, id: string, version: number, input: { memo?: string; lines?: StockLineInput[]; destinationWarehouseId?: string }, requestId?: string) {
      if (!Number.isSafeInteger(version) || version < 1 || version >= MAX || input.memo === undefined && input.lines === undefined && input.destinationWarehouseId === undefined) throw new TenantError(400, "invalid_payload");
      if (input.lines !== undefined) validateLines(input.lines);
      const description = input.memo === undefined ? undefined : memo(input.memo);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const current = await document(tx, tenantId, id);
        if (current.status !== "draft") throw new TenantError(409, "document_not_editable");
        if (current.version !== version) throw new TenantError(409, "version_conflict");
        const destinationWarehouseId = input.destinationWarehouseId ?? current.destinationWarehouseId ?? undefined;
        if (current.type === "transfer" ? !destinationWarehouseId : input.destinationWarehouseId !== undefined) throw new TenantError(400, "invalid_payload");
        if (input.destinationWarehouseId !== undefined && input.destinationWarehouseId !== current.destinationWarehouseId && input.lines === undefined) throw new TenantError(400, "invalid_lines");
        const prepared = input.lines === undefined ? undefined : await prepareLines(tx, tenantId, current.warehouseId, input.lines, current.type === "transfer" ? destinationWarehouseId : undefined);
        await tx.wmsDocument.update({ where: { tenantId_id: { tenantId, id } }, data: { ...(description === undefined ? {} : { memo: description }), ...(input.destinationWarehouseId === undefined ? {} : { destinationWarehouseId: input.destinationWarehouseId }), version: { increment: 1 } } });
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
        if (current.type === "transfer" && (!current.destinationWarehouseId || !await tx.wmsWarehouse.findFirst({ where: { tenantId, id: current.destinationWarehouseId, isActive: true } }))) throw new TenantError(409, "master_inactive");
        if (current.type === "adjustment" && !current.reversalOfId) throw new TenantError(409, "invalid_adjustment");
        const pending = new Map<string, number>();
        const effects: Array<{ line: typeof current.lines[number]; warehouseId: string; locationId: string; delta: number }> = [];
        for (const line of current.lines) {
          const [product, unit, location] = await Promise.all([
            tx.wmsProduct.findFirst({ where: { tenantId, id: line.productId, isActive: true } }),
            tx.wmsProductUnit.findFirst({ where: { tenantId, productId: line.productId, id: line.unitId, isActive: true } }),
            tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: current.warehouseId, id: line.locationId, isActive: true } }),
          ]);
          if (!product || !unit || !location) throw new TenantError(409, "master_inactive");
          if (unit.factor !== line.factor || unit.version !== line.unitVersion || product.baseUnit !== line.baseUnit || line.quantity * line.factor !== line.baseQuantity) throw new TenantError(409, "unit_changed");
          if (current.type === "opening" && await tx.wmsStockMovement.count({ where: { tenantId, productId: line.productId, warehouseId: current.warehouseId, locationId: line.locationId } })) throw new TenantError(409, "opening_not_empty");
          const changes = current.type === "transfer"
            ? [{ warehouseId: current.warehouseId, locationId: line.locationId, delta: -line.baseQuantity }, { warehouseId: line.targetWarehouseId!, locationId: line.targetLocationId!, delta: line.baseQuantity }]
            : [{ warehouseId: current.warehouseId, locationId: line.locationId, delta: current.type === "inbound" || current.type === "opening" ? line.baseQuantity : current.type === "adjustment" ? line.adjustmentDelta ?? 0 : -line.baseQuantity }];
          if (current.type === "transfer") {
            if (!current.destinationWarehouseId || line.targetWarehouseId !== current.destinationWarehouseId || !line.targetLocationId) throw new TenantError(409, "invalid_transfer");
            const target = await tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: current.destinationWarehouseId, id: line.targetLocationId, isActive: true } });
            if (!target) throw new TenantError(409, "master_inactive");
          }
          for (const change of changes) {
            const balanceKey = `${line.productId}:${change.warehouseId}:${change.locationId}`;
            let balance = pending.get(balanceKey);
            if (balance === undefined) balance = (await tx.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId, productId: line.productId, warehouseId: change.warehouseId, locationId: change.locationId } } }))?.quantity ?? 0;
            const next = balance + change.delta;
            if (next < 0) throw new TenantError(409, "insufficient_stock");
            if (next > MAX) throw new TenantError(409, "stock_overflow");
            pending.set(balanceKey, next);
            effects.push({ line, ...change });
          }
        }
        const postedAt = new Date();
        await tx.wmsDocument.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "posted", postedById: actor.id, postedAt, version: { increment: 1 } } });
        try {
          for (const effect of effects) {
            await tx.wmsStockMovement.create({ data: { tenantId, documentId: id, lineId: effect.line.id, productId: effect.line.productId, warehouseId: effect.warehouseId, locationId: effect.locationId, delta: effect.delta, actorId: actor.id, requestId } });
          }
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "P2004") throw new TenantError(409, current.type === "outbound" || current.type === "transfer" ? "insufficient_stock" : "stock_overflow");
          throw error;
        }
        await tx.wmsPostingKey.create({ data: { tenantId, key, documentId: id, payloadHash: hash } });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${current.type}.posted`, id, requestId);
        return document(tx, tenantId, id);
      });
    },
    async reverse(actor: Actor, tenantId: string, id: string, reason: unknown, key: string, requestId: string) {
      const description = memo(reason);
      if (!description) throw new TenantError(400, "invalid_reason");
      if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new TenantError(400, "invalid_idempotency_key");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const original = await document(tx, tenantId, id);
        if (original.status !== "posted" || original.reversalOfId) throw new TenantError(409, "document_not_reversible");
        const existing = await tx.wmsDocument.findUnique({ where: { tenantId_reversalOfId: { tenantId, reversalOfId: id } }, include: view });
        if (existing) {
          const previous = await tx.wmsPostingKey.findUnique({ where: { tenantId_key: { tenantId, key } } });
          if (existing.status === "posted" && previous?.documentId === existing.id && previous.payloadHash === snapshotHash(existing)) return existing;
          throw new TenantError(409, "already_reversed");
        }
        const type: WmsDocumentType = original.type === "inbound" || original.type === "opening" ? "outbound" : original.type === "outbound" ? "inbound" : original.type;
        const warehouseId = original.type === "transfer" ? original.destinationWarehouseId : original.warehouseId;
        const destinationWarehouseId = original.type === "transfer" ? original.warehouseId : undefined;
        if (!warehouseId) throw new TenantError(409, "invalid_transfer");
        const reversedLines = original.lines.map(line => ({
          ...line,
          warehouseId,
          locationId: original.type === "transfer" ? line.targetLocationId as string : line.locationId,
          targetWarehouseId: original.type === "transfer" ? original.warehouseId : null,
          targetLocationId: original.type === "transfer" ? line.locationId : null,
          adjustmentDelta: original.type === "adjustment" ? -(line.adjustmentDelta ?? 0) : null,
        }));
        const reversalId = randomUUID(), postedAt = new Date(), number = `REV-${randomUUID().slice(0, 8).toUpperCase()}`;
        await tx.wmsDocument.create({ data: { id: reversalId, tenantId, warehouseId, destinationWarehouseId, reversalOfId: id, number, type, status: "posted", memo: `沖銷 ${original.number}：${description}`.slice(0, 500), createdById: actor.id, postedById: actor.id, postedAt } });
        const createdLines = await Promise.all(reversedLines.map((line, index) => tx.wmsDocumentLine.create({ data: { tenantId, documentId: reversalId, warehouseId, productId: line.productId, locationId: line.locationId, targetWarehouseId: line.targetWarehouseId, targetLocationId: line.targetLocationId, unitId: line.unitId, unitCode: line.unitCode, unitName: line.unitName, baseUnit: line.baseUnit, quantity: line.quantity, factor: line.factor, unitVersion: line.unitVersion, baseQuantity: line.baseQuantity, adjustmentDelta: line.adjustmentDelta, position: index + 1 } })));
        const pending = new Map<string, number>(), effects: Array<{ line: typeof createdLines[number]; warehouseId: string; locationId: string; delta: number }> = [];
        for (const line of createdLines) {
          const [product, unit, location] = await Promise.all([
            tx.wmsProduct.findFirst({ where: { tenantId, id: line.productId, isActive: true } }),
            tx.wmsProductUnit.findFirst({ where: { tenantId, productId: line.productId, id: line.unitId, isActive: true } }),
            tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: line.warehouseId, id: line.locationId, isActive: true } }),
          ]);
          if (!product || !unit || !location) throw new TenantError(409, "master_inactive");
          const changes = type === "transfer"
            ? [{ warehouseId, locationId: line.locationId, delta: -line.baseQuantity }, { warehouseId: destinationWarehouseId as string, locationId: line.targetLocationId as string, delta: line.baseQuantity }]
            : [{ warehouseId, locationId: line.locationId, delta: type === "inbound" ? line.baseQuantity : type === "adjustment" ? line.adjustmentDelta ?? 0 : -line.baseQuantity }];
          if (type === "transfer" && !await tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: destinationWarehouseId as string, id: line.targetLocationId as string, isActive: true } })) throw new TenantError(409, "master_inactive");
          for (const change of changes) {
            const balanceKey = `${line.productId}:${change.warehouseId}:${change.locationId}`;
            const balance = pending.get(balanceKey) ?? (await tx.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId, productId: line.productId, warehouseId: change.warehouseId, locationId: change.locationId } } }))?.quantity ?? 0;
            const next = balance + change.delta;
            if (next < 0) throw new TenantError(409, "insufficient_stock");
            if (next > MAX) throw new TenantError(409, "stock_overflow");
            pending.set(balanceKey, next); effects.push({ line, ...change });
          }
        }
        for (const effect of effects) await tx.wmsStockMovement.create({ data: { tenantId, documentId: reversalId, lineId: effect.line.id, productId: effect.line.productId, warehouseId: effect.warehouseId, locationId: effect.locationId, delta: effect.delta, actorId: actor.id, requestId } });
        const reversed = await document(tx, tenantId, reversalId), hash = snapshotHash(reversed);
        await tx.wmsPostingKey.create({ data: { tenantId, key, documentId: reversalId, payloadHash: hash } });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${original.type}.reversed`, reversalId, requestId);
        return reversed;
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
