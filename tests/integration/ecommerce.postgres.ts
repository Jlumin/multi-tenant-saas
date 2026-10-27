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
import { type Actor } from "../../src/server/tenancy/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database }));
import { handleEcommerce } from "../../src/server/ecommerce/api";
import { handlePublicShop } from "../../src/server/ecommerce/public-api";

const baseURL = "http://localhost:3000", dbName = `ecom_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false; let a: string, b: string;
const actors: Record<string, Actor> = {}, cookies: Record<string, string> = {};
async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleEcommerce(new Request(`${baseURL}/api/ecommerce/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL }); await admin.connect(); await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL); url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(migrated.status, "Migration failed; output suppressed").toBe(0);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] }); const secret = randomUUID() + randomUUID();
  vi.stubEnv("BETTER_AUTH_URL", baseURL); vi.stubEnv("BETTER_AUTH_SECRET", secret); vi.stubEnv("DATABASE_URL", url.toString()); vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("SMTP_PORT", "1025"); vi.stubEnv("SMTP_FROM", "noreply@example.test");
  const auth = createAuth({ baseURL, secret, databaseURL: url.toString(), smtp: { host: "localhost", port: 1025, secure: false, from: "noreply@example.test" } }, db, async () => {}); runtime.auth.mockReturnValue(auth); runtime.database.mockReturnValue(db);
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
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); try { await db?.$disconnect(); } finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } } });

describe("E-Commerce store and catalog with signed sessions and PostgreSQL", () => {
  const storeInput = (slug: string) => ({ name: "A Store", slug, currency: "TWD" });
  const productInput = (code: string, isPublished = false) => ({ code, name: `${code} product`, description: "Public description", price: "120.50", isPublished });
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
    const storeB = await (await api("ownerB", `${b}/store`, "POST", storeInput(`shop-${randomUUID()}`))).json();
    expect((await api("ownerB", `${b}/store`, "POST", storeInput(slug))).status).toBe(409);
    const createdProduct = await api("ownerA", `${a}/products`, "POST", productInput("PART-1", true)); expect(createdProduct.status).toBe(201);
    expect((await api("ownerB", `${b}/products`, "POST", productInput("PART-1"))).status).toBe(201);
    expect((await api("ownerA", `${b}/products`)).status).toBe(404);
    const product = await createdProduct.json();
    expect((await api("ownerA", `${a}/products/${product.id}`)).status).toBe(200);
    expect((await api("member", `${a}/products/${product.id}`)).status).toBe(200);
    expect((await api("ownerB", `${b}/products/${createdProduct.headers.get("x-request-id")}`, "PATCH", { ...productInput("OTHER"), version: 1 })).status).toBe(404);
    expect((await api("ownerB", `${b}/products/${product.id}`)).status).toBe(404);
    expect((await api("ownerA", `${a}/products`, "POST", productInput("PART-1"))).status).toBe(409);
    const audit = await db.tenantAudit.findFirstOrThrow({ where: { tenantId: a, targetId: product.id, action: "ecommerce.product.created" } });
    expect(audit.requestId).toBe(createdProduct.headers.get("x-request-id")); expect(JSON.stringify(audit)).not.toContain("Public description");
    const before = await db.ecomProduct.count({ where: { tenantId: a } });
    await expect(createEcommerce(db).createProduct(actors.ownerA, a, productInput("ROLLBACK"), "invalid-uuid")).rejects.toThrow();
    expect(await db.ecomProduct.count({ where: { tenantId: a } })).toBe(before);
    const store = await db.ecomStore.findUniqueOrThrow({ where: { tenantId: a } });
    expect((await api("ownerA", `${a}/store`, "PATCH", { name: store.name, currency: "USD", isActive: true, version: store.version })).status).toBe(409);
    await expect(db.ecomProduct.create({ data: { tenantId: a, storeId: storeB.id, createdById: actors.ownerA.id, code: "BAD-FOREIGN", name: "Foreign store", price: "1.00" } })).rejects.toThrow();
    expect(storeA.slug).toBe(slug);
  });
  it("publicly returns only published products for active store, without tenant selector", async () => {
    const slug = `public-${randomUUID()}`; await api("ownerA", `${a}/store`, "POST", storeInput(slug));
    await api("ownerA", `${a}/products`, "POST", productInput("LIVE", true)); await api("ownerA", `${a}/products`, "POST", productInput("DRAFT", false));
    const response = await handlePublicShop(new Request(`${baseURL}/api/shop/${slug}`), slug); const data = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(data.products).toHaveLength(1); expect(data.products[0]).toMatchObject({ code: "LIVE", price: "120.50" });
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
});
