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
import { createHr } from "../../src/server/hr/service";
import { type Actor } from "../../src/server/tenancy/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database }));
import { handleHr } from "../../src/server/hr/api";

const baseURL = "http://localhost:3000", dbName = `hr_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false, tenantA = "", tenantB = "";
const actors: Record<string, Actor> = {}, cookies: Record<string, string> = {};
let hr: ReturnType<typeof createHr>;

async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return handleHr(new Request(`${baseURL}/api/hr/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL }); await admin.connect(); await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL); url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(migrated.status, "Migration failed; output suppressed").toBe(0);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] });
  const secret = randomUUID() + randomUUID(); vi.stubEnv("BETTER_AUTH_URL", baseURL); vi.stubEnv("BETTER_AUTH_SECRET", secret); vi.stubEnv("DATABASE_URL", url.toString()); vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("SMTP_PORT", "1025"); vi.stubEnv("SMTP_FROM", "noreply@example.test");
  const auth = createAuth({ baseURL, secret, databaseURL: url.toString(), smtp: { host: "localhost", port: 1025, secure: false, from: "noreply@example.test" } }, db, async () => {}); runtime.auth.mockReturnValue(auth); runtime.database.mockReturnValue(db); hr = createHr(db);
  const password = "HR-test-only-password-623!", hash = await hashPassword(password);
  for (const name of ["ownerA", "ownerB", "member", "outsider"]) {
    const user = await db.user.create({ data: { name, email: `${name.toLowerCase()}@example.test`, emailVerified: true } }); actors[name] = user;
    await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash } });
    const response = await auth.api.signInEmail({ body: { email: user.email, password }, headers: new Headers({ Origin: baseURL }), asResponse: true });
    expect(response.status).toBe(200); cookies[name] = response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  }
});

beforeEach(async () => {
  tenantA = (await db.tenant.create({ data: { name: "HR tenant A", slug: `hra-${randomUUID()}` } })).id;
  tenantB = (await db.tenant.create({ data: { name: "HR tenant B", slug: `hrb-${randomUUID()}` } })).id;
  await db.membership.createMany({ data: [
    { tenantId: tenantA, userId: actors.ownerA.id, role: "owner" }, { tenantId: tenantA, userId: actors.member.id, role: "member" },
    { tenantId: tenantB, userId: actors.ownerB.id, role: "owner" },
  ] });
  vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  try { await db?.$disconnect(); } finally { try { if (created) await admin.query(`DROP DATABASE "${dbName}"`); } finally { await admin?.end(); } }
});

