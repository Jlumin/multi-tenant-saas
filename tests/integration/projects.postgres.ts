import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Tenant, type Project } from "../../src/generated/prisma/client";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/server/auth/create-auth";
import { createTenancy, type Actor } from "../../src/server/tenancy/service";
import { createProjects } from "../../src/server/projects/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database }));
import { handleProjects } from "../../src/server/projects/api";

const baseURL = "http://localhost:3000";
const dbName = `projects_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false;
let a: Tenant, b: Tenant, projectA: Project, projectB: Project;
let service: ReturnType<typeof createProjects>;
const actors: Record<string, Actor> = {}, cookies: Record<string, string> = {};
async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleProjects(new Request(`${baseURL}/api/projects/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
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
  const password = "Projects-test-only-password-623!", hash = await hashPassword(password);
  for (const name of ["ownerA", "ownerB", "member", "outsider"]) {
    const user = await db.user.create({ data: { name, email: `${name.toLowerCase()}@example.test`, emailVerified: true } }); actors[name] = user;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    const response = await auth.api.signInEmail({ body: { email: user.email, password }, headers: new Headers({ Origin: baseURL }), asResponse: true });
    expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  service = createProjects(db);
});
beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  a = await db.tenant.create({ data: { name: "Project tenant A", slug: `pa-${randomUUID()}` } });
  b = await db.tenant.create({ data: { name: "Project tenant B", slug: `pb-${randomUUID()}` } });
  await db.membership.createMany({ data: [{ tenantId: a.id, userId: actors.ownerA.id, role: "owner" }, { tenantId: a.id, userId: actors.member.id, role: "member" }, { tenantId: b.id, userId: actors.ownerB.id, role: "owner" }] });
  projectA = await db.project.create({ data: { tenantId: a.id, name: "A private", createdBy: actors.ownerA.id } });
  projectB = await db.project.create({ data: { tenantId: b.id, name: "B private", createdBy: actors.ownerB.id } });
});
afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  try { await db?.$disconnect(); } finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } }
});

