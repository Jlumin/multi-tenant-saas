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
import { type Actor } from "../../src/server/tenancy/service";
import { createWms } from "../../src/server/wms/service";
import { createStock } from "../../src/server/wms/stock-service";
import { createStockCounts } from "../../src/server/wms/count-service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database }));
import { handleStock } from "../../src/server/wms/stock-api";

const baseURL = "http://localhost:3000", dbName = `wms_stock_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false;
let a: string, b: string, productA: string, productB: string, warehouseA: string, warehouseA2: string, warehouseB: string, locationA: string, locationA2: string, locationB: string, unitA: string, baseA: string;
let stock: ReturnType<typeof createStock>, counts: ReturnType<typeof createStockCounts>, masters: ReturnType<typeof createWms>;
const actors: Record<string, Actor> = {}, cookies: Record<string, string> = {};
async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleStock(new Request(`${baseURL}/api/wms-stock/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function draft(type: "inbound" | "outbound" = "inbound", user = "ownerA", tenantId = a, warehouseId = warehouseA, productId = productA, locationId = locationA, unitId = unitA, quantity = 1) {
  return stock.createDraft(actors[user], tenantId, type, { warehouseId, lines: [{ productId, locationId, unitId, quantity }] });
}
async function post(doc: { id: string; version: number }, key = `key-${randomUUID()}`, user = "ownerA", tenantId = a, requestId: string = randomUUID()) {
  return stock.post(actors[user], tenantId, doc.id, doc.version, key, requestId);
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL }); await admin.connect(); await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL); url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(migrated.status, "Migration failed; output suppressed").toBe(0);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] });
  const secret = randomUUID() + randomUUID();
  vi.stubEnv("BETTER_AUTH_URL", baseURL); vi.stubEnv("BETTER_AUTH_SECRET", secret); vi.stubEnv("DATABASE_URL", url.toString());
  vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("SMTP_PORT", "1025"); vi.stubEnv("SMTP_FROM", "noreply@example.test");
  const auth = createAuth({ baseURL, secret, databaseURL: url.toString(), smtp: { host: "localhost", port: 1025, secure: false, from: "noreply@example.test" } }, db, async () => {});
  runtime.auth.mockReturnValue(auth); runtime.database.mockReturnValue(db);
  const password = "Wms-stock-test-only-password-623!", hash = await hashPassword(password);
  for (const name of ["ownerA", "ownerB", "member", "outsider"]) {
    const user = await db.user.create({ data: { name, email: `${name.toLowerCase()}@example.test`, emailVerified: true } }); actors[name] = user;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    const response = await auth.api.signInEmail({ body: { email: user.email, password }, headers: new Headers({ Origin: baseURL }), asResponse: true });
    expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  stock = createStock(db); counts = createStockCounts(db); masters = createWms(db);
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  a = (await db.tenant.create({ data: { name: "Stock tenant A", slug: `sa-${randomUUID()}` } })).id;
  b = (await db.tenant.create({ data: { name: "Stock tenant B", slug: `sb-${randomUUID()}` } })).id;
  await db.membership.createMany({ data: [{ tenantId: a, userId: actors.ownerA.id, role: "owner" }, { tenantId: a, userId: actors.member.id, role: "member" }, { tenantId: b, userId: actors.ownerB.id, role: "owner" }] });
  productA = (await masters.create(actors.ownerA, a, { kind: "products" }, { code: "PART-A", name: "Part A", baseUnit: "個" })).id;
  productB = (await masters.create(actors.ownerB, b, { kind: "products" }, { code: "PART-B", name: "Part B", baseUnit: "個" })).id;
  warehouseA = (await masters.create(actors.ownerA, a, { kind: "warehouses" }, { code: "WH-A", name: "Warehouse A" })).id;
  warehouseA2 = (await masters.create(actors.ownerA, a, { kind: "warehouses" }, { code: "WH-A2", name: "Warehouse A2" })).id;
  warehouseB = (await masters.create(actors.ownerB, b, { kind: "warehouses" }, { code: "WH-B", name: "Warehouse B" })).id;
  locationA = (await db.wmsLocation.findFirstOrThrow({ where: { tenantId: a, warehouseId: warehouseA, isDefault: true } })).id;
  locationA2 = (await db.wmsLocation.findFirstOrThrow({ where: { tenantId: a, warehouseId: warehouseA2, isDefault: true } })).id;
  locationB = (await db.wmsLocation.findFirstOrThrow({ where: { tenantId: b, warehouseId: warehouseB, isDefault: true } })).id;
  unitA = (await masters.create(actors.ownerA, a, { kind: "units", parentId: productA }, { code: "BOX20", name: "箱", factor: 20 })).id;
  baseA = (await db.wmsProductUnit.findFirstOrThrow({ where: { tenantId: a, productId: productA, isBase: true } })).id;
});
afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  try { await db?.$disconnect(); } finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } }
});