describe("HR employee attendance on PostgreSQL", () => {
  it("enforces tenant, Owner and self-only boundaries", async () => {
    await hr.createEmployee(actors.ownerA, tenantA, { userId: actors.member.id, staffNumber: "A-001" });
    expect((await api("anonymous", `${tenantA}/current`)).status).toBe(401);
    expect((await api("ownerB", `${tenantA}/employees`)).status).toBe(404);
    expect((await api("member", `${tenantA}/employees`)).status).toBe(403);
    await expect(hr.createEmployee(actors.ownerA, tenantA, { userId: actors.ownerB.id, staffNumber: "FOREIGN" })).rejects.toMatchObject({ status: 404 });
    expect((await api("member", `${tenantA}/attendance?userId=${actors.ownerA.id}`)).status).toBe(403);
    expect((await api("member", `${tenantA}/current`)).status).toBe(200);
    expect((await api("member", `${tenantB}/current`)).status).toBe(404);
    expect((await api("member", `${tenantA}/clock-in`, "POST", { idempotencyKey: "forged-time-001", clockInAt: "2001-01-01T00:00:00Z" })).status).toBe(400);
    expect((await api("member", `${tenantA}/clock-in`, "POST", { idempotencyKey: "bad-origin-001" }, { Origin: "https://evil.example" })).status).toBe(403);
  });

  it("uses server times, makes retries idempotent and allows one open session", async () => {
    await hr.createEmployee(actors.ownerA, tenantA, { userId: actors.member.id, staffNumber: "A-002" });
    const started = Date.now();
    const first = await hr.clockIn(actors.member, tenantA, "clock-in-key-01");
    const replay = await hr.clockIn(actors.member, tenantA, "clock-in-key-01");
    expect(first.id).toBe(replay.id); expect(first.clockInAt.getTime()).toBeGreaterThanOrEqual(started - 1000);
    await expect(hr.clockIn(actors.member, tenantA, "clock-in-key-02")).rejects.toMatchObject({ status: 409, code: "already_clocked_in" });
    const ended = await hr.clockOut(actors.member, tenantA, "clock-out-key-01");
    expect(ended.id).toBe(first.id); expect(ended.clockOutAt).not.toBeNull();
    expect((await hr.clockOut(actors.member, tenantA, "clock-out-key-01")).id).toBe(first.id);
    expect(await db.hrAttendance.count({ where: { tenantId: tenantA, userId: actors.member.id } })).toBe(1);
  });

  it("serializes concurrent check-ins and relies on the partial unique guard", async () => {
    await hr.createEmployee(actors.ownerA, tenantA, { userId: actors.member.id, staffNumber: "A-003" });
    const results = await Promise.allSettled([hr.clockIn(actors.member, tenantA, "concurrent-checkin-1"), hr.clockIn(actors.member, tenantA, "concurrent-checkin-2")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await db.hrAttendance.count({ where: { tenantId: tenantA, userId: actors.member.id, clockOutAt: null } })).toBe(1);
  });

  it("prevents deactivating a working employee and lets Owner repair an abandoned open shift", async () => {
    await hr.createEmployee(actors.ownerA, tenantA, { userId: actors.member.id, staffNumber: "A-OPEN" });
    const opened = await hr.clockIn(actors.member, tenantA, "open-shift-clock-in-01");
    await expect(hr.updateEmployee(actors.ownerA, tenantA, actors.member.id, { staffNumber: "A-OPEN", isActive: false, version: 1 })).rejects.toMatchObject({ status: 409, code: "employee_has_open_attendance" });
    await db.membership.update({ where: { tenantId_userId: { tenantId: tenantA, userId: actors.member.id } }, data: { isActive: false } });
    const closed = await hr.adjust(actors.ownerA, tenantA, opened.id, "clock_out", new Date(Date.now() + 1000).toISOString(), "帳號停用前漏打下班，由 Owner 補登");
    expect(closed.attendance.clockOutAt).not.toBeNull();
    expect(await db.hrAttendance.count({ where: { tenantId: tenantA, userId: actors.member.id, clockOutAt: null } })).toBe(0);
  });

  it("keeps corrections append-only, timezone tenant-scoped, and audits atomically", async () => {
    await hr.createEmployee(actors.ownerA, tenantA, { userId: actors.member.id, staffNumber: "A-004" });
    const record = await hr.clockIn(actors.member, tenantA, "correction-clock-in-01");
    const closed = await hr.clockOut(actors.member, tenantA, "correction-clock-out-01");
    const corrected = await hr.adjust(actors.ownerA, tenantA, closed.id, "clock_in", "2026-10-27T00:30:00Z", "忘記打卡，經本人確認");
    expect(corrected.attendance.clockInAt.toISOString()).toBe("2026-10-27T00:30:00.000Z");
    expect((await db.hrAttendance.findUniqueOrThrow({ where: { id: record.id } })).clockInAt).toEqual(record.clockInAt);
    await expect(db.hrAttendanceAdjustment.deleteMany({ where: { tenantId: tenantA } })).rejects.toThrow();
    await expect(hr.setTimezone(actors.ownerA, tenantA, "Not/AZone")).rejects.toMatchObject({ status: 400, code: "invalid_timezone" });
    const boundary = await hr.clockIn(actors.member, tenantA, "timezone-boundary-in-01");
    await hr.clockOut(actors.member, tenantA, "timezone-boundary-out-01");
    await hr.adjust(actors.ownerA, tenantA, boundary.id, "clock_in", "2026-10-27T16:30:00Z", "時區邊界驗證");
    expect((await hr.history(actors.ownerA, tenantA, 20, 0, actors.member.id)).items.find(item => item.id === boundary.id)?.businessDate).toBe("2026-10-28");
    expect((await hr.setTimezone(actors.ownerA, tenantA, "America/Los_Angeles")).timeZone).toBe("America/Los_Angeles");
    expect((await hr.history(actors.ownerA, tenantA, 20, 0, actors.member.id)).items.find(item => item.id === boundary.id)?.businessDate).toBe("2026-10-27");
    await expect(hr.updateEmployee(actors.ownerA, tenantA, actors.member.id, { staffNumber: "ROLLBACK", isActive: false, version: 1 }, "not-a-uuid")).rejects.toThrow();
    expect((await db.hrEmployee.findUniqueOrThrow({ where: { tenantId_userId: { tenantId: tenantA, userId: actors.member.id } } })).version).toBe(1);
  });
});
