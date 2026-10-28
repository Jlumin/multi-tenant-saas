import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/server/auth/create-auth";
import { createEcommerce } from "../../src/server/ecommerce/service";
import { createWms } from "../../src/server/wms/service";
import { createStock } from "../../src/server/wms/stock-service";
import { type Actor } from "../../src/server/tenancy/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn(), mail: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database, deliverMail: runtime.mail }));
import { handleEcommerce } from "../../src/server/ecommerce/api";
import { handlePublicShop } from "../../src/server/ecommerce/public-api";
import { handlePublicCheckout } from "../../src/server/ecommerce/checkout-api";
import { createEcommerceOrders } from "../../src/server/ecommerce/orders";
import { createEcommercePayments } from "../../src/server/ecommerce/payments";
import { handlePublicRestock } from "../../src/server/ecommerce/restock-api";
import { createRestockNotifications } from "../../src/server/ecommerce/restock";

const baseURL = "http://localhost:3000", dbName = `ecom_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false; let a: string, b: string;
const actors: Record<string, Actor> = {}, cookies: Record<string, string> = {};
let warehouseA = "", warehouseB = "", locationA = "";
const wmsProductsA: Record<string, string> = {}, wmsProductsB: Record<string, string> = {};
let stock: ReturnType<typeof createStock>;
async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleEcommerce(new Request(`${baseURL}/api/ecommerce/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function receiveProduct(tenantId: string, owner: Actor, warehouseId: string, locationId: string, productId: string, quantity: number) {
  const unit = await db.wmsProductUnit.findFirstOrThrow({ where: { tenantId, productId, isBase: true } });
  const draft = await stock.createDraft(owner, tenantId, "inbound", { warehouseId, lines: [{ productId, locationId, unitId: unit.id, quantity }] });
  return stock.post(owner, tenantId, draft.id, draft.version, `ecom-receive-${randomUUID()}`, randomUUID());
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL }); await admin.connect(); await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL); url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(migrated.status, "Migration failed; output suppressed").toBe(0);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] }); const secret = randomUUID() + randomUUID();
  vi.stubEnv("BETTER_AUTH_URL", baseURL); vi.stubEnv("BETTER_AUTH_SECRET", secret); vi.stubEnv("DATABASE_URL", url.toString()); vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("SMTP_PORT", "1025"); vi.stubEnv("SMTP_FROM", "noreply@example.test");
  const auth = createAuth({ baseURL, secret, databaseURL: url.toString(), smtp: { host: "localhost", port: 1025, secure: false, from: "noreply@example.test" } }, db, async () => {}); runtime.auth.mockReturnValue(auth); runtime.database.mockReturnValue(db); stock = createStock(db);
  const password = "Ecom-test-only-password-623!", hash = await hashPassword(password);
  for (const name of ["ownerA", "ownerB", "member", "outsider"]) {
    const user = await db.user.create({ data: { name, email: `${name.toLowerCase()}@example.test`, emailVerified: true } }); actors[name] = user;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    const response = await auth.api.signInEmail({ body: { email: user.email, password }, headers: new Headers({ Origin: baseURL }), asResponse: true });
    expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
});
beforeEach(async () => {
  a = (await db.tenant.create({ data: { name: "Ecom tenant A", slug: `ea-${randomUUID()}` } })).id;
  b = (await db.tenant.create({ data: { name: "Ecom tenant B", slug: `eb-${randomUUID()}` } })).id;
  await db.membership.createMany({ data: [{ tenantId: a, userId: actors.ownerA.id, role: "owner" }, { tenantId: a, userId: actors.member.id, role: "member" }, { tenantId: b, userId: actors.ownerB.id, role: "owner" }] });
  const wms = createWms(db);
  warehouseA = (await wms.create(actors.ownerA, a, { kind: "warehouses" }, { code: "SHOP-A", name: "Shop A warehouse" })).id;
  warehouseB = (await wms.create(actors.ownerB, b, { kind: "warehouses" }, { code: "SHOP-B", name: "Shop B warehouse" })).id;
  locationA = (await db.wmsLocation.findFirstOrThrow({ where: { tenantId: a, warehouseId: warehouseA, isDefault: true } })).id;
  for (const [index, code] of ["MEMBER", "PART-1", "OTHER", "ROLLBACK", "LIVE", "DRAFT", "BAD2", "BAD3", "BAD5", "VERSION", "CSRF", "ORDER-1", "LIVE-C", "DRAFT-C", "FOREIGN-C", "RACE-C", "PAYMENT", "PAYMENT-ROLLBACK"].entries()) {
    wmsProductsA[code] = (await wms.create(actors.ownerA, a, { kind: "products" }, { code: `EA-${index}`, name: `${code} WMS`, baseUnit: "個" })).id;
    wmsProductsB[code] = (await wms.create(actors.ownerB, b, { kind: "products" }, { code: `EB-${index}`, name: `${code} WMS`, baseUnit: "個" })).id;
  }
  vi.stubEnv("BETTER_AUTH_SECRET", "ecommerce integration test secret with sufficient entropy");
  runtime.mail.mockReset(); runtime.mail.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); try { await db?.$disconnect(); } finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } } });

