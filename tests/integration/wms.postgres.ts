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
import { createTenancy, type Actor } from "../../src/server/tenancy/service";
import { createWms } from "../../src/server/wms/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database }));
import { handleWms } from "../../src/server/wms/api";

const baseURL = "http://localhost:3000", dbName = `wms_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false;
let a: string, b: string, pa: string, pb: string, wa: string, wb: string;
let service: ReturnType<typeof createWms>;
const actors: Record<string, Actor> = {}, cookies: Record<string, string> = {};
async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleWms(new Request(`${baseURL}/api/wms/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function pack(productId = pa, tenantId = a, owner = "ownerA") {
  return service.create(actors[owner], tenantId, { kind: "units", parentId: productId }, { code: "BOX20", name: "箱", factor: 20 });
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL); url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(migrated.status, "Migration failed; output suppressed").toBe(0);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] });
  const secret = randomUUID() + randomUUID();
  vi.stubEnv("BETTER_AUTH_URL", baseURL); vi.stubEnv("BETTER_AUTH_SECRET", secret); vi.stubEnv("DATABASE_URL", url.toString());
  vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("SMTP_PORT", "1025"); vi.stubEnv("SMTP_FROM", "noreply@example.test");
  const auth = createAuth({ baseURL, secret, databaseURL: url.toString(), smtp: { host: "localhost", port: 1025, secure: false, from: "noreply@example.test" } }, db, async () => {});
  runtime.auth.mockReturnValue(auth); runtime.database.mockReturnValue(db);
  const password = "Wms-test-only-password-623!", hash = await hashPassword(password);
  for (const name of ["ownerA", "ownerB", "member", "outsider"]) {
    const user = await db.user.create({ data: { name, email: `${name.toLowerCase()}@example.test`, emailVerified: true } }); actors[name] = user;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    const response = await auth.api.signInEmail({ body: { email: user.email, password }, headers: new Headers({ Origin: baseURL }), asResponse: true });
    expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  service = createWms(db);
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  a = (await db.tenant.create({ data: { name: "WMS tenant A", slug: `wa-${randomUUID()}` } })).id;
  b = (await db.tenant.create({ data: { name: "WMS tenant B", slug: `wb-${randomUUID()}` } })).id;
  await db.membership.createMany({ data: [{ tenantId: a, userId: actors.ownerA.id, role: "owner" }, { tenantId: a, userId: actors.member.id, role: "member" }, { tenantId: b, userId: actors.ownerB.id, role: "owner" }] });
  pa = (await service.create(actors.ownerA, a, { kind: "products" }, { code: "part-1", name: "A part", baseUnit: "個" })).id;
  pb = (await service.create(actors.ownerB, b, { kind: "products" }, { code: "part-1", name: "B part", baseUnit: "件" })).id;
  wa = (await service.create(actors.ownerA, a, { kind: "warehouses" }, { code: "site-1", name: "A site" })).id;
  wb = (await service.create(actors.ownerB, b, { kind: "warehouses" }, { code: "site-1", name: "B site" })).id;
});
afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  try { await db?.$disconnect(); } finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } }
});

