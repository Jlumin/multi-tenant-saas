import type { PrismaClient } from "../../generated/prisma/client";
import { requireTenantContext, lockTenant, recordTenantEvent, TenantError, type Actor } from "../tenancy/service";

const storeView = { id: true, tenantId: true, name: true, slug: true, currency: true, isActive: true, createdAt: true, updatedAt: true, version: true } as const;
const productView = { id: true, storeId: true, code: true, name: true, description: true, price: true, isPublished: true, createdAt: true, updatedAt: true, version: true } as const;
export type StoreInput = { name: string; slug: string; currency: string };
export type ProductInput = { code: string; name: string; description: string; price: string; isPublished: boolean };
function version(value: number) { if (!Number.isSafeInteger(value) || value < 1 || value >= 2147483647) throw new TenantError(400, "invalid_version"); }
function validateStore(input: StoreInput) {
  const name = input.name.trim(); const slug = input.slug.trim().toLowerCase(); const currency = input.currency.trim().toUpperCase();
  if (!name || name.length > 120) throw new TenantError(400, "invalid_store");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) throw new TenantError(400, "invalid_slug");
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) throw new TenantError(400, "invalid_currency");
  return { name, slug, currency };
}
function validateProduct(input: ProductInput) {
  const code = input.code.trim().toUpperCase(); const name = input.name.trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code) || !name || name.length > 120 || typeof input.description !== "string" || input.description.length > 2000 || typeof input.isPublished !== "boolean" || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(input.price)) throw new TenantError(400, "invalid_product");
  return { code, name, description: input.description.trim(), price: input.price };
}
export function createEcommerce(db: PrismaClient) {
  return {
    async store(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: storeView });
        if (!store) throw new TenantError(404, "not_found");
        return store;
      });
    },
    async createStore(actor: Actor, tenantId: string, input: StoreInput, requestId?: string) {
      const data = validateStore(input);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        if (await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true } })) throw new TenantError(409, "store_exists");
        const store = await tx.ecomStore.create({ data: { ...data, tenantId }, select: storeView });
        await recordTenantEvent(tx, tenantId, actor.id, "ecommerce.store.created", store.id, requestId);
        return store;
      });
    },
    async updateStore(actor: Actor, tenantId: string, input: { name: string; currency: string; isActive: boolean; version: number }, requestId?: string) {
      if (!Number.isSafeInteger(input.version) || input.version < 1 || typeof input.isActive !== "boolean") throw new TenantError(400, "invalid_store");
      const name = input.name.trim(); const currency = input.currency.trim().toUpperCase();
      if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version >= 2147483647 || !name || name.length > 120) throw new TenantError(400, "invalid_store");
      if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) throw new TenantError(400, "invalid_currency");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const existing = await tx.ecomStore.findUnique({ where: { tenantId }, select: storeView });
        if (!existing) throw new TenantError(404, "not_found");
        if (existing.version !== input.version) throw new TenantError(409, "version_conflict");
        if (currency !== existing.currency && await tx.ecomProduct.count({ where: { tenantId, storeId: existing.id } })) throw new TenantError(409, "currency_locked");
        const store = await tx.ecomStore.update({ where: { tenantId }, data: { name, currency, isActive: input.isActive, version: { increment: 1 } }, select: storeView });
        await recordTenantEvent(tx, tenantId, actor.id, "ecommerce.store.updated", store.id, requestId);
        return store;
      });
    },
    async products(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => {
        const member = await requireTenantContext(tx, actor, tenantId);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true } });
        if (!store) throw new TenantError(404, "not_found");
        const where = { tenantId, storeId: store.id };
        const [items, total] = await Promise.all([tx.ecomProduct.findMany({ where, select: productView, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }), tx.ecomProduct.count({ where })]);
        return { items, total, limit, offset, role: member.role };
      });
    },
    async product(actor: Actor, tenantId: string, id: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true } });
        if (!store) throw new TenantError(404, "not_found");
        const product = await tx.ecomProduct.findFirst({ where: { tenantId, storeId: store.id, id }, select: productView });
        if (!product) throw new TenantError(404, "not_found");
        return product;
      });
    },
    async createProduct(actor: Actor, tenantId: string, input: ProductInput, requestId?: string) {
      const data = validateProduct(input);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true, isActive: true } });
        if (!store) throw new TenantError(404, "not_found");
        if (!store.isActive && input.isPublished) throw new TenantError(409, "store_inactive");
        const product = await tx.ecomProduct.create({ data: { ...data, price: data.price, isPublished: input.isPublished, tenantId, storeId: store.id, createdById: actor.id }, select: productView });
        await recordTenantEvent(tx, tenantId, actor.id, "ecommerce.product.created", product.id, requestId);
        return product;
      });
    },
    async updateProduct(actor: Actor, tenantId: string, id: string, input: ProductInput, expectedVersion: number, requestId?: string) {
      const data = validateProduct(input); version(expectedVersion);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const store = await tx.ecomStore.findUnique({ where: { tenantId }, select: { id: true, isActive: true } });
        if (!store) throw new TenantError(404, "not_found");
        if (!store.isActive && input.isPublished) throw new TenantError(409, "store_inactive");
        const existing = await tx.ecomProduct.findFirst({ where: { tenantId, storeId: store.id, id }, select: { version: true } });
        if (!existing) throw new TenantError(404, "not_found");
        if (existing.version !== expectedVersion) throw new TenantError(409, "version_conflict");
        const product = await tx.ecomProduct.update({ where: { tenantId_storeId_id: { tenantId, storeId: store.id, id } }, data: { ...data, isPublished: input.isPublished, version: { increment: 1 } }, select: productView });
        await recordTenantEvent(tx, tenantId, actor.id, "ecommerce.product.updated", id, requestId);
        return product;
      });
    },
    async publicStore(slug: string) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) throw new TenantError(404, "not_found");
      const store = await db.ecomStore.findFirst({ where: { slug, isActive: true }, select: { name: true, slug: true, currency: true, products: { where: { isPublished: true }, select: { id: true, code: true, name: true, description: true, price: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } } });
      if (!store) throw new TenantError(404, "not_found");
      return { ...store, products: store.products.map(p => ({ ...p, price: p.price.toFixed(2) })) };
    },
  };
}
