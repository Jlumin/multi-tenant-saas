import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

if (!process.env.TEST_DATABASE_ADMIN_URL || !process.env.TEST_MAILPIT_URL) {
  console.error("Set TEST_DATABASE_ADMIN_URL and TEST_MAILPIT_URL for isolated auth HTTP verification.");
  process.exit(1);
}
const name = `auth_http_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
const jar = new Map();
let created = false;
let server;
let exited = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL);
  url.pathname = `/${name}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  assert.equal(migrated.status, 0);
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: "ignore", env: { ...process.env, DATABASE_URL: url.toString(), BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomUUID() + randomUUID(), GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", NEXT_TELEMETRY_DISABLED: "1" },
  });
  server.on("exit", () => { exited = true; });
  const deadline = Date.now() + 30000;
  let healthy = false;
  while (Date.now() < deadline && !exited) {
    try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* Startup only. */ }
    if (healthy) break;
    await delay(200);
  }
  assert.ok(healthy);
  assert.equal((await fetch(`${base}/sign-in`)).status, 200);

  async function request(path, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(path.startsWith("http") ? path : `${base}/api/auth/${path}`, {
      method, redirect: "manual", headers: { Origin: base, "Content-Type": "application/json", Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]; const at = pair.indexOf("=");
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }

  const email = `http-${randomUUID()}@example.test`;
  const password = `Auth-test-only-${randomUUID()}!`;
  assert.equal((await request("sign-up/email", { name: "Fictional HTTP user", email, password, callbackURL: "/sign-in" })).status, 200);
  assert.equal(await (await request("get-session")).json(), null);
  async function mailURL(recipient, pathname) {
    for (let i = 0; i < 20; i++) {
      const inbox = await (await fetch(`${process.env.TEST_MAILPIT_URL}/api/v1/messages`)).json();
      for (const message of inbox.messages?.filter(m => m.To?.some(to => to.Address === recipient)) ?? []) {
        const mail = await (await fetch(`${process.env.TEST_MAILPIT_URL}/api/v1/message/${message.ID}`)).json();
        const link = mail.Text?.match(/https?:\/\/\S+/)?.[0];
        if (link && new URL(link).pathname === pathname) return link;
      }
      await delay(250);
    }
    throw new Error("Expected test mail not found");
  }
  const verification = await mailURL(email, "/api/auth/verify-email");
  assert.ok(verification);
  assert.equal(new URL(verification).origin, base);
  assert.ok([200, 302].includes((await request(verification)).status));
  const signedIn = await request("sign-in/email", { email, password });
  assert.equal(signedIn.status, 200);
  assert.ok(signedIn.headers.getSetCookie().some(c => /HttpOnly/i.test(c)));
  const signedUser = (await (await request("get-session")).json()).user;
  assert.equal(signedUser.email, email);
  const provision = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)), "scripts/provision-tenant.ts", "--name", "Fictional HTTP tenant", "--slug", `http-${randomUUID()}`, "--owner-user-id", signedUser.id], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 30000 });
  assert.equal(provision.status, 0);
  const tenantId = provision.stdout.match(/Tenant provisioned: ([0-9a-f-]+)/)?.[1];
  assert.ok(tenantId);
  const tenantURL = `${base}/api/tenancy/${tenantId}`;
  assert.equal((await request(tenantURL)).status, 200);
  const invitee = `invited-${randomUUID()}@example.test`;
  assert.equal((await request(`${tenantURL}/invitations`, { email: invitee })).status, 201);
  const invitation = await mailURL(invitee, "/invite");
  assert.equal(new URL(invitation).origin, base);
  const invitationToken = new URL(invitation).searchParams.get("token");
  jar.clear();
  assert.equal((await request("sign-up/email", { name: "Fictional invited user", email: invitee, password, callbackURL: "/sign-in" })).status, 200);
  assert.ok([200, 302].includes((await request(await mailURL(invitee, "/api/auth/verify-email"))).status));
  assert.equal((await request("sign-in/email", { email: invitee, password })).status, 200);
  assert.equal((await request(tenantURL)).status, 404);
  assert.equal((await request(`${base}/api/tenancy/accept`, { token: invitationToken })).status, 200);
  assert.equal((await request(tenantURL)).status, 200);
  assert.equal((await request(`${tenantURL}/members`)).status, 403);
  assert.equal((await request(`${base}/api/tenancy/accept`, { token: invitationToken })).status, 400);
  assert.equal((await fetch(`${base}/workspaces`)).status, 200);
  assert.equal((await fetch(`${base}/invite`)).status, 200);
  assert.equal((await request("sign-out", {})).status, 200);
  assert.equal(await (await request("get-session")).json(), null);
  console.log("PASS: real Next HTTP + PostgreSQL + SMTP signup/verification, operator provisioning, invitation delivery/acceptance, role/replay refusal, and logout.");
} catch {
  console.error("Auth HTTP smoke failed. Check local PostgreSQL/Mailpit/configuration. Tokens, messages and credentials suppressed.");
  process.exitCode = 1;
} finally {
  if (server && !exited) {
    server.kill("SIGTERM");
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(5000)]);
    if (!exited) { server.kill("SIGKILL"); await delay(250); }
  }
  try { if (created) await admin.query(`DROP DATABASE "${name}"`); }
  catch { console.error(`Cleanup failed for generated disposable database ${name}.`); process.exitCode = 1; }
  finally { await admin.end(); }
}