describe("Project API using real signed sessions and PostgreSQL", () => {
  it("rejects anonymous and forged identities for every CRUD method", async () => {
    for (const [method, path, body] of [["GET", a.id, undefined], ["GET", `${a.id}/${projectA.id}`, undefined], ["POST", a.id, { name: "Spoofed" }], ["PATCH", `${a.id}/${projectA.id}`, { name: "Spoofed", version: 1 }], ["DELETE", `${a.id}/${projectA.id}`, { version: 1 }]] as const) {
      expect((await api("anonymous", path, method, body, { "x-user-id": actors.ownerA.id, "x-tenant-id": a.id })).status).toBe(401);
    }
  });
  it("scopes every list/detail/create/update/delete to a real membership", async () => {
    for (const user of ["ownerA", "member", "outsider"]) {
      for (const [method, path, body] of [["GET", b.id, undefined], ["GET", `${b.id}/${projectB.id}`, undefined], ["POST", b.id, { name: "Wrong tenant" }], ["PATCH", `${b.id}/${projectB.id}`, { name: "Wrong", version: 1 }], ["DELETE", `${b.id}/${projectB.id}`, { version: 1 }]] as const) expect((await api(user, path, method, body)).status).toBe(404);
    }
    const list = await (await api("ownerA", a.id)).json();
    expect(list.total).toBe(1); expect(list.items[0].id).toBe(projectA.id); expect(JSON.stringify(list)).not.toContain(projectB.name);
    for (const method of ["GET", "PATCH", "DELETE"]) expect((await api("ownerA", `${a.id}/${projectB.id}`, method, method === "GET" ? undefined : { name: "Wrong", version: 1 })).status).toBe(method === "DELETE" ? 400 : 404);
    expect((await api("ownerA", `${a.id}/${projectB.id}`, "DELETE", { version: 1 })).status).toBe(404);
    expect((await api("outsider", a.id)).status).toBe(404);
  });
  it("lets Members create/update, trusts server creator and forbids their delete", async () => {
    const response = await api("member", a.id, "POST", { name: "  Member project  ", description: "Details" });
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    const project = await response.json(); expect(project.name).toBe("Member project"); expect(project.createdBy).toBe(actors.member.id);
    const updated = await api("member", `${a.id}/${project.id}`, "PATCH", { name: "Edited", description: "Changed", version: 1 });
    expect(updated.status).toBe(200); expect((await updated.json()).version).toBe(2);
    expect((await api("member", `${a.id}/${project.id}`, "DELETE", { version: 2 })).status).toBe(403);
  });
  it("rejects untrusted fields, invalid names/descriptions/versions and oversized payloads", async () => {
    for (const body of [{ name: "", description: "" }, { name: "   " }, { name: "x".repeat(121) }, { name: "Valid", description: "x".repeat(2001) }, { name: "Valid", tenantId: b.id }, { name: "Valid", createdBy: actors.ownerB.id }, [], null]) expect((await api("ownerA", a.id, "POST", body)).status).toBe(400);
    expect((await api("ownerA", a.id, "POST", { name: "Valid", description: "x".repeat(17000) })).status).toBe(413);
    for (const version of [0, -1, 1.5, "1", null, 2147483647]) expect((await api("ownerA", `${a.id}/${projectA.id}`, "PATCH", { name: "Edit", version })).status).toBe(400);
    expect((await api("ownerA", `${a.id}/${projectA.id}`, "PATCH", { name: "Edit", version: 1, deletedAt: null })).status).toBe(400);
  });
  it("rejects CSRF origins, missing JSON, malformed JSON and invalid routes/paging", async () => {
    const invalidHeaders: Record<string, string>[] = [{ Origin: "https://attacker.example" }, { Origin: "" }, { "sec-fetch-site": "cross-site" }, { "Content-Type": "text/plain" }, { "Content-Type": "application/json-malicious" }];
    for (const extra of invalidHeaders) expect((await api("ownerA", a.id, "POST", { name: "Blocked" }, extra)).status).toBe(403);
    expect((await handleProjects(new Request(`${baseURL}/api/projects/${a.id}`, { method: "POST", headers: { Origin: baseURL, "Content-Type": "application/json", Cookie: cookies.ownerA }, body: "{" }))).status).toBe(400);
    for (const path of [`${a.id}?limit=101`, `${a.id}?offset=-1`, `${a.id}?limit=1.5`]) expect((await api("ownerA", path)).status).toBe(400);
    expect((await api("ownerA", "bad-id")).status).toBe(404);
    expect((await api("ownerA", `${a.id}/${projectA.id}/extra`)).status).toBe(404);
    expect((await api("ownerA", a.id, "DELETE", { version: 1 })).status).toBe(405);
  });
  it("paginates without duplicates and excludes other tenants", async () => {
    await service.create(actors.member, a.id, { name: "Second", description: "" });
    const first = await (await api("member", `${a.id}?limit=1`)).json();
    const second = await (await api("member", `${a.id}?limit=1&offset=1`)).json();
    expect(first.total).toBe(2); expect(second.total).toBe(2); expect(first.items[0].id).not.toBe(second.items[0].id);
    expect((await (await api("member", `${a.id}?offset=2`)).json()).items).toEqual([]);
  });
  it("soft deletes only with Owner, hides the record and prevents replay or resurrection", async () => {
    expect((await api("ownerA", `${a.id}/${projectA.id}`, "DELETE", { version: 1 })).status).toBe(200);
    const stored = await db.project.findUniqueOrThrow({ where: { id: projectA.id } }); expect(stored.deletedAt).not.toBeNull(); expect(stored.name).toBe("A private");
    expect((await (await api("ownerA", a.id)).json()).total).toBe(0);
    for (const method of ["GET", "PATCH", "DELETE"]) expect((await api("ownerA", `${a.id}/${projectA.id}`, method, method === "GET" ? undefined : method === "PATCH" ? { name: "Restore", version: 2 } : { version: 2 })).status).toBe(404);
    await expect(db.project.update({ where: { id: projectA.id }, data: { deletedAt: null } })).rejects.toThrow();
  });
  it("rejects stale update/delete and concurrent writers without lost updates", async () => {
    const responses = await Promise.all(["One", "Two"].map(name => api("member", `${a.id}/${projectA.id}`, "PATCH", { name, version: 1 })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await api("ownerA", `${a.id}/${projectA.id}`, "DELETE", { version: 1 })).status).toBe(409);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectA.id } })).version).toBe(2);
    expect(await db.tenantAudit.count({ where: { tenantId: a.id, action: "project.updated" } })).toBe(1);
  });
  it("rechecks revoked membership, tenant and user verification for existing sessions", async () => {
    await createTenancy(db, async () => {}, baseURL).changeMember(actors.ownerA, a.id, actors.member.id, { isActive: false });
    expect((await api("member", a.id)).status).toBe(404); expect((await api("member", a.id, "POST", { name: "Denied" })).status).toBe(404);
    await db.tenant.update({ where: { id: a.id }, data: { isActive: false } });
    expect((await api("ownerA", `${a.id}/${projectA.id}`)).status).toBe(404);
    await db.user.update({ where: { id: actors.ownerA.id }, data: { emailVerified: false } });
    try { expect((await api("ownerA", a.id)).status).toBe(401); } finally { await db.user.update({ where: { id: actors.ownerA.id }, data: { emailVerified: true } }); }
  });
  it("retains creator history after membership disable and rejects cross-tenant creator FK", async () => {
    const project = await service.create(actors.member, a.id, { name: "History", description: "" });
    await createTenancy(db, async () => {}, baseURL).changeMember(actors.ownerA, a.id, actors.member.id, { isActive: false });
    expect((await api("ownerA", `${a.id}/${project.id}`)).status).toBe(200);
    await expect(db.project.create({ data: { tenantId: a.id, createdBy: actors.ownerB.id, name: "Wrong creator" } })).rejects.toThrow();
    await expect(db.project.create({ data: { tenantId: a.id, createdBy: actors.ownerA.id, name: "  " } })).rejects.toThrow();
    await expect(db.project.update({ where: { id: projectA.id }, data: { version: 0 } })).rejects.toThrow();
    await expect(db.project.update({ where: { id: projectA.id }, data: { tenantId: b.id, createdBy: actors.ownerB.id } })).rejects.toThrow();
  });
  it("writes metadata-only audit and atomically rolls back when audit cannot be recorded", async () => {
    const secretName = "Private project payload";
    const response = await api("ownerA", a.id, "POST", { name: secretName, description: "Private notes" }); const project = await response.json();
    const audit = await db.tenantAudit.findFirstOrThrow({ where: { tenantId: a.id, targetId: project.id, action: "project.created" } });
    expect(audit.actorId).toBe(actors.ownerA.id); expect(audit.requestId).toBe(response.headers.get("x-request-id")); expect(JSON.stringify(audit)).not.toContain(secretName);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(secretName);
    const count = await db.project.count({ where: { tenantId: a.id } });
    await expect(service.create(actors.ownerA, a.id, { name: "Rollback", description: "" }, "invalid-uuid")).rejects.toThrow();
    expect(await db.project.count({ where: { tenantId: a.id } })).toBe(count);
    await expect(service.update(actors.ownerA, a.id, projectA.id, { name: "Rollback update", description: "" }, 1, "invalid-uuid")).rejects.toThrow();
    await expect(service.remove(actors.ownerA, a.id, projectA.id, 1, "invalid-uuid")).rejects.toThrow();
    const unchanged = await db.project.findUniqueOrThrow({ where: { id: projectA.id } }); expect(unchanged.name).toBe("A private"); expect(unchanged.version).toBe(1); expect(unchanged.deletedAt).toBeNull();
  });
});
