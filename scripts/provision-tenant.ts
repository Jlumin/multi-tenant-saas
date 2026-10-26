import "dotenv/config";
import { getDatabase } from "../src/server/platform";
import { createTenancy } from "../src/server/tenancy/service";

const args = process.argv.slice(2);
const known = new Set(["--name", "--slug", "--owner-user-id"]);
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (!known.has(args[i]) || !args[i + 1] || values[args[i]]) { console.error("Usage: npm run tenant:provision -- --name NAME --slug SLUG --owner-user-id UUID"); process.exit(1); }
  values[args[i]] = args[i + 1];
}
if (!values["--name"] || !values["--slug"] || !/^[0-9a-f-]{36}$/i.test(values["--owner-user-id"] ?? "")) { console.error("A name, slug and verified owner user UUID are required."); process.exit(1); }
let db: ReturnType<typeof getDatabase> | undefined;
try {
  db = getDatabase();
  const tenant = await createTenancy(db, async () => {}, "http://localhost").provision(values["--name"], values["--slug"], values["--owner-user-id"]);
  console.log(`Tenant provisioned: ${tenant.id}`);
} catch { console.error("Provision failed; verify unique slug, verified owner and database configuration. No secrets logged."); process.exitCode = 1; }
finally { await db?.$disconnect(); }