describe("WMS master API with real signed sessions and PostgreSQL", () => {
  it("rejects anonymous or spoofed identity on reads, writes and conversions", async () => {
    const unit = await pack();
    for (const [path, method, body] of [[`${a}/products`, "GET", undefined], [`${a}/warehouses`, "POST", { code: "X", name: "X" }], [`${a}/products/${pa}`, "PATCH", { name: "X", version: 1 }], [`${a}/products/${pa}/convert`, "POST", { unitId: unit.id, quantity: 1 }]] as const) expect((await api("anonymous", path, method, body, { "x-user-id": actors.ownerA.id, "x-tenant-id": a })).status).toBe(401);
  });
  it("allows Member reads while denying every kind of master write", async () => {
    const unit = await pack();
    const location = await service.create(actors.ownerA, a, { kind: "locations", parentId: wa }, { code: "A-01", name: "Shelf" });
    for (const [path, id, body] of [[`${a}/products`, pa, { code: "X", name: "X", baseUnit: "個" }], [`${a}/warehouses`, wa, { code: "X", name: "X" }], [`${a}/products/${pa}/units`, unit.id, { code: "X", name: "X", factor: 2 }], [`${a}/warehouses/${wa}/locations`, location.id, { code: "X", name: "X" }]] as const) {
      expect((await api("member", path)).status).toBe(200); expect((await api("member", `${path}/${id}`)).status).toBe(200);
      expect((await api("member", path, "POST", body)).status).toBe(403); expect((await api("member", `${path}/${id}`, "PATCH", { name: "Changed", version: 1 })).status).toBe(403);
    }
  });
  it("isolates list/detail/create/update and foreign parent selectors", async () => {
    const unitB = await pack(pb, b, "ownerB");
    for (const path of [`${b}/products`, `${b}/products/${pb}`, `${b}/warehouses`, `${b}/warehouses/${wb}/locations`, `${a}/products/${pb}`, `${a}/products/${pb}/units`, `${a}/warehouses/${wb}/locations`, `${a}/products/${pa}/units/${unitB.id}`]) expect((await api("ownerA", path)).status).toBe(404);
    expect((await api("ownerA", `${b}/products`, "POST", { code: "X", name: "X", baseUnit: "個" })).status).toBe(404);
    expect((await api("ownerA", `${a}/products/${pb}/units`, "POST", { code: "X", name: "X", factor: 1 })).status).toBe(404);
    expect((await api("ownerA", `${a}/warehouses/${wb}/locations`, "POST", { code: "X", name: "X" })).status).toBe(404);
    expect((await api("ownerA", `${a}/products/${pa}/units/${unitB.id}`, "PATCH", { name: "X", version: 1 })).status).toBe(404);
    expect((await api("outsider", `${a}/products`)).status).toBe(404);
    const data = await (await api("ownerA", `${a}/products`)).json(); expect(data.total).toBe(1); expect(data.items[0].id).toBe(pa); expect(JSON.stringify(data)).not.toContain("B part");
  });
  it("atomically creates one default child per parent with scoped uppercase codes", async () => {
    const product = await (await api("ownerA", `${a}/products/${pa}`)).json(); expect(product.code).toBe("PART-1");
    const units = await (await api("member", `${a}/products/${pa}/units`)).json(); expect(units.total).toBe(1); expect(units.items[0]).toMatchObject({ code: "BASE", name: "個", factor: 1, isBase: true, isActive: true });
    const locations = await (await api("member", `${a}/warehouses/${wa}/locations`)).json(); expect(locations.total).toBe(1); expect(locations.items[0]).toMatchObject({ code: "UNASSIGNED", name: "未分配儲位", isDefault: true, isActive: true });
    expect((await api("ownerA", `${a}/warehouses`, "POST", { code: " site-1 ", name: "Duplicate" })).status).toBe(409);
    expect((await api("ownerA", `${a}/products`, "POST", { code: "PART-1", name: "Duplicate", baseUnit: "台" })).status).toBe(409);
    expect(await db.wmsWarehouse.count({ where: { tenantId: a } })).toBe(1); expect(await db.wmsLocation.count({ where: { tenantId: a } })).toBe(1);
  });
  it("allows the same location/unit code under separate same-tenant parents", async () => {
    const second = await service.create(actors.ownerA, a, { kind: "warehouses" }, { code: "SITE-2", name: "Second" });
    const la = await service.create(actors.ownerA, a, { kind: "locations", parentId: wa }, { code: "A-01", name: "Shelf" });
    const lb = await service.create(actors.ownerA, a, { kind: "locations", parentId: second.id }, { code: "A-01", name: "Shelf" });
    expect((await api("ownerA", `${a}/warehouses/${wa}/locations/${lb.id}`)).status).toBe(404);
    expect((await api("ownerA", `${a}/warehouses/${second.id}/locations/${la.id}`, "PATCH", { name: "Moved", version: 1 })).status).toBe(404);
    expect((await api("ownerA", `${a}/warehouses/${wa}/locations`, "POST", { code: "A-01", name: "Duplicate" })).status).toBe(409);
    const secondProduct = await service.create(actors.ownerA, a, { kind: "products" }, { code: "PART-2", name: "Second", baseUnit: "個" });
    const u = await pack(); const other = await pack(secondProduct.id);
    expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: other.id, quantity: 2 })).status).toBe(404);
    expect((await api("ownerA", `${a}/products/${pa}/units`, "POST", { code: "box20", name: "Dup", factor: 30 })).status).toBe(409);
    expect(u.id).not.toBe(other.id);
  });
  it("rejects reserved codes, invalid inputs, forged fields and noninteger factors", async () => {
    for (const body of [{ code: "Bad space", name: "X" }, { code: "X", name: " " }, { code: "X".repeat(41), name: "X" }, { code: "X", name: "X".repeat(121) }, { code: "X", name: "X", tenantId: b }, [], null]) expect((await api("ownerA", `${a}/warehouses`, "POST", body)).status).toBe(400);
    expect((await api("ownerA", `${a}/products`, "POST", { code: "NEW", name: "X" })).status).toBe(400);
    expect((await api("ownerA", `${a}/products`, "POST", { code: "NEW", name: "X", baseUnit: "x".repeat(21) })).status).toBe(400);
    for (const factor of [0, -1, 0.5, "20", null, 1000001]) expect((await api("ownerA", `${a}/products/${pa}/units`, "POST", { code: "TEST", name: "箱", factor })).status).toBe(400);
    expect((await api("ownerA", `${a}/products/${pa}/units`, "POST", { code: "base", name: "X", factor: 1 })).status).toBe(400);
    expect((await api("ownerA", `${a}/warehouses/${wa}/locations`, "POST", { code: "unassigned", name: "X" })).status).toBe(400);
    expect((await api("ownerA", `${a}/warehouses`, "POST", { code: "X", name: "x".repeat(9000) })).status).toBe(413);
  });
  it("protects default children and disallows identity or conversion edits", async () => {
    const base = await db.wmsProductUnit.findFirstOrThrow({ where: { tenantId: a, productId: pa, isBase: true } });
    const location = await db.wmsLocation.findFirstOrThrow({ where: { tenantId: a, warehouseId: wa, isDefault: true } });
    for (const [path, body] of [[`${a}/products/${pa}`, { code: "NEW", version: 1 }], [`${a}/products/${pa}`, { baseUnit: "箱", version: 1 }], [`${a}/products/${pa}/units/${base.id}`, { factor: 20, version: 1 }], [`${a}/warehouses/${wa}/locations/${location.id}`, { warehouseId: wb, version: 1 }]] as const) expect((await api("ownerA", path, "PATCH", body)).status).toBe(400);
    for (const path of [`${a}/products/${pa}/units/${base.id}`, `${a}/warehouses/${wa}/locations/${location.id}`]) expect((await api("ownerA", path, "PATCH", { isActive: false, version: 1 })).status).toBe(409);
    expect((await api("ownerA", `${a}/products/${pa}`, "DELETE")).status).toBe(405);
  });
  it("handles exact conversion, integer limits and different SKU ratios without writing", async () => {
    const unit = await pack(); const auditBefore = await db.tenantAudit.count({ where: { tenantId: a } });
    const response = await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: unit.id, quantity: 2 }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ baseQuantity: 40, baseUnit: "個", factor: 20, unitVersion: 1 });
    const unitB = await service.create(actors.ownerB, b, { kind: "units", parentId: pb }, { code: "BOX20", name: "箱", factor: 50 });
    expect(await (await api("ownerB", `${b}/products/${pb}/convert`, "POST", { unitId: unitB.id, quantity: 2 })).json()).toMatchObject({ baseQuantity: 100, factor: 50 });
    for (const quantity of [0, -1, 0.5, "2", 2147483648, 107374183]) expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: unit.id, quantity })).status).toBe(400);
    expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: unit.id, quantity: 2, factor: 1 })).status).toBe(400);
    const base = await db.wmsProductUnit.findFirstOrThrow({ where: { productId: pa, isBase: true } });
    expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: base.id, quantity: 2147483647 })).status).toBe(200);
    expect(await db.tenantAudit.count({ where: { tenantId: a } })).toBe(auditBefore);
  });
  it("blocks operations on inactive parents or units and retains immutable retired ratios", async () => {
    const unit = await pack();
    expect((await api("ownerA", `${a}/products/${pa}/units/${unit.id}`, "PATCH", { isActive: false, version: 1 })).status).toBe(200);
    expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: unit.id, quantity: 1 })).status).toBe(409);
    const replacement = await service.create(actors.ownerA, a, { kind: "units", parentId: pa }, { code: "BOX30", name: "箱", factor: 30 });
    expect((await db.wmsProductUnit.findUniqueOrThrow({ where: { id: unit.id } })).factor).toBe(20);
    expect((await api("ownerA", `${a}/products/${pa}`, "PATCH", { isActive: false, version: 1 })).status).toBe(200);
    expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: replacement.id, quantity: 1 })).status).toBe(409);
    expect((await api("ownerA", `${a}/products/${pa}/units`, "POST", { code: "NEW", name: "包", factor: 2 })).status).toBe(409);
    expect((await api("ownerA", `${a}/products/${pa}/units/${replacement.id}`, "PATCH", { name: "改", version: 1 })).status).toBe(409);
    expect((await api("member", `${a}/products/${pa}/units`)).status).toBe(200);
    await service.update(actors.ownerA, a, { kind: "warehouses" }, wa, { isActive: false, version: 1 });
    expect((await api("ownerA", `${a}/warehouses/${wa}/locations`, "POST", { code: "NEW", name: "New" })).status).toBe(409);
    expect((await api("ownerA", `${a}/products/${pa}`, "PATCH", { isActive: true, version: 2 })).status).toBe(200);
    expect((await api("member", `${a}/products/${pa}/convert`, "POST", { unitId: replacement.id, quantity: 1 })).status).toBe(200);
  });
  it("rejects version conflicts and serializes competing renames", async () => {
    const results = await Promise.all(["First", "Second"].map(name => api("ownerA", `${a}/warehouses/${wa}`, "PATCH", { name, version: 1 })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await db.wmsWarehouse.findUniqueOrThrow({ where: { id: wa } })).version).toBe(2);
    for (const version of [0, 1.2, "1", null, 2147483647]) expect((await api("ownerA", `${a}/warehouses/${wa}`, "PATCH", { name: "Bad", version })).status).toBe(400);
    expect((await api("ownerA", `${a}/warehouses/${wa}`, "PATCH", { version: 2 })).status).toBe(400);
    expect((await api("ownerA", `${a}/warehouses/${wa}`, "PATCH", { isActive: "false", version: 2 })).status).toBe(400);
  });
  it("enforces uniqueness for concurrent creates without orphan defaults", async () => {
    const responses = await Promise.all([1, 2].map(() => api("ownerA", `${a}/warehouses`, "POST", { code: "CONCURRENT", name: "Site" })));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const warehouse = await db.wmsWarehouse.findFirstOrThrow({ where: { tenantId: a, code: "CONCURRENT" } });
    expect(await db.wmsLocation.count({ where: { warehouseId: warehouse.id } })).toBe(1);
  });
  it("paginates both parent and child lists and rejects invalid routing/CSRF", async () => {
    await pack();
    const first = await (await api("member", `${a}/products/${pa}/units?limit=1`)).json();
    const second = await (await api("member", `${a}/products/${pa}/units?limit=1&offset=1`)).json();
    expect(first.total).toBe(2); expect(first.items[0].id).not.toBe(second.items[0].id); expect((await api("member", `${a}/products`)).headers.get("cache-control")).toBe("no-store");
    for (const path of [`${a}/products?limit=101`, `${a}/products?offset=-1`]) expect((await api("ownerA", path)).status).toBe(400);
    for (const path of ["bad/products", `${a}/missing`, `${a}/products/${pa}/locations`, `${a}/warehouses/${wa}/convert`, `${a}/products/${pa}/units/${randomUUID()}/extra`]) expect((await api("ownerA", path)).status).toBe(404);
    const invalidHeaders: Record<string, string>[] = [{ Origin: "https://attacker.example" }, { Origin: "" }, { "sec-fetch-site": "cross-site" }, { "Content-Type": "text/plain" }];
    for (const headers of invalidHeaders) expect((await api("ownerA", `${a}/warehouses`, "POST", { code: "X", name: "X" }, headers)).status).toBe(403);
    expect((await handleWms(new Request(`${baseURL}/api/wms/${a}/warehouses`, { method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json", Cookie: cookies.ownerA }, body: "{" }))).status).toBe(400);
  });
  it("rechecks revoked access and disabled tenant using existing sessions", async () => {
    await createTenancy(db, async () => {}, baseURL).changeMember(actors.ownerA, a, actors.member.id, { isActive: false });
    expect((await api("member", `${a}/products`)).status).toBe(404);
    await db.tenant.update({ where: { id: a }, data: { isActive: false } });
    expect((await api("ownerA", `${a}/warehouses`)).status).toBe(404);
    await db.user.update({ where: { id: actors.ownerB.id }, data: { emailVerified: false } });
    try { expect((await api("ownerB", `${b}/products`)).status).toBe(401); } finally { await db.user.update({ where: { id: actors.ownerB.id }, data: { emailVerified: true } }); }
  });
  it("uses DB composite FKs, checks and guards to retain identity/defaults", async () => {
    const unit = await pack(); const base = await db.wmsProductUnit.findFirstOrThrow({ where: { productId: pa, isBase: true } });
    const location = await db.wmsLocation.findFirstOrThrow({ where: { warehouseId: wa, isDefault: true } });
    await expect(db.wmsProductUnit.create({ data: { tenantId: a, productId: pb, code: "BAD", name: "Bad", factor: 1 } })).rejects.toThrow();
    await expect(db.wmsLocation.create({ data: { tenantId: a, warehouseId: wb, code: "BAD", name: "Bad" } })).rejects.toThrow();
    await expect(db.wmsProductUnit.update({ where: { id: unit.id }, data: { factor: 50 } })).rejects.toThrow();
    await expect(db.wmsProduct.update({ where: { id: pa }, data: { baseUnit: "箱" } })).rejects.toThrow();
    await expect(db.wmsProduct.update({ where: { id: pa }, data: { tenantId: b } })).rejects.toThrow();
    await expect(db.wmsProductUnit.update({ where: { id: base.id }, data: { name: "Changed" } })).rejects.toThrow();
    await expect(db.wmsLocation.delete({ where: { id: location.id } })).rejects.toThrow();
    await expect(db.wmsProductUnit.create({ data: { tenantId: a, productId: pa, code: "ZERO", name: "Bad", factor: 0 } })).rejects.toThrow();
    await expect(db.wmsWarehouse.create({ data: { tenantId: a, code: "lower", name: "Bad" } })).rejects.toThrow();
    await expect(db.wmsWarehouse.create({ data: { tenantId: a, code: "EMPTY", name: " " } })).rejects.toThrow();
    await expect(db.wmsWarehouse.update({ where: { id: wa }, data: { version: 0 } })).rejects.toThrow();
  });
  it("rolls back parent/default creation and updates when audit fails, logs no payload", async () => {
    const parentBefore = await db.wmsWarehouse.count({ where: { tenantId: a } }), childBefore = await db.wmsLocation.count({ where: { tenantId: a } });
    await expect(service.create(actors.ownerA, a, { kind: "warehouses" }, { code: "ROLLBACK", name: "Private name" }, "invalid-uuid")).rejects.toThrow();
    expect(await db.wmsWarehouse.count({ where: { tenantId: a } })).toBe(parentBefore); expect(await db.wmsLocation.count({ where: { tenantId: a } })).toBe(childBefore);
    const productsBefore = await db.wmsProduct.count({ where: { tenantId: a } });
    await expect(service.create(actors.ownerA, a, { kind: "products" }, { code: "ROLLBACK", name: "Private", baseUnit: "個" }, "invalid-uuid")).rejects.toThrow();
    expect(await db.wmsProduct.count({ where: { tenantId: a } })).toBe(productsBefore);
    await expect(service.update(actors.ownerA, a, { kind: "warehouses" }, wa, { name: "Private failed rename", version: 1 }, "invalid-uuid")).rejects.toThrow();
    expect((await db.wmsWarehouse.findUniqueOrThrow({ where: { id: wa } })).version).toBe(1);
    const response = await api("ownerA", `${a}/warehouses/${wa}`, "PATCH", { name: "Private payload", version: 1 }); expect(response.status).toBe(200);
    const audit = await db.tenantAudit.findFirstOrThrow({ where: { tenantId: a, targetId: wa, action: "wms.warehouse.updated" } });
    expect(audit.requestId).toBe(response.headers.get("x-request-id")); expect(JSON.stringify(audit)).not.toContain("Private payload"); expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("Private payload");
  });
});
