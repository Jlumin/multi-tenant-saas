import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../../src/server/auth/create-auth";
import type { AuthConfig } from "../../src/server/auth/config";

const baseURL = "http://localhost:3000";
const name = `auth_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client;
let database: PrismaClient;
let auth: ReturnType<typeof createAuth>;
let config: AuthConfig;
let created = false;
const messages: { to: string; text: string; subject: string }[] = [];
const password = "Test-auth-only-password-714!";
const email = "auth-flow@example.test";
let cookie = "";

async function request(path: string, body?: unknown, cookies = "", origin = baseURL) {
  return auth.handler(new Request(`${baseURL}/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookies ? { Cookie: cookies } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

function sentURL(subject: string): URL {
  const message = messages.findLast(m => m.subject === subject);
  expect(message).toBeDefined();
  return new URL(message!.text.match(/https?:\/\/\S+/)![0]);
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required; no fallback to development data.");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL, connectionTimeoutMillis: 5000 });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL);
  url.pathname = `/${name}`;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(result.status, "Prisma migration failed; output suppressed to protect connection details.").toBe(0);
  database = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] });
  config = {
    baseURL, databaseURL: url.toString(), secret: randomUUID() + randomUUID(),
    smtp: { host: "localhost", port: 1025, secure: false, from: "noreply@example.test" },
  };
  auth = createAuth(config, database, async message => { messages.push(message); });
  vi.useFakeTimers({ toFake: ["Date"] });
});

// Keep the production limiter enabled. Advance only wall-clock time between
// scenarios, without slowing real PostgreSQL/socket timers or waiting in CI.
afterEach(() => { vi.advanceTimersByTime(11000); });

afterAll(async () => {
  vi.useRealTimers();
  try { await database?.$disconnect(); }
  finally {
    try { if (created) await admin.query(`DROP DATABASE "${name}"`); }
    finally { await admin?.end(); }
  }
});

describe("real PostgreSQL Better Auth flow (only delivery is a test mailbox)", () => {
  it("registers without a session, hashes the password and creates no tenant", async () => {
    const response = await request("sign-up/email", { name: "Fictional test user", email, password, callbackURL: "/sign-in" });
    expect(response.status, (await response.clone().json()).message).toBe(200);
    expect((await response.json()).token).toBeNull();
    const user = await database.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(false);
    const account = await database.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toBe(password);
    expect(await database.tenant.count()).toBe(0);
    expect(await database.session.count()).toBe(0);
  });

  it("refuses unverified, wrong-password and foreign-origin login", async () => {
    expect((await request("sign-in/email", { email, password })).status).toBe(403);
    expect((await request("sign-in/email", { email, password: "incorrect-password" })).status).toBe(401);
    expect((await request("sign-in/email", { email, password }, "", "https://attacker.example")).status).toBe(403);
  });

  it("verifies email, signs in and sets HttpOnly/SameSite cookies", async () => {
    const verified = await auth.handler(new Request(sentURL("驗證電子郵件")));
    expect([200, 302]).toContain(verified.status);
    expect((await database.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBe(true);
    const response = await request("sign-in/email", { email, password });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some(c => /HttpOnly/i.test(c) && /SameSite=Lax/i.test(c))).toBe(true);
    cookie = cookies.map(c => c.split(";")[0]).join("; ");
    const session = await request("get-session", undefined, cookie);
    expect((await session.json()).user.email).toBe(email);
  });

  it("rejects tampered cookies, expired sessions and unknown reset tokens", async () => {
    expect(await (await request("get-session", undefined, "better-auth.session_token=tampered")).json()).toBeNull();
    expect((await request("reset-password", { token: "invalid-token", newPassword: "New-test-only-password-792!" })).status).toBe(400);
    await database.session.updateMany({ data: { expiresAt: new Date(0) } });
    expect(await (await request("get-session", undefined, cookie)).json()).toBeNull();
  });

  it("resets password through the delivered token and revokes sessions", async () => {
    const signIn = await request("sign-in/email", { email, password });
    expect(signIn.status).toBe(200);
    cookie = signIn.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    expect(await database.session.count()).toBeGreaterThan(0);
    expect((await request("request-password-reset", { email, redirectTo: "/reset-password" })).status).toBe(200);
    const mailURL = sentURL("重設密碼");
    const redirected = await auth.handler(new Request(mailURL));
    const location = redirected.headers.get("location");
    expect(location).toBeTruthy();
    const token = new URL(location!, baseURL).searchParams.get("token");
    expect(token).toBeTruthy();
    const newPassword = "Changed-test-only-password-639!";
    expect((await request("reset-password", { token, newPassword })).status).toBe(200);
    expect(await database.session.count()).toBe(0);
    expect((await request("reset-password", { token, newPassword })).status).toBe(400);
    expect((await request("sign-in/email", { email, password })).status).toBe(401);
    expect((await request("sign-in/email", { email, password: newPassword })).status).toBe(200);
  });

  it("invalidates the session on logout and does not grant tenant membership", async () => {
    const login = await request("sign-in/email", { email, password: "Changed-test-only-password-639!" });
    expect(login.status).toBe(200);
    cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    expect((await request("sign-out", {}, cookie)).status).toBe(200);
    expect(await (await request("get-session", undefined, cookie)).json()).toBeNull();
    expect(await database.tenant.count()).toBe(0);
  });

  it("builds Google OAuth state/callback only when configured, without contacting Google", async () => {
    const googleAuth = createAuth({ ...config, google: { clientId: "test-client.apps.googleusercontent.com", clientSecret: "test-only-google-secret" } }, database, async () => {});
    const response = await googleAuth.handler(new Request(`${baseURL}/api/auth/sign-in/social`, { method: "POST", headers: { "Content-Type": "application/json", Origin: baseURL }, body: JSON.stringify({ provider: "google", callbackURL: "/sign-in", disableRedirect: true }) }));
    expect(response.status).toBe(200);
    const target = new URL((await response.json()).url);
    expect(target.origin).toBe("https://accounts.google.com");
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/callback/google`);
    expect(target.searchParams.get("response_type")).toBe("code");
    expect(target.searchParams.get("code_challenge")).toBeTruthy();
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    const rejected = await googleAuth.handler(new Request(`${baseURL}/api/auth/callback/google?code=invalid-fixture&state=missing-state`));
    expect(rejected.status).toBe(302);
    expect(rejected.headers.get("location")).toContain("error=");
  });

  it("cannot use Google when credentials are absent and rejects duplicate provider identity", async () => {
    expect((await request("sign-in/social", { provider: "google", callbackURL: "/sign-in" })).status).toBe(404);
    const user = await database.user.findUniqueOrThrow({ where: { email } });
    const account = await database.account.findFirstOrThrow({ where: { userId: user.id } });
    await expect(database.account.create({ data: { id: randomUUID(), userId: user.id, providerId: account.providerId, accountId: account.accountId } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("rate limits repeated wrong-password attempts", async () => {
    for (let i = 0; i < 3; i++) expect((await request("sign-in/email", { email, password: "invalid-password" })).status).toBe(401);
    expect((await request("sign-in/email", { email, password: "invalid-password" })).status).toBe(429);
  });
});
