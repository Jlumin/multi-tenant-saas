import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { requireTenantContext, lockTenant, recordTenantEvent, TenantError, type Actor } from "../tenancy/service";

type Tx = Prisma.TransactionClient;
export type WmsScope = { kind: "products" | "warehouses"; parentId?: never } | { kind: "units" | "locations"; parentId: string };
export interface CreateMaster { code: string; name: string; baseUnit?: string; factor?: number }
export interface EditMaster { name?: string; isActive?: boolean; version: number }
export const MAX_QUANTITY = 2147483647;
const action = { products: "product", warehouses: "warehouse", units: "unit", locations: "location" } as const;
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new TenantError(400, "invalid_master");
  return value.trim();
}
function code(value: unknown) {
  const normalized = text(value, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(normalized)) throw new TenantError(400, "invalid_code");
  return normalized;
}
function integer(value: unknown, max = MAX_QUANTITY) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) throw new TenantError(400, "invalid_integer");
  return value;
}
async function parent(tx: Tx, tenantId: string, scope: WmsScope, active = false) {
  if (scope.kind === "products" || scope.kind === "warehouses") return;
  const record = scope.kind === "units"
    ? await tx.wmsProduct.findFirst({ where: { tenantId, id: scope.parentId } })
    : await tx.wmsWarehouse.findFirst({ where: { tenantId, id: scope.parentId } });
  if (!record) throw new TenantError(404, "not_found");
  if (active && !record.isActive) throw new TenantError(409, "parent_inactive");
}
async function find(tx: Tx, tenantId: string, scope: WmsScope, id: string) {
  const where = { tenantId, id };
  const record = scope.kind === "products" ? await tx.wmsProduct.findFirst({ where })
    : scope.kind === "warehouses" ? await tx.wmsWarehouse.findFirst({ where })
    : scope.kind === "units" ? await tx.wmsProductUnit.findFirst({ where: { ...where, productId: scope.parentId } })
    : await tx.wmsLocation.findFirst({ where: { ...where, warehouseId: scope.parentId as string } });
  if (!record) throw new TenantError(404, "not_found");
  return record;
}
export function createWms(db: PrismaClient) {
  return {
    async list(actor: Actor, tenantId: string, scope: WmsScope, limit: number, offset: number) {
      return db.$transaction(async tx => {
        const member = await requireTenantContext(tx, actor, tenantId); await parent(tx, tenantId, scope);
        const options = { take: limit, skip: offset, orderBy: { code: "asc" as const } };
        let items; let total;
        if (scope.kind === "products") { items = await tx.wmsProduct.findMany({ ...options, where: { tenantId } }); total = await tx.wmsProduct.count({ where: { tenantId } }); }
        else if (scope.kind === "warehouses") { items = await tx.wmsWarehouse.findMany({ ...options, where: { tenantId } }); total = await tx.wmsWarehouse.count({ where: { tenantId } }); }
        else if (scope.kind === "units") { const where = { tenantId, productId: scope.parentId }; items = await tx.wmsProductUnit.findMany({ ...options, where }); total = await tx.wmsProductUnit.count({ where }); }
        else { const where = { tenantId, warehouseId: scope.parentId as string }; items = await tx.wmsLocation.findMany({ ...options, where }); total = await tx.wmsLocation.count({ where }); }
        return { items, total, limit, offset, role: member.role };
      });
    },
    async detail(actor: Actor, tenantId: string, scope: WmsScope, id: string) {
      return db.$transaction(async tx => { await requireTenantContext(tx, actor, tenantId); await parent(tx, tenantId, scope); return find(tx, tenantId, scope, id); });
    },
    async create(actor: Actor, tenantId: string, scope: WmsScope, input: CreateMaster, requestId?: string) {
      const values = { code: code(input.code), name: text(input.name, 120), tenantId };
      if (scope.kind === "units" && values.code === "BASE" || scope.kind === "locations" && values.code === "UNASSIGNED") throw new TenantError(400, "reserved_code");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true); await parent(tx, tenantId, scope, true);
        let record;
        if (scope.kind === "products") {
          const baseUnit = text(input.baseUnit, 20);
          record = await tx.wmsProduct.create({ data: { ...values, baseUnit } });
          const unit = await tx.wmsProductUnit.create({ data: { tenantId, productId: record.id, code: "BASE", name: baseUnit, factor: 1, isBase: true } });
          await recordTenantEvent(tx, tenantId, actor.id, "wms.unit.created", unit.id, requestId);
        } else if (scope.kind === "warehouses") {
          record = await tx.wmsWarehouse.create({ data: values });
          const location = await tx.wmsLocation.create({ data: { tenantId, warehouseId: record.id, code: "UNASSIGNED", name: "未分配儲位", isDefault: true } });
          await recordTenantEvent(tx, tenantId, actor.id, "wms.location.created", location.id, requestId);
        } else if (scope.kind === "units") record = await tx.wmsProductUnit.create({ data: { ...values, productId: scope.parentId as string, factor: integer(input.factor, 1000000) } });
        else record = await tx.wmsLocation.create({ data: { ...values, warehouseId: scope.parentId as string } });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${action[scope.kind]}.created`, record.id, requestId);
        return record;
      });
    },
    async update(actor: Actor, tenantId: string, scope: WmsScope, id: string, input: EditMaster, requestId?: string) {
      integer(input.version, MAX_QUANTITY - 1);
      if (input.name === undefined && input.isActive === undefined || input.isActive !== undefined && typeof input.isActive !== "boolean") throw new TenantError(400, "invalid_payload");
      const data = { ...(input.name === undefined ? {} : { name: text(input.name, 120) }), ...(input.isActive === undefined ? {} : { isActive: input.isActive }), version: { increment: 1 } };
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId); await parent(tx, tenantId, scope);
        const record = await find(tx, tenantId, scope, id);
        await requireTenantContext(tx, actor, tenantId, true); await parent(tx, tenantId, scope, true);
        if ("isBase" in record && record.isBase || "isDefault" in record && record.isDefault) throw new TenantError(409, "protected_record");
        if (record.version !== input.version) throw new TenantError(409, "version_conflict");
        if (scope.kind === "products") await tx.wmsProduct.update({ where: { tenantId_id: { tenantId, id } }, data });
        else if (scope.kind === "warehouses") await tx.wmsWarehouse.update({ where: { tenantId_id: { tenantId, id } }, data });
        else if (scope.kind === "units") await tx.wmsProductUnit.update({ where: { tenantId_productId_id: { tenantId, productId: scope.parentId as string, id } }, data });
        else await tx.wmsLocation.update({ where: { tenantId_warehouseId_id: { tenantId, warehouseId: scope.parentId as string, id } }, data });
        await recordTenantEvent(tx, tenantId, actor.id, `wms.${action[scope.kind]}.updated`, id, requestId);
        return find(tx, tenantId, scope, id);
      });
    },
    async convert(actor: Actor, tenantId: string, productId: string, unitId: string, quantity: number) {
      integer(quantity);
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const product = await tx.wmsProduct.findFirst({ where: { tenantId, id: productId } });
        const unit = await tx.wmsProductUnit.findFirst({ where: { tenantId, productId, id: unitId } });
        if (!product || !unit) throw new TenantError(404, "not_found");
        if (!product.isActive || !unit.isActive) throw new TenantError(409, "master_inactive");
        const baseQuantity = quantity * unit.factor;
        if (!Number.isSafeInteger(baseQuantity) || baseQuantity > MAX_QUANTITY) throw new TenantError(400, "quantity_overflow");
        return { productId, unitId, unitVersion: unit.version, quantity, factor: unit.factor, baseQuantity, baseUnit: product.baseUnit };
      });
    },
  };
}
