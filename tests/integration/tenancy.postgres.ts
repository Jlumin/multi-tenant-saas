import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Tenant } from "../../src/generated/prisma/client";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/server/auth/create-auth";
import { createTenancy, type Actor } from "../../src/server/tenancy/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn(), mail: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database, deliverMail: runtime.mail }));
import { handleTenancy } from "../../src/server/tenancy/api";

const baseURL = "http://localhost:3000";
const dbName = `tenancy_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client;
let db: PrismaClient;
let created = false;
let service: ReturnType<typeof createTenancy>;
let a: Tenant;
let b: Tenant;
const actors: Record<string, Actor> = {};
const cookies: Record<string, string> = {};
const mails: { to: string; text: string }[] = [];

function token() { return new URL(mails.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!; }
async function api(user: string, path = "", method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleTenancy(new Request(`${baseURL}/api/tenancy${path ? `/${path}` : ""}`, {
    method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
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
  const password = "Tenant-test-only-password-623!";
  const hash = await hashPassword(password);
  for (const name of ["ownerA", "ownerB", "member", "outsider", "invitee", "otherOwner"]) {
    const user = await db.user.create({ data: { name, email: `${name.toLowerCase()}@example.test`, emailVerified: true } });
    actors[name] = user;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    // Real Better Auth server API creates the signed, DB-backed session. No fake user headers.
    const response = await auth.api.signInEmail({ body: { email: user.email, password }, headers: new Headers({ Origin: baseURL }), asResponse: true });
    expect(response.status).toBe(200);
    cookies[name] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  }
  service = createTenancy(db, runtime.mail, baseURL);
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  runtime.mail.mockReset().mockImplementation(async message => { mails.push(message); }); mails.length = 0;
  a = await db.tenant.create({ data: { name: "Fictional A", slug: `a-${randomUUID()}` } });
  b = await db.tenant.create({ data: { name: "Fictional B", slug: `b-${randomUUID()}` } });
  await db.membership.createMany({ data: [
    { tenantId: a.id, userId: actors.ownerA.id, role: "owner" },
    { tenantId: a.id, userId: actors.member.id, role: "member" },
    { tenantId: b.id, userId: actors.ownerB.id, role: "owner" },
  ] });
});

afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  try { await db?.$disconnect(); }
  finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } }
});

describe("tenant API with real Better Auth sessions and PostgreSQL", () => {
  it("rejects anonymous/spoofed identity and has no public tenant creation route", async () => {
    expect((await api("anonymous", "", "GET", undefined, { "x-user-id": actors.ownerA.id, "x-tenant-id": a.id })).status).toBe(401);
    expect((await api("ownerA", "", "POST", { name: "Public tenant" })).status).toBe(404);
  });

  it("lists only joined tenants and checks single-object tenant scope", async () => {
    const response = await api("ownerA"); const data = await response.json();
    expect(data.items.some((item: { tenant: { id: string } }) => item.tenant.id === a.id)).toBe(true);
    expect(data.items.some((item: { tenant: { id: string } }) => item.tenant.id === b.id)).toBe(false);
    for (const path of [b.id, `${b.id}/members`, `${b.id}/invitations`, `${b.id}/audit`]) expect((await api("ownerA", path)).status).toBe(404);
    expect((await api("outsider", a.id)).status).toBe(404);
    expect((await api("ownerA", `${a.id}/members/${actors.ownerB.id}`, "PATCH", { role: "member" })).status).toBe(404);
    expect((await api("member", a.id)).status).toBe(200);
  });

  it("Member cannot manage users, invitations or audit", async () => {
    for (const path of ["members", "invitations", "audit"]) expect((await api("member", `${a.id}/${path}`)).status).toBe(403);
    expect((await api("member", `${a.id}/invitations`, "POST", { email: actors.invitee.email })).status).toBe(403);
    expect((await api("member", `${a.id}/members/${actors.member.id}`, "PATCH", { role: "owner" })).status).toBe(403);
  });

  it("rejects foreign origin, forged tenant body and invalid roles/pagination", async () => {
    expect((await api("ownerA", `${a.id}/invitations`, "POST", { email: actors.invitee.email }, { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await api("ownerA", `${a.id}/invitations`, "POST", { email: actors.invitee.email, tenantId: b.id })).status).toBe(400);
    expect((await api("ownerA", `${a.id}/invitations`, "POST", { email: "Display<invitee@example.test>" })).status).toBe(400);
    expect((await api("ownerA", `${a.id}/members/${actors.member.id}`, "PATCH", { role: "superadmin" })).status).toBe(400);
    expect((await api("ownerA", "?limit=101")).status).toBe(400);
    expect((await api("ownerA", `${b.id}/invitations`, "POST", { email: actors.invitee.email })).status).toBe(404);
  });

  it("stores only invitation hash and requires the matching verified recipient", async () => {
    const response = await api("ownerA", `${a.id}/invitations`, "POST", { email: actors.invitee.email.toUpperCase() });
    expect(response.status).toBe(201); const entry = await response.json(); const raw = token();
    expect(JSON.stringify(entry)).not.toContain(raw); expect(entry.tokenHash).toBeUndefined();
    const stored = await db.invitation.findUniqueOrThrow({ where: { id: entry.id } });
    expect(stored.tokenHash).toHaveLength(64); expect(stored.tokenHash).not.toBe(raw);
    expect((await api("outsider", "accept", "POST", { token: raw })).status).toBe(400);
    expect((await api("invitee", "accept", "POST", { token: raw })).status).toBe(200);
    expect((await api("invitee", a.id)).status).toBe(200);
    expect((await api("invitee", "accept", "POST", { token: raw })).status).toBe(400);
  });

  it("rejects expired/revoked/reissued tokens and cross-tenant revoke", async () => {
    const first = await service.invite(actors.ownerA, a.id, actors.invitee.email, "member"); const old = token();
    const second = await service.invite(actors.ownerA, a.id, actors.invitee.email, "member"); const current = token();
    expect((await api("invitee", "accept", "POST", { token: old })).status).toBe(400);
    expect((await api("ownerB", `${b.id}/invitations/${first.id}`, "POST", {})).status).toBe(404);
    await db.invitation.update({ where: { id: second.id }, data: { expiresAt: new Date(0) } });
    expect((await api("invitee", "accept", "POST", { token: current })).status).toBe(400);
    const third = await service.invite(actors.ownerA, a.id, actors.invitee.email, "member"); const revoked = token();
    expect((await api("ownerA", `${a.id}/invitations/${third.id}`, "POST", {})).status).toBe(200);
    expect((await api("invitee", "accept", "POST", { token: revoked })).status).toBe(400);
  });

  it("grants Owner only through an explicit valid invitation and can re-invite disabled members", async () => {
    await service.invite(actors.ownerA, a.id, actors.invitee.email, "owner");
    expect((await api("invitee", "accept", "POST", { token: token() })).status).toBe(200);
    expect((await api("invitee", `${a.id}/members`)).status).toBe(200);
    await service.changeMember(actors.ownerA, a.id, actors.member.id, { isActive: false });
    await service.invite(actors.ownerA, a.id, actors.member.email, "member");
    expect((await api("member", "accept", "POST", { token: token() })).status).toBe(200);
    expect((await api("member", a.id)).status).toBe(200);
    expect((await api("member", `${a.id}/members`)).status).toBe(403);
  });

  it("serializes concurrent invite acceptance and preserves one active membership", async () => {
    await service.invite(actors.ownerA, a.id, actors.invitee.email, "member"); const raw = token();
    const responses = await Promise.all([api("invitee", "accept", "POST", { token: raw }), api("invitee", "accept", "POST", { token: raw })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
    expect(await db.membership.count({ where: { tenantId: a.id, userId: actors.invitee.id } })).toBe(1);
  });

  it("protects the last owner including concurrent self-demotions", async () => {
    expect((await api("ownerA", `${a.id}/members/${actors.ownerA.id}`, "PATCH", { isActive: false })).status).toBe(409);
    await db.membership.create({ data: { tenantId: a.id, userId: actors.otherOwner.id, role: "owner" } });
    const responses = await Promise.all([
      api("ownerA", `${a.id}/members/${actors.ownerA.id}`, "PATCH", { role: "member" }),
      api("otherOwner", `${a.id}/members/${actors.otherOwner.id}`, "PATCH", { role: "member" }),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await db.membership.count({ where: { tenantId: a.id, role: "owner", isActive: true } })).toBe(1);
  });

  it("revocation is immediate and stale invitations cannot restore demoted authority", async () => {
    await service.invite(actors.ownerA, a.id, actors.invitee.email, "owner"); const raw = token();
    await db.membership.create({ data: { tenantId: a.id, userId: actors.otherOwner.id, role: "owner" } });
    expect((await api("otherOwner", `${a.id}/members/${actors.ownerA.id}`, "PATCH", { role: "member" })).status).toBe(200);
    expect((await api("invitee", "accept", "POST", { token: raw })).status).toBe(400);
    expect((await api("otherOwner", `${a.id}/members/${actors.member.id}`, "PATCH", { isActive: false })).status).toBe(200);
    expect((await api("member", a.id)).status).toBe(404);
    expect((await api("ownerA", `${a.id}/members`)).status).toBe(403);
  });

  it("disabled tenants and unverified users fail closed", async () => {
    await service.invite(actors.ownerA, a.id, actors.invitee.email, "member"); const raw = token();
    await db.user.update({ where: { id: actors.ownerA.id }, data: { emailVerified: false } });
    expect((await api("invitee", "accept", "POST", { token: raw })).status).toBe(400);
    await db.user.update({ where: { id: actors.ownerA.id }, data: { emailVerified: true } });
    await db.tenant.update({ where: { id: a.id }, data: { isActive: false } });
    expect((await api("ownerA", a.id)).status).toBe(404);
    await db.user.update({ where: { id: actors.outsider.id }, data: { emailVerified: false } });
    expect((await api("outsider")).status).toBe(401);
    await db.user.update({ where: { id: actors.outsider.id }, data: { emailVerified: true } });
  });

  it("delivery failure revokes the token and records metadata-only events", async () => {
    runtime.mail.mockRejectedValueOnce(new Error("SMTP outage"));
    expect((await api("ownerA", `${a.id}/invitations`, "POST", { email: actors.invitee.email })).status).toBe(502);
    const invite = await db.invitation.findFirstOrThrow({ where: { tenantId: a.id } }); expect(invite.revokedAt).not.toBeNull();
    const events = await (await api("ownerA", `${a.id}/audit`)).json();
    expect(events.items.some((event: { action: string }) => event.action === "invitation.delivery_failed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(actors.invitee.email);
    expect(JSON.stringify(events)).not.toContain(invite.tokenHash);
  });

  it("provisions only verified owners transactionally and validates DB integrity", async () => {
    const tenant = await service.provision("Operator tenant", `operator-${randomUUID()}`, actors.ownerA.id);
    expect((await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: tenant.id, userId: actors.ownerA.id } } })).role).toBe("owner");
    await expect(service.provision("No owner", `invalid-${randomUUID()}`, randomUUID())).rejects.toMatchObject({ code: "verified_owner_required" });
    await expect(db.membership.create({ data: { tenantId: a.id, userId: actors.ownerA.id, role: "member" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.invitation.create({ data: { tenantId: b.id, createdById: actors.ownerA.id, email: "other@example.test", tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 10000) } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.tenantAudit.updateMany({ where: { tenantId: tenant.id }, data: { action: "forged" } })).rejects.toBeDefined();
    await expect(db.tenantAudit.deleteMany({ where: { tenantId: tenant.id } })).rejects.toBeDefined();
    await expect(db.$executeRaw`UPDATE memberships SET tenant_id = ${b.id}::uuid WHERE tenant_id = ${a.id}::uuid AND user_id = ${actors.member.id}::uuid`).rejects.toBeDefined();
    await expect(db.$executeRaw`INSERT INTO memberships (tenant_id, user_id, role) VALUES (${b.id}::uuid, ${actors.invitee.id}::uuid, 'superadmin')`).rejects.toBeDefined();
  });

  it("rolls back membership mutations when the audit write fails", async () => {
    const faulty = db.$extends({ query: { tenantAudit: { create() { throw new Error("Test audit outage"); } } } });
    await expect(createTenancy(faulty as unknown as PrismaClient, runtime.mail, baseURL).changeMember(actors.ownerA, a.id, actors.member.id, { role: "owner" })).rejects.toThrow("Test audit outage");
    expect((await db.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: a.id, userId: actors.member.id } } })).role).toBe("member");
  });

  it("limits invitation deliveries and exercises the operator CLI", async () => {
    for (let i = 0; i < 20; i++) expect((await api("ownerA", `${a.id}/invitations`, "POST", { email: `limit-${i}@example.test` })).status).toBe(201);
    expect((await api("ownerA", `${a.id}/invitations`, "POST", { email: "over-limit@example.test" })).status).toBe(429);
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url)), "scripts/provision-tenant.ts", "--name", "CLI tenant", "--slug", `cli-${randomUUID()}`, "--owner-user-id", actors.ownerA.id], { env: process.env, encoding: "utf8", timeout: 30000 });
    expect(cli.status, "Operator CLI failed; output suppressed").toBe(0);
    expect(cli.stdout).toMatch(/^Tenant provisioned: [0-9a-f-]+/);
  });
});