describe("WMS stock documents and ledger using real sessions and PostgreSQL", () => {
  it("refuses anonymous, forged, non-member, and Member posting", async () => {
    const doc = await draft();
    expect((await api("anonymous", `${a}/documents`)).status).toBe(401);
    expect((await api("anonymous", `${a}/documents`, "POST", { type: "inbound" }, { "x-user-id": actors.ownerA.id })).status).toBe(401);
    expect((await api("outsider", `${a}/documents`)).status).toBe(404);
    expect((await api("member", `${a}/documents/${doc.id}/post`, "POST", { version: 1 }, { "Idempotency-Key": `key-${randomUUID()}` })).status).toBe(403);
    expect((await api("ownerA", `${a}/documents/${doc.id}/post`, "POST", { version: 1 }, { "Sec-Fetch-Site": "cross-site", "Idempotency-Key": `key-${randomUUID()}` })).status).toBe(403);
  });
  it("lets Members create, edit, list and cancel drafts without stock changes", async () => {
    const response = await api("member", `${a}/documents`, "POST", { type: "inbound", warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: unitA, quantity: 2 }] });
    expect(response.status).toBe(201); const doc = await response.json();
    expect(doc).toMatchObject({ type: "inbound", status: "draft", version: 1, lines: [{ quantity: 2, factor: 20, baseQuantity: 40, baseUnit: "個", unitCode: "BOX20" }] });
    expect((await api("member", `${a}/documents?type=inbound&status=draft`)).status).toBe(200);
    const updated = await stock.updateDraft(actors.member, a, doc.id, 1, { memo: "檢查後收貨" }); expect(updated.version).toBe(2); expect(updated.memo).toBe("檢查後收貨");
    expect((await api("member", `${a}/documents/${doc.id}`, "PATCH", { version: 1, memo: "stale" })).status).toBe(409);
    const cancelled = await stock.cancelDraft(actors.member, a, doc.id, 2); expect(cancelled.status).toBe("cancelled");
    expect(await db.wmsStockBalance.count({ where: { tenantId: a } })).toBe(0);
    expect(await db.wmsStockMovement.count({ where: { tenantId: a } })).toBe(0);
  });
  it("posts inbound atomically, records snapshots and replays only the same idempotency key", async () => {
    const doc = await draft("inbound", "member", a, warehouseA, productA, locationA, unitA, 3);
    const key = `retry-${randomUUID()}`;
    const posted = await post(doc, key); expect(posted.status).toBe("posted"); expect(posted.version).toBe(2);
    const repeated = await post(doc, key); expect(repeated.id).toBe(doc.id);
    expect(await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).toMatchObject({ quantity: 60 });
    expect(await db.wmsStockMovement.count({ where: { tenantId: a, documentId: doc.id } })).toBe(1);
    expect((await api("member", `${a}/documents/${doc.id}`, "PATCH", { version: 2, memo: "edit posted" })).status).toBe(409);
    expect((await api("ownerA", `${a}/documents/${doc.id}/cancel`, "POST", { version: 2 })).status).toBe(409);
    await expect(post(doc, key, "ownerA", b)).rejects.toMatchObject({ status: 404 });
  });
  it("rejects negative stock and resolves concurrent outbound posts without overselling", async () => {
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 10); await post(receipt);
    const [first, second] = await Promise.all([draft("outbound", "member", a, warehouseA, productA, locationA, baseA, 7), draft("outbound", "member", a, warehouseA, productA, locationA, baseA, 7)]);
    const results = await Promise.allSettled([post(first, `first-${randomUUID()}`), post(second, `second-${randomUUID()}`)]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(item => item.status === "rejected"); expect(rejected).toMatchObject({ status: "rejected", reason: { code: "insufficient_stock" } });
    const balance = await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } });
    expect(balance.quantity).toBe(3); expect(await db.wmsStockMovement.count({ where: { tenantId: a, delta: { lt: 0 } } })).toBe(1);
    expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: rejected && "reason" in rejected ? (results[1].status === "rejected" ? second.id : first.id) : first.id } })).status).toBe("draft");
  });
  it("rolls back every line when one item lacks stock", async () => {
    const itemB = await masters.create(actors.ownerA, a, { kind: "products" }, { code: "PART-C", name: "Part C", baseUnit: "個" });
    const baseB = await db.wmsProductUnit.findFirstOrThrow({ where: { tenantId: a, productId: itemB.id, isBase: true } });
    const receipt = await stock.createDraft(actors.ownerA, a, "inbound", { warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: baseA, quantity: 5 }] }); await post(receipt);
    const outbound = await stock.createDraft(actors.ownerA, a, "outbound", { warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: baseA, quantity: 2 }, { productId: itemB.id, locationId: locationA, unitId: baseB.id, quantity: 1 }] });
    await expect(post(outbound)).rejects.toMatchObject({ code: "insufficient_stock" });
    expect(await db.wmsStockMovement.count({ where: { tenantId: a, documentId: outbound.id } })).toBe(0);
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(5);
    expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: outbound.id } })).status).toBe("draft");
  });
  it("posts cross-warehouse transfers atomically and keeps tenant quantity unchanged", async () => {
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 10); await post(receipt);
    const response = await api("member", `${a}/documents`, "POST", { type: "transfer", warehouseId: warehouseA, destinationWarehouseId: warehouseA2, lines: [{ productId: productA, locationId: locationA, targetLocationId: locationA2, unitId: baseA, quantity: 4 }] });
    expect(response.status).toBe(201); const transfer = await response.json();
    expect(transfer).toMatchObject({ type: "transfer", status: "draft", destinationWarehouseId: warehouseA2, lines: [{ locationId: locationA, targetWarehouseId: warehouseA2, targetLocationId: locationA2, baseQuantity: 4 }] });
    expect((await api("member", `${a}/documents/${transfer.id}/post`, "POST", { version: 1 }, { "Idempotency-Key": `member-${randomUUID()}` })).status).toBe(403);
    const transferKey = `transfer-${randomUUID()}`; await post(transfer, transferKey);
    await expect(post(transfer, transferKey)).resolves.toMatchObject({ id: transfer.id, status: "posted" });
    expect(await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).toMatchObject({ quantity: 6 });
    expect(await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA2, locationId: locationA2 } } })).toMatchObject({ quantity: 4 });
    expect(await db.wmsStockMovement.findMany({ where: { tenantId: a, documentId: transfer.id }, orderBy: { delta: "asc" } })).toMatchObject([{ delta: -4, warehouseId: warehouseA, locationId: locationA }, { delta: 4, warehouseId: warehouseA2, locationId: locationA2 }]);
    await expect(post(transfer, `replay-${randomUUID()}`)).rejects.toMatchObject({ code: "document_not_postable" });
  });
  it("supports same-warehouse relocation and rejects insufficient or foreign transfer targets", async () => {
    const physical = await masters.create(actors.ownerA, a, { kind: "locations", parentId: warehouseA }, { code: "A-01", name: "架位 A-01" });
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 5); await post(receipt);
    const relocation = await stock.createDraft(actors.member, a, "transfer", { warehouseId: warehouseA, destinationWarehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, targetLocationId: physical.id, unitId: baseA, quantity: 2 }] });
    await post(relocation);
    expect(await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).toMatchObject({ quantity: 3 });
    expect(await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: physical.id } } })).toMatchObject({ quantity: 2 });
    const lowStock = await stock.createDraft(actors.ownerA, a, "transfer", { warehouseId: warehouseA, destinationWarehouseId: warehouseA2, lines: [{ productId: productA, locationId: locationA, targetLocationId: locationA2, unitId: baseA, quantity: 10 }] });
    await expect(post(lowStock)).rejects.toMatchObject({ code: "insufficient_stock" });
    expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: lowStock.id } })).status).toBe("draft");
    expect(await api("ownerA", `${a}/documents`, "POST", { type: "transfer", warehouseId: warehouseA, destinationWarehouseId: warehouseB, lines: [{ productId: productA, locationId: locationA, targetLocationId: locationB, unitId: baseA, quantity: 1 }] })).toMatchObject({ status: 404 });
    expect((await api("ownerA", `${a}/documents`, "POST", { type: "transfer", warehouseId: warehouseA, destinationWarehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, targetLocationId: locationA, unitId: baseA, quantity: 1 }] })).status).toBe(400);
  });
  it("isolates tenant document, balances, movement lists and parent resources", async () => {
    const docB = await draft("inbound", "ownerB", b, warehouseB, productB, locationB, baseA, 1).catch(() => null);
    expect(docB).toBeNull();
    const foreignWarehouse = await api("ownerA", `${a}/documents`, "POST", { type: "inbound", warehouseId: warehouseB, lines: [{ productId: productA, locationId: locationA, unitId: baseA, quantity: 1 }] });
    expect(foreignWarehouse.status).toBe(404);
    expect((await api("ownerA", `${b}/documents`)).status).toBe(404);
    expect((await api("ownerA", `${a}/balances`)).status).toBe(200);
    expect((await api("outsider", `${a}/movements`)).status).toBe(404);
  });
  it("rejects invalid integers, foreign fields, malformed requests, CSRF and invalid paths", async () => {
    for (const qty of [0, -1, 0.5, "1", 2147483648, 107374183]) expect((await api("ownerA", `${a}/documents`, "POST", { type: "inbound", warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: unitA, quantity: qty }] })).status).toBe(400);
    expect((await api("ownerA", `${a}/documents`, "POST", { type: "inbound", warehouseId: warehouseA, tenantId: b, lines: [{ productId: productA, locationId: locationA, unitId: unitA, quantity: 1 }] })).status).toBe(400);
    expect((await api("ownerA", `${a}/documents`, "POST", { type: "other", warehouseId: warehouseA, lines: [] })).status).toBe(400);
    expect((await api("ownerA", `${a}/documents`, "POST", { type: "outbound", warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: unitA, quantity: 1 }] }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await api("ownerA", `${a}/documents`, "POST", { type: "inbound", warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: unitA, quantity: 1 }] }, { "Content-Type": "text/plain" })).status).toBe(403);
    expect((await api("ownerA", `${a}/unknown`)).status).toBe(404);
    expect((await api("ownerA", `${a}/documents?limit=1000`)).status).toBe(400);
    expect((await api("ownerA", `${a}/documents`, "POST", { type: "inbound", warehouseId: warehouseA, lines: [] }, { "Idempotency-Key": "unused" })).status).toBe(400);
  });
  it("rejects changed/reused keys and requires an idempotency key for posts", async () => {
    const doc = await draft();
    expect((await api("ownerA", `${a}/documents/${doc.id}/post`, "POST", { version: 1 })).status).toBe(400);
    const key = `reuse-${randomUUID()}`; await post(doc, key);
    const other = await draft();
    await expect(post(other, key)).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(stock.post(actors.ownerA, a, doc.id, 2, key, randomUUID())).resolves.toMatchObject({ id: doc.id, status: "posted" });
  });
  it("enforces immutable posted documents, lines and movement ledger in PostgreSQL", async () => {
    const doc = await draft(); await post(doc);
    await expect(db.wmsStockMovement.updateMany({ where: { tenantId: a, documentId: doc.id }, data: { delta: 0 } })).rejects.toThrow();
    await expect(db.wmsStockMovement.deleteMany({ where: { tenantId: a, documentId: doc.id } })).rejects.toThrow();
    await expect(db.wmsDocumentLine.deleteMany({ where: { tenantId: a, documentId: doc.id } })).rejects.toThrow();
    await expect(db.wmsDocument.update({ where: { tenantId_id: { tenantId: a, id: doc.id } }, data: { memo: "rewrite", version: { increment: 1 } } })).rejects.toThrow();
  });
  it("rejects master deactivation with stock and preserves audit rollback", async () => {
    const doc = await draft(); await post(doc);
    await expect(masters.update(actors.ownerA, a, { kind: "products" }, productA, { isActive: false, version: 1 })).rejects.toThrow();
    const emptyReceipt = await draft();
    await expect(post(emptyReceipt, `rollback-${randomUUID()}`, "ownerA", a, "not-a-uuid")).rejects.toThrow();
    expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: emptyReceipt.id } })).status).toBe("draft");
    expect(await db.wmsStockMovement.count({ where: { tenantId: a, documentId: emptyReceipt.id } })).toBe(0);
  });
  it("keeps unit conversion snapshots and blocks stale drafts until refreshed", async () => {
    const doc = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, unitA, 2);
    await masters.update(actors.ownerA, a, { kind: "units", parentId: productA }, unitA, { name: "大箱", version: 1 });
    await expect(post(doc)).rejects.toMatchObject({ code: "unit_changed" });
    const updated = await stock.updateDraft(actors.member, a, doc.id, 1, { lines: [{ productId: productA, locationId: locationA, unitId: unitA, quantity: 2 }] });
    expect(updated.lines[0]).toMatchObject({ unitName: "大箱", factor: 20, unitVersion: 2, baseQuantity: 40 });
    await post(updated);
  });
  it("rolls back document status, ledger and balance when the movement insert fails", async () => {
    const doc = await draft();
    await expect(post(doc, `rollback-${randomUUID()}`, "ownerA", a, "not-a-uuid")).rejects.toThrow();
    expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("draft");
    expect(await db.wmsStockMovement.count({ where: { tenantId: a, documentId: doc.id } })).toBe(0);
    expect(await db.wmsStockBalance.count({ where: { tenantId: a } })).toBe(0);
  });
  it("rolls back both transfer legs and document status when PostgreSQL rejects the audit insert", async () => {
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 6); await post(receipt);
    const doc = await stock.createDraft(actors.ownerA, a, "transfer", { warehouseId: warehouseA, destinationWarehouseId: warehouseA2, lines: [{ productId: productA, locationId: locationA, targetLocationId: locationA2, unitId: baseA, quantity: 2 }] });
    await db.$executeRaw`CREATE FUNCTION wms_test_reject_post_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'wms.transfer.posted' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$`;
    await db.$executeRaw`CREATE TRIGGER wms_test_reject_post_audit BEFORE INSERT ON tenant_audit FOR EACH ROW EXECUTE FUNCTION wms_test_reject_post_audit()`;
    try {
      await expect(post(doc)).rejects.toThrow();
      expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("draft");
      expect(await db.wmsStockMovement.count({ where: { tenantId: a, documentId: doc.id } })).toBe(0);
      expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(6);
      expect(await db.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA2, locationId: locationA2 } } })).toBeNull();
    } finally {
      await db.$executeRaw`DROP TRIGGER wms_test_reject_post_audit ON tenant_audit`;
      await db.$executeRaw`DROP FUNCTION wms_test_reject_post_audit()`;
    }
  });
  it("keeps basic balance and movement queries tenant-scoped and paged", async () => {
    const first = await draft(); await post(first); const second = await draft(); await post(second);
    const balances = await api("member", `${a}/balances?productId=${productA}&limit=1`); expect((await balances.json()).total).toBe(1);
    const moves = await api("member", `${a}/movements?warehouseId=${warehouseA}&limit=1&offset=0`), firstPage = await moves.json();
    expect(firstPage).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(firstPage.items[0]).toMatchObject({ document: { number: second.number, type: "inbound" }, product: { code: "PART-A" }, line: { baseUnit: "個", baseQuantity: 20 } });
    const secondPage = await (await api("member", `${a}/movements?warehouseId=${warehouseA}&limit=1&offset=1`)).json();
    expect(secondPage.total).toBe(2); expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
    const detail = await api("member", `${a}/movements/${firstPage.items[0].id}`);
    expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ document: { number: second.number }, line: { baseUnit: "個", baseQuantity: 20 } });
    expect((await api("outsider", `${a}/movements/${firstPage.items[0].id}`)).status).toBe(404);
    expect((await api("ownerA", `${b}/movements/${firstPage.items[0].id}`)).status).toBe(404);
    expect((await (await api("member", `${a}/movements?productId=${productB}`)).json()).total).toBe(0);
    const foreign = await api("ownerA", `${a}/balances?productId=${productB}`); expect((await foreign.json()).total).toBe(0);
    await db.membership.update({ where: { tenantId_userId: { tenantId: a, userId: actors.member.id } }, data: { isActive: false } });
    expect((await api("member", `${a}/balances`)).status).toBe(404);
  });
  it("permits one opening balance per product location and reverses only when stock allows", async () => {
    const openingResponse = await api("member", `${a}/documents`, "POST", { type: "opening", warehouseId: warehouseA, memo: "系統啟用", lines: [{ productId: productA, locationId: locationA, unitId: baseA, quantity: 5 }] });
    expect(openingResponse.status).toBe(201); const opening = await openingResponse.json();
    await post(opening);
    const duplicate = await stock.createDraft(actors.ownerA, a, "opening", { warehouseId: warehouseA, lines: [{ productId: productA, locationId: locationA, unitId: baseA, quantity: 1 }] });
    await expect(post(duplicate)).rejects.toMatchObject({ code: "opening_not_empty" });
    const sale = await draft("outbound", "ownerA", a, warehouseA, productA, locationA, baseA, 2); await post(sale);
    await expect(stock.reverse(actors.ownerA, a, opening.id, "期初輸入錯誤", `reversing-${randomUUID()}`, randomUUID())).rejects.toMatchObject({ code: "insufficient_stock" });
    expect((await db.wmsDocument.findUniqueOrThrow({ where: { id: opening.id } })).status).toBe("posted");
    const amount = await stock.reverse(actors.ownerA, a, sale.id, "出庫單據錯誤", `reverse-${randomUUID()}`, randomUUID());
    expect(amount).toMatchObject({ type: "inbound", reversalOfId: sale.id, status: "posted" });
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(5);
    const key = `reverse-${randomUUID()}`, reversedOpening = await stock.reverse(actors.ownerA, a, opening.id, "撤銷期初", key, randomUUID());
    await expect(stock.reverse(actors.ownerA, a, opening.id, "撤銷期初", key, randomUUID())).resolves.toMatchObject({ id: reversedOpening.id, status: "posted" });
    await expect(stock.reverse(actors.ownerA, a, opening.id, "不同原因", `reverse-${randomUUID()}`, randomUUID())).rejects.toMatchObject({ code: "already_reversed" });
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(0);
  });
  it("reverses a transfer as a paired opposite transfer without changing tenant totals", async () => {
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 8); await post(receipt);
    const transfer = await stock.createDraft(actors.ownerA, a, "transfer", { warehouseId: warehouseA, destinationWarehouseId: warehouseA2, lines: [{ productId: productA, locationId: locationA, targetLocationId: locationA2, unitId: baseA, quantity: 3 }] }); await post(transfer);
    const reversal = await stock.reverse(actors.ownerA, a, transfer.id, "放錯倉", `reverse-${randomUUID()}`, randomUUID());
    expect(reversal).toMatchObject({ type: "transfer", warehouseId: warehouseA2, destinationWarehouseId: warehouseA, reversalOfId: transfer.id });
    expect(await db.wmsStockMovement.count({ where: { tenantId: a, documentId: reversal.id } })).toBe(2);
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(8);
    expect((await db.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA2, locationId: locationA2 } } }))?.quantity).toBe(0);
    await expect(stock.reverse(actors.member, a, receipt.id, "不可沖銷", `reverse-${randomUUID()}`, randomUUID())).rejects.toMatchObject({ code: "owner_required" });
    expect((await api("ownerB", `${a}/documents/${transfer.id}/reverse`, "POST", { reason: "跨租戶" }, { "Idempotency-Key": `reverse-${randomUUID()}` })).status).toBe(404);
  });
  it("counts a warehouse snapshot, posts only its differences and reverses the adjustment", async () => {
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 10); await post(receipt);
    const count = await counts.start(actors.member, a, warehouseA, "年度盤點");
    expect(count).toMatchObject({ status: "draft", snapshotRevision: expect.any(String), lines: [{ snapshotQuantity: 10, countedQuantity: null, product: { code: "PART-A" } }] });
    await expect(counts.get(actors.ownerB, b, count.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(counts.post(actors.member, a, count.id, count.version, `count-${randomUUID()}`, randomUUID())).rejects.toMatchObject({ code: "owner_required" });
    const counted = await counts.setLine(actors.member, a, count.id, count.lines[0].id, count.version, 8, "短少兩個");
    const key = `count-${randomUUID()}`, posted = await counts.post(actors.ownerA, a, count.id, counted.version, key, randomUUID());
    expect(posted).toMatchObject({ status: "posted", lines: [{ snapshotQuantity: 10, countedQuantity: 8, reason: "短少兩個" }], adjustmentDocument: { status: "posted" } });
    await expect(counts.post(actors.ownerA, a, count.id, counted.version, key, randomUUID())).resolves.toMatchObject({ status: "posted" });
    const adjustment = await db.wmsDocument.findFirstOrThrow({ where: { tenantId: a, stockCountId: count.id }, include: { lines: true } });
    expect(adjustment.lines).toMatchObject([{ adjustmentDelta: -2, baseQuantity: 2 }]);
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(8);
    const reversal = await stock.reverse(actors.ownerA, a, adjustment.id, "盤點輸入錯誤", `reverse-${randomUUID()}`, randomUUID());
    expect(reversal.type).toBe("adjustment");
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(10);
  });
  it("rejects incomplete counts and marks snapshots stale after any warehouse movement", async () => {
    const receipt = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 4); await post(receipt);
    const incomplete = await counts.start(actors.ownerA, a, warehouseA);
    await expect(counts.post(actors.ownerA, a, incomplete.id, incomplete.version, `count-${randomUUID()}`, randomUUID())).rejects.toMatchObject({ code: "count_incomplete" });
    const count = await counts.setLine(actors.member, a, incomplete.id, incomplete.lines[0].id, incomplete.version, 0);
    const newer = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 1); await post(newer);
    const result = await counts.post(actors.ownerA, a, count.id, count.version, `count-${randomUUID()}`, randomUUID());
    expect(result).toMatchObject({ status: "stale", stale: true });
    expect(await db.wmsDocument.count({ where: { tenantId: a, type: "adjustment", stockCountId: count.id } })).toBe(0);
    expect((await db.wmsStockBalance.findUniqueOrThrow({ where: { tenantId_productId_warehouseId_locationId: { tenantId: a, productId: productA, warehouseId: warehouseA, locationId: locationA } } })).quantity).toBe(5);
    const apiCount = await api("ownerA", `${a}/counts`, "POST", { warehouseId: warehouseA }); expect(apiCount.status).toBe(201); const apiDraft = await apiCount.json();
    const apiCounted = await api("member", `${a}/counts/${apiDraft.id}/lines/${apiDraft.lines[0].id}`, "PATCH", { version: 1, countedQuantity: 5, reason: "API count" }); expect(apiCounted.status).toBe(200);
    const apiNewer = await draft("inbound", "ownerA", a, warehouseA, productA, locationA, baseA, 1); await post(apiNewer);
    const apiStale = await api("ownerA", `${a}/counts/${apiDraft.id}/post`, "POST", { version: 2 }, { "Idempotency-Key": `count-${randomUUID()}` });
    expect(apiStale.status).toBe(409); expect((await apiStale.json()).status).toBe("stale");
  });
});
