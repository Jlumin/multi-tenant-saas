import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const mode = process.argv.includes("--dev") ? "dev" : "start";
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url)), mode, "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: "ignore", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
let exited = false;
child.on("exit", () => { exited = true; });
try {
  const base = `http://127.0.0.1:${port}`;
  let response;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exited) throw new Error("Next.js exited before responding.");
    try {
      response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) break;
    } catch { /* Startup can briefly refuse connections. */ }
    await delay(250);
  }
  assert.equal(response?.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
  const home = await fetch(base, { signal: AbortSignal.timeout(30000) });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /工程起點已就緒/);
  const unsupported = await fetch(`${base}/api/health`, { method: "POST" });
  assert.equal(unsupported.status, 405);
  console.log(`PASS: Next.js ${mode} homepage, real GET /api/health (fixed JSON/no-store) and POST 405.`);
} catch {
  console.error(`HTTP smoke failed in ${mode} mode; run the server locally to inspect startup. No environment values logged.`);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  if (!exited) {
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
    if (!exited) child.kill("SIGKILL");
  }
}