describe("E-Commerce store and catalog with signed sessions and PostgreSQL", () => {
  const storeInput = (slug: string, tenantId = a) => ({ name: "A Store", slug, currency: "TWD", warehouseId: tenantId === b ? warehouseB : warehouseA });
  const productInput = (code: string, isPublished = false, tenantId = a) => ({ code, name: `${code} product`, description: "Public description", price: "120.50", wmsProductId: (tenantId === b ? wmsProductsB : wmsProductsA)[code], isPublished });
  it("requires membership and Owner writes while Member can read", async () => {
    expect((await api("anonymous", `${a}/store`)).status).toBe(401);
    expect((await api("outsider", `${a}/store`)).status).toBe(404);
    expect((await api("member", `${a}/store`, "POST", storeInput(`store-${randomUUID()}`))).status).toBe(403);
    expect((await api("ownerA", `${a}/store`, "POST", storeInput(`store-${randomUUID()}`))).status).toBe(201);
    expect((await api("member", `${a}/store`)).status).toBe(200);
    expect((await api("member", `${a}/products`, "POST", productInput("MEMBER"))).status).toBe(403);
    expect((await api("outsider", `${a}/products`)).status).toBe(404);
  });
  it("isolates tenants, enforces unique slug and product code, and audits atomically", async () => {
    const slug = `shop-${randomUUID()}`; const storeA = await (await api("ownerA", `${a}/store`, "POST", storeInput(slug))).json();
    const storeB = await (await api("ownerB", `${b}/store`, "POST", storeInput(`shop-${randomUUID()}`, b))).json();
    expect((await api("ownerA", `${a}/store`, "PATCH", { name: storeA.name, currency: storeA.currency, warehouseId: warehouseB, isActive: true, version: storeA.version })).status).toBe(409);
    expect((await api("ownerB", `${b}/store`, "POST", storeInput(slug))).status).toBe(409);
    const createdProduct = await api("ownerA", `${a}/products`, "POST", productInput("PART-1", true)); expect(createdProduct.status).toBe(201);
    expect((await api("ownerA", `${a}/products`, "POST", { ...productInput("OTHER"), wmsProductId: wmsProductsB["PART-1"] })).status).toBe(409);
    expect((await api("ownerB", `${b}/products`, "POST", productInput("PART-1", false, b))).status).toBe(201);
    expect((await api("ownerA", `${b}/products`)).status).toBe(404);
    const product = await createdProduct.json();
    expect((await api("ownerA", `${a}/products/${product.id}`)).status).toBe(200);
    expect((await api("member", `${a}/products/${product.id}`)).status).toBe(200);
    expect((await api("ownerB", `${b}/products/${createdProduct.headers.get("x-request-id")}`, "PATCH", { ...productInput("OTHER", false, b), version: 1 })).status).toBe(404);
    expect((await api("ownerB", `${b}/products/${product.id}`)).status).toBe(404);
    expect((await api("ownerA", `${a}/products`, "POST", productInput("PART-1"))).status).toBe(409);
    const audit = await db.tenantAudit.findFirstOrThrow({ where: { tenantId: a, targetId: product.id, action: "ecommerce.product.created" } });
    expect(audit.requestId).toBe(createdProduct.headers.get("x-request-id")); expect(JSON.stringify(audit)).not.toContain("Public description");
    const before = await db.ecomProduct.count({ where: { tenantId: a } });
    await expect(createEcommerce(db).createProduct(actors.ownerA, a, productInput("ROLLBACK"), "invalid-uuid")).rejects.toThrow();
    expect(await db.ecomProduct.count({ where: { tenantId: a } })).toBe(before);
    const store = await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } });
    expect((await api("ownerA", `${a}/store`, "PATCH", { name: store.name, currency: "USD", warehouseId: store.warehouseId, isActive: true, version: store.version })).status).toBe(409);
    await expect(db.ecomProduct.create({ data: { tenantId: a, storeId: storeB.id, createdById: actors.ownerA.id, code: "BAD-FOREIGN", name: "Foreign store", price: "1.00" } })).rejects.toThrow();
    expect(storeA.slug).toBe(slug);
  });
  it("publicly returns only published products for active store, without tenant selector", async () => {
    const slug = `public-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    await api("ownerA", `${a}/products`, "POST", productInput("LIVE", true)); await api("ownerA", `${a}/products`, "POST", productInput("DRAFT", false));
    const otherWarehouse = await createWms(db).create(actors.ownerA, a, { kind: "warehouses" }, { code: "OTHER-WH", name: "Other warehouse" });
    const otherLocation = await db.wmsLocation.findFirstOrThrow({ where: { tenantId: a, warehouseId: otherWarehouse.id, isDefault: true } });
    await receiveProduct(a, actors.ownerA, otherWarehouse.id, otherLocation.id, wmsProductsA.LIVE, 20);
    const response = await handlePublicShop(new Request(`${baseURL}/api/shop/${slug}`), slug); const data = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(data.products).toHaveLength(1); expect(data.products[0]).toMatchObject({ code: "LIVE", price: "120.50", availableQuantity: 0 });
    expect(JSON.stringify(data)).not.toContain(a); expect((await handlePublicShop(new Request(`${baseURL}/api/shop/missing`), "missing")).status).toBe(404);
    const store = await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } }); await db.ecomStore.update({ where: { tenantId: a }, data: { isActive: false, version: { increment: 1 } } });
    expect((await handlePublicShop(new Request(`${baseURL}/api/shop/${store.slug}`), store.slug)).status).toBe(404);
  });
  it("validates price, currency, payload fields, version conflicts, CSRF and database ownership guards", async () => {
    expect((await api("ownerA", `${a}/store`, "POST", { ...storeInput("bad_slug"), tenantId: b })).status).toBe(400);
    expect((await api("ownerA", `${a}/store`, "POST", { ...storeInput("bad-currency"), currency: "XYZ" })).status).toBe(400);
    const slug = `valid-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    for (const price of ["-1", "1.234", "1e3", "01.00"]) expect((await api("ownerA", `${a}/products`, "POST", { ...productInput(`BAD${price.length}`), price })).status).toBe(400);
    const created = await (await api("ownerA", `${a}/products`, "POST", productInput("VERSION"))).json();
    expect((await api("ownerA", `${a}/products/${created.id}`, "PATCH", { ...productInput("VERSION"), version: 8 })).status).toBe(409);
    expect((await api("ownerA", `${a}/products`, "POST", productInput("CSRF"), { Origin: "https://attacker.example" })).status).toBe(403);
    await expect(db.ecomProduct.update({ where: { tenantId_storeId_id: { tenantId: a, storeId: (await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } })).id, id: created.id } }, data: { tenantId: b } })).rejects.toThrow();
    await expect(db.ecomProduct.delete({ where: { tenantId_storeId_id: { tenantId: a, storeId: (await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } })).id, id: created.id } } })).rejects.toThrow();
  });
  it("accepts guest orders with server prices, immutable snapshots, replay protection, and Owner-only reads", async () => {
    const slug = `checkout-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    const product = await (await api("ownerA", `${a}/products`, "POST", productInput("ORDER-1", true))).json();
    await receiveProduct(a, actors.ownerA, warehouseA, locationA, wmsProductsA["ORDER-1"], 2);
    const key = `${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}`;
    const submit = (body: unknown) => handlePublicCheckout(new Request(`${baseURL}/api/shop/${slug}/checkout`, { method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) }), slug);
    const body = { buyerName: "測試買家", buyerEmail: "buyer@example.test", lines: [{ productId: product.id, quantity: 2 }], price: "0.01", tenantId: b };
    expect((await submit(body)).status).toBe(400);
    const valid = { buyerName: "測試買家", buyerEmail: "buyer@example.test", lines: [{ productId: product.id, quantity: 2 }] };
    const response = await submit(valid), order = await response.json();
    expect(response.status).toBe(201); expect(order).toMatchObject({ status: "submitted", currency: "TWD", totalAmount: "241.00", replayed: false });
    expect(order).not.toHaveProperty("buyerEmail"); expect(order).not.toHaveProperty("tenantId"); expect(order).not.toHaveProperty("storeId"); expect(order.lines[0]).toMatchObject({ productCode: "ORDER-1", productName: "ORDER-1 product", unitPrice: "120.50", quantity: 2, lineTotal: "241.00" });
    const savedOrder = await db.ecomOrder.findFirstOrThrow({ where: { tenantId: a, orderNumber: order.orderNumber } });
    const replay = await submit(valid); expect(replay.status).toBe(200); expect((await replay.json())).toMatchObject({ orderNumber: order.orderNumber, replayed: true });
    expect((await submit({ ...valid, lines: [{ productId: product.id, quantity: 3 }] })).status).toBe(409);
    const store = await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } });
    const [ownerRead, memberRead, outsiderRead, otherTenantRead] = await Promise.all([
      api("ownerA", `${a}/orders`), api("member", `${a}/orders`), api("outsider", `${a}/orders`), api("ownerB", `${b}/orders`),
    ]);
    expect(ownerRead.status).toBe(200); expect((await ownerRead.json()).items[0]).toMatchObject({ id: savedOrder.id, buyerName: "測試買家", buyerEmail: "buyer@example.test" });
    expect(memberRead.status).toBe(403); expect(outsiderRead.status).toBe(404); expect(otherTenantRead.status).toBe(404);
    const [memberDetail, outsiderDetail, ownerDetail] = await Promise.all([api("member", `${a}/orders/${savedOrder.id}`), api("outsider", `${a}/orders/${savedOrder.id}`), api("ownerA", `${a}/orders/${savedOrder.id}`)]);
    expect(memberDetail.status).toBe(403); expect(outsiderDetail.status).toBe(404); expect((await ownerDetail.json()).buyerEmail).toBe("buyer@example.test");
    await api("ownerA", `${a}/products/${product.id}`, "PATCH", { ...productInput("ORDER-1", true), name: "Updated name", price: "999.99", version: 1 });
    const snapshot = await createEcommerceOrders(db).detail(actors.ownerA, a, savedOrder.id); expect(snapshot.lines[0]).toMatchObject({ productName: "ORDER-1 product", unitPrice: "120.50" });
    const audit = await db.tenantAudit.findFirstOrThrow({ where: { tenantId: a, targetId: savedOrder.id, action: "ecommerce.order.submitted" } });
    expect(audit.actorId).toBeNull(); expect(JSON.stringify(audit)).not.toContain("buyer@example.test");
    expect((await api("ownerA", `${a}/orders/${savedOrder.id}/fulfill`, "POST", { shipmentConfirmed: false })).status).toBe(400);
    expect((await api("member", `${a}/orders/${savedOrder.id}/fulfill`, "POST", { shipmentConfirmed: true })).status).toBe(403);
    expect((await api("ownerA", `${a}/orders/${savedOrder.id}/fulfill`, "POST", { shipmentConfirmed: true })).status).toBe(200);
    expect((await db.wmsStockReservation.findUniqueOrThrow({ where: { tenantId_sourceOrderId: { tenantId: a, sourceOrderId: savedOrder.id } } })).status).toBe("fulfilled");
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: wmsProductsA["ORDER-1"], warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(0);
    expect(store.id).toBe(savedOrder.storeId);
  });
  it("rejects unavailable or cross-store goods, invalid quantities and origins, and rolls failed order transactions back", async () => {
    const slug = `checkout-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    const published = await (await api("ownerA", `${a}/products`, "POST", productInput("LIVE-C", true))).json();
    const draft = await (await api("ownerA", `${a}/products`, "POST", productInput("DRAFT-C", false))).json();
    const foreignSlug = `checkout-${randomUUID()}`; await api("ownerB", `${b}/store`, "POST", storeInput(foreignSlug, b));
    const foreign = await (await api("ownerB", `${b}/products`, "POST", productInput("FOREIGN-C", true, b))).json();
    const call = (body: unknown, origin = baseURL) => handlePublicCheckout(new Request(`${baseURL}/api/shop/${slug}/checkout`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": `${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}` }, body: JSON.stringify(body) }), slug);
    for (const quantity of [0, 100, 1.2, "1"]) expect((await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity }] })).status).toBe(400);
    for (const id of [draft.id, foreign.id, randomUUID()]) expect((await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: id, quantity: 1 }] })).status).toBe(409);
    expect((await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity: 1 }, { productId: published.id, quantity: 1 }] })).status).toBe(400);
    expect((await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity: 1 }] }, "https://attacker.example")).status).toBe(403);
    const count = await db.ecomOrder.count({ where: { tenantId: a } });
    await expect(createEcommerceOrders(db).checkout(slug, `${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}`, { buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity: 1 }] }, "invalid-uuid")).rejects.toThrow();
    expect(await db.ecomOrder.count({ where: { tenantId: a } })).toBe(count);
    expect((await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity: 1 }] })).status).toBe(409);
    await receiveProduct(a, actors.ownerA, warehouseA, locationA, wmsProductsA["LIVE-C"], 2);
    const orderResponse = await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity: 1 }] }); const order = await orderResponse.json();
    const saved = await db.ecomOrder.findFirstOrThrow({ where: { tenantId: a, orderNumber: order.orderNumber }, include: { lines: true } });
    expect((await api("ownerA", `${a}/orders/${saved.id}/release`, "POST", { stockStillInWarehouseConfirmed: false })).status).toBe(400);
    expect((await api("ownerA", `${a}/orders/${saved.id}/release`, "POST", { stockStillInWarehouseConfirmed: true })).status).toBe(200);
    expect((await db.wmsStockReservation.findUniqueOrThrow({ where: { tenantId_sourceOrderId: { tenantId: a, sourceOrderId: saved.id } } })).status).toBe("released");
    await expect(db.ecomOrder.update({ where: { id: saved.id }, data: { totalAmount: "0" } })).rejects.toThrow();
    await expect(db.ecomOrderLine.update({ where: { id: saved.lines[0].id }, data: { productName: "tampered" } })).rejects.toThrow();
    await expect(db.ecomOrderLine.create({ data: { tenantId: a, storeId: saved.storeId, orderId: saved.id, productId: published.id, productCode: "LIVE-C", productName: "Extra line", quantity: 1, unitPrice: "1.00", lineTotal: "1.00" } })).rejects.toThrow();
    const liveStore = await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } });
    await expect(db.ecomOrder.create({ data: { tenantId: a, storeId: liveStore.id, orderNumber: `ECOM-${randomUUID()}`, currency: liveStore.currency, buyerName: "Guest", buyerEmail: "g@example.test", totalAmount: "10.00", idempotencyKeyHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), payloadHash: randomUUID().replaceAll("-", "").padEnd(64, "0") } })).rejects.toThrow();
    const store = await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } });
    const raceProduct = await (await api("ownerA", `${a}/products`, "POST", productInput("RACE-C", true))).json();
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; }); const resume = new Promise<void>(resolve => { release = resolve; });
    const unpublish = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${a}::uuid FOR UPDATE`;
      acquired(); await resume;
      await tx.ecomProduct.update({ where: { tenantId_storeId_id: { tenantId: a, storeId: store.id, id: raceProduct.id } }, data: { isPublished: false, version: { increment: 1 } } });
    });
    await locked;
    const waitingCheckout = createEcommerceOrders(db).checkout(slug, `${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}`, { buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: raceProduct.id, quantity: 1 }] });
    release(); await unpublish;
    await expect(waitingCheckout).rejects.toMatchObject({ status: 409, code: "products_unavailable" });
    await db.ecomStore.update({ where: { tenantId: a }, data: { isActive: false, version: { increment: 1 } } });
    expect((await call({ buyerName: "Guest", buyerEmail: "g@example.test", lines: [{ productId: published.id, quantity: 1 }] })).status).toBe(404);
    expect(store.isActive).toBe(true);
  });
  it("serializes two checkouts competing for the last WMS unit", async () => {
    const slug = `race-stock-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    const product = await (await api("ownerA", `${a}/products`, "POST", productInput("RACE-C", true))).json();
    await receiveProduct(a, actors.ownerA, warehouseA, locationA, wmsProductsA["RACE-C"], 1);
    const submit = (suffix: string) => handlePublicCheckout(new Request(`${baseURL}/api/shop/${slug}/checkout`, { method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json", "Idempotency-Key": `${randomUUID().replaceAll("-", "")}_${suffix}` }, body: JSON.stringify({ buyerName: "Race buyer", buyerEmail: `${suffix}@example.test`, lines: [{ productId: product.id, quantity: 1 }] }) }), slug);
    const results = await Promise.all([submit(randomUUID().replaceAll("-", "")), submit(randomUUID().replaceAll("-", ""))]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await db.wmsStockReservation.count({ where: { tenantId: a, status: "active" } })).toBe(1);
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: wmsProductsA["RACE-C"], warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(1);
  });
  it("records tenant-scoped payment attempts and append-only idempotent provider events", async () => {
    const slug = `payment-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    const product = await (await api("ownerA", `${a}/products`, "POST", productInput("PAYMENT", true))).json();
    await receiveProduct(a, actors.ownerA, warehouseA, locationA, wmsProductsA.PAYMENT, 2);
    const orderResult = await createEcommerceOrders(db).checkout(slug, `${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}`, { buyerName: "Payment buyer", buyerEmail: "payment@example.test", lines: [{ productId: product.id, quantity: 1 }] });
    const order = await db.ecomOrder.findFirstOrThrow({ where: { tenantId: a, orderNumber: orderResult.orderNumber } });
    const payments = createEcommercePayments(db), key = randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const attempt = await payments.createAttempt(actors.ownerA, a, order.id, "fake.test", key);
    expect(attempt).toMatchObject({ tenantId: a, orderId: order.id, amount: "120.50", currency: "TWD", status: "pending", replayed: false });
    expect((await payments.createAttempt(actors.ownerA, a, order.id, "fake.test", key)).replayed).toBe(true);
    await expect(payments.createAttempt(actors.member, a, order.id, "fake.test", randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""))).rejects.toMatchObject({ status: 403 });
    await expect(payments.createAttempt(actors.ownerB, a, order.id, "fake.test", randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""))).rejects.toMatchObject({ status: 404 });

    const event = (providerEventId: string, kind: "processing" | "succeeded" | "failed", tenantId = a) => ({
      tenantId, storeId: (attempt as { storeId: string }).storeId, orderId: order.id, attemptId: attempt.id,
      providerCode: "fake.test", providerEventId, providerTransactionId: "fake-transaction-001",
      kind, amount: "120.50", currency: "TWD", occurredAt: new Date(),
    });
    expect(await payments.applyVerifiedEvent(event("provider-event-1", "processing"))).toMatchObject({ status: "processing", replayed: false, stale: false });
    expect(await payments.applyVerifiedEvent(event("provider-event-2", "succeeded"))).toMatchObject({ status: "succeeded", replayed: false, stale: false });
    expect(await payments.applyVerifiedEvent(event("provider-event-2", "succeeded"))).toMatchObject({ status: "succeeded", replayed: true });
    expect(await payments.applyVerifiedEvent(event("provider-event-3", "processing"))).toMatchObject({ status: "succeeded", replayed: false, stale: true });
    await expect(payments.applyVerifiedEvent(event("provider-event-2", "failed"))).rejects.toMatchObject({ status: 409, code: "provider_event_conflict" });
    await expect(payments.applyVerifiedEvent({ ...event("provider-event-wrong-amount", "succeeded"), amount: "0.01" })).rejects.toMatchObject({ status: 409, code: "payment_amount_or_currency_mismatch" });
    await expect(payments.applyVerifiedEvent(event("provider-event-conflict", "failed"))).rejects.toMatchObject({ status: 409, code: "payment_terminal_conflict" });
    await expect(payments.applyVerifiedEvent(event("provider-event-cross-tenant", "succeeded", b))).rejects.toMatchObject({ status: 404 });
    expect((await db.ecomPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("succeeded");
    await expect(payments.createAttempt(actors.ownerA, a, order.id, "fake.test", randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""))).rejects.toMatchObject({ status: 409, code: "order_already_paid" });
    expect(await db.ecomPaymentEvent.count({ where: { tenantId: a, paymentAttemptId: attempt.id } })).toBe(3);
    const hashedEvent = await db.ecomPaymentEvent.findFirstOrThrow({ where: { tenantId: a, paymentAttemptId: attempt.id } });
    expect(hashedEvent.providerEventIdHash).not.toContain("provider-event");
    expect((await db.ecomOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("submitted");

    await expect(db.ecomPaymentAttempt.update({ where: { id: attempt.id }, data: { amount: "0.01" } })).rejects.toThrow();
    await expect(db.ecomPaymentAttempt.delete({ where: { id: attempt.id } })).rejects.toThrow();
    const savedEvent = await db.ecomPaymentEvent.findFirstOrThrow({ where: { tenantId: a, paymentAttemptId: attempt.id } });
    await expect(db.ecomPaymentEvent.update({ where: { id: savedEvent.id }, data: { kind: "failed" } })).rejects.toThrow();
    await expect(db.ecomPaymentEvent.delete({ where: { id: savedEvent.id } })).rejects.toThrow();
  });
  it("rolls back verified payment event and status when the audit write fails", async () => {
    const slug = `payment-rollback-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    const product = await (await api("ownerA", `${a}/products`, "POST", productInput("PAYMENT-ROLLBACK", true))).json();
    await receiveProduct(a, actors.ownerA, warehouseA, locationA, wmsProductsA["PAYMENT-ROLLBACK"], 1);
    const orderResult = await createEcommerceOrders(db).checkout(slug, `${randomUUID().replaceAll("-", "")}_${randomUUID().replaceAll("-", "")}`, { buyerName: "Payment buyer", buyerEmail: "payment@example.test", lines: [{ productId: product.id, quantity: 1 }] });
    const order = await db.ecomOrder.findFirstOrThrow({ where: { tenantId: a, orderNumber: orderResult.orderNumber } });
    const attempt = await createEcommercePayments(db).createAttempt(actors.ownerA, a, order.id, "fake.test", randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""));
    await expect(createEcommercePayments(db).applyVerifiedEvent({ tenantId: a, storeId: attempt.storeId, orderId: order.id, attemptId: attempt.id, providerCode: "fake.test", providerEventId: "rollback-event", kind: "succeeded", amount: "120.50", currency: "TWD", occurredAt: new Date() }, "invalid-request-id")).rejects.toThrow();
    expect((await db.ecomPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("pending");
    expect(await db.ecomPaymentEvent.count({ where: { tenantId: a, paymentAttemptId: attempt.id } })).toBe(0);
  });
  it("requires explicit restock opt-in, emails after WMS receipt, and supports unsubscribe", async () => {
    const slug = `restock-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    const product = await (await api("ownerA", `${a}/products`, "POST", productInput("LIVE-C", true))).json();
    const subscribe = (body: unknown, origin = baseURL) => handlePublicRestock(new Request(`${baseURL}/api/shop/${slug}/restock`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }), slug);
    expect((await subscribe({ productId: product.id, email: "notify@example.test", optIn: false })).status).toBe(400);
    expect((await subscribe({ productId: product.id, email: "notify@example.test", optIn: true }, "https://attacker.example")).status).toBe(403);
    expect((await subscribe({ productId: product.id, email: "notify@example.test", optIn: true })).status).toBe(202);
    expect(await db.ecomRestockSubscription.count({ where: { tenantId: a, storeId: (await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } })).id, productId: product.id, status: "active" } })).toBe(1);
    await receiveProduct(a, actors.ownerA, warehouseA, locationA, wmsProductsA["LIVE-C"], 1);
    runtime.mail.mockRejectedValueOnce(new Error("temporary SMTP failure"));
    await createRestockNotifications(db).notifyRestocked(a, warehouseA, [wmsProductsA["LIVE-C"]]);
    expect((await db.ecomRestockSubscription.findFirstOrThrow({ where: { tenantId: a, productId: product.id } })).status).toBe("active");
    await createRestockNotifications(db).notifyRestocked(a, warehouseA, [wmsProductsA["LIVE-C"]]);
    expect(runtime.mail).toHaveBeenCalledTimes(2);
    await createRestockNotifications(db).notifyRestocked(a, warehouseA, [wmsProductsA["LIVE-C"]]);
    expect(runtime.mail).toHaveBeenCalledTimes(2);
    const message = runtime.mail.mock.calls[1][0] as { to: string; subject: string; text: string };
    expect(message).toMatchObject({ to: "notify@example.test", subject: expect.stringContaining("商品到貨通知") });
    const token = message.text.match(/unsubscribe\?token=([A-Za-z0-9_-]{43})/)?.[1]; expect(token).toBeTruthy();
    const unsubscribe = await handlePublicRestock(new Request(`${baseURL}/api/shop/${slug}/restock/unsubscribe`, { method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json" }, body: JSON.stringify({ token }) }), slug, "unsubscribe");
    expect(unsubscribe.status).toBe(200);
    expect((await db.ecomRestockSubscription.findFirstOrThrow({ where: { tenantId: a, productId: product.id } })).status).toBe("unsubscribed");
  });
});
