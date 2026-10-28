import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Never reset or deploy into DATABASE_URL. Create a fresh database and only drop
// the exact database that this invocation successfully created.
const adminURL = process.env.TEST_DATABASE_ADMIN_URL;
if (!adminURL) {
  console.error("Set TEST_DATABASE_ADMIN_URL to a local/CI PostgreSQL account with CREATEDB.");
  process.exit(1);
}
const name = `bootstrap_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: adminURL, connectionTimeoutMillis: 5000 });
let database;
let created = false;

function prisma(args, databaseURL) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), ...args], {
    env: { ...process.env, DATABASE_URL: databaseURL }, encoding: "utf8", timeout: 60000,
  });
  // Surface useful migration diagnostics while removing any connection URL.
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted PostgreSQL URL]").slice(-3000);
  assert.equal(result.status, 0, `Prisma ${args.join(" ")} failed. ${diagnostic}`);
}

try {
  const url = new URL(adminURL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL URL required");
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  url.searchParams.delete("schema");
  const targetURL = url.toString();
  database = new pg.Client({ connectionString: targetURL, connectionTimeoutMillis: 5000 });
  await database.connect();
  assert.equal((await database.query("SELECT to_regclass('public.tenants') AS table_name")).rows[0].table_name, null);

  prisma(["migrate", "deploy"], targetURL);
  const columns = (await database.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' ORDER BY ordinal_position")).rows;
  assert.deepEqual(columns, [
    { column_name: "id", data_type: "uuid", is_nullable: "NO" },
    { column_name: "name", data_type: "text", is_nullable: "NO" },
    { column_name: "slug", data_type: "text", is_nullable: "NO" },
    { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    { column_name: "is_active", data_type: "boolean", is_nullable: "NO" },
  ]);
  const inserted = (await database.query("INSERT INTO tenants (name, slug) VALUES ($1,$2) RETURNING *", ["Fictional tenant A", "smoke-a"])).rows[0];
  assert.match(inserted.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(inserted.is_active, true);
  assert.ok(inserted.created_at instanceof Date && Math.abs(Date.now() - inserted.created_at.getTime()) < 60000);
  await database.query("INSERT INTO tenants (name, slug) VALUES ($1,$2)", ["Fictional tenant B", "smoke-b"]);
  await assert.rejects(database.query("INSERT INTO tenants (name, slug) VALUES ($1,$2)", ["Duplicate slug", "smoke-a"]), { code: "23505" });
  await assert.rejects(database.query("INSERT INTO tenants (id, name, slug) VALUES ($1,$2,$3)", [inserted.id, "Duplicate UUID", "new-slug"]), { code: "23505" });
  await assert.rejects(database.query("INSERT INTO tenants (name, slug) VALUES (NULL,$1)", ["missing-name"]), { code: "23502" });
  await assert.rejects(database.query("INSERT INTO tenants (name, slug) VALUES ($1,NULL)", ["Missing slug"]), { code: "23502" });
  await assert.rejects(database.query("INSERT INTO tenants (id, name, slug) VALUES (NULL,$1,$2)", ["Missing UUID", "null-uuid"]), { code: "23502" });
  await assert.rejects(database.query("INSERT INTO tenants (name, slug, created_at) VALUES ($1,$2,NULL)", ["Missing timestamp", "null-time"]), { code: "23502" });
  const history = (await database.query("SELECT migration_name, checksum, finished_at FROM _prisma_migrations ORDER BY migration_name")).rows;
  assert.equal(history.length, 15);
  const wmsTables = (await database.query("SELECT to_regclass('public.' || name) AS table_name FROM unnest(ARRAY['wms_documents','wms_document_lines','wms_stock_balances','wms_stock_movements','wms_posting_keys','wms_stock_counts','wms_stock_count_lines','wms_opening_entries','wms_tenant_settings','wms_stock_reservations','wms_stock_reservation_lines']) AS name ORDER BY table_name")).rows;
  assert.equal(wmsTables.length, 11);
  assert.ok(wmsTables.every(row => row.table_name !== null));
  const ecomTables = (await database.query("SELECT to_regclass('public.' || name) AS table_name FROM unnest(ARRAY['ecom_stores','ecom_products','ecom_orders','ecom_order_lines','ecom_restock_subscriptions']) AS name ORDER BY table_name")).rows;
  assert.equal(ecomTables.length, 5);
  assert.ok(ecomTables.every(row => row.table_name !== null));
  assert.equal((await database.query("SELECT count(*)::int AS total FROM information_schema.columns WHERE table_schema='public' AND ((table_name='wms_documents' AND column_name='destination_warehouse_id') OR (table_name='wms_document_lines' AND column_name IN ('target_warehouse_id','target_location_id')))")).rows[0].total, 3);
  assert.ok((await database.query("SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='WmsDocumentType' AND enumlabel='transfer'")).rows.length === 1);
  assert.ok((await database.query("SELECT count(*)::int AS total FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='WmsDocumentType' AND enumlabel IN ('opening','adjustment')")).rows[0].total === 2);
  assert.ok(history[0].finished_at);
  prisma(["migrate", "deploy"], targetURL);
  assert.deepEqual((await database.query("SELECT migration_name, checksum, finished_at FROM _prisma_migrations ORDER BY migration_name")).rows, history);
  prisma(["migrate", "status"], targetURL);
  prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], targetURL);
  assert.equal((await database.query("SELECT count(*)::int AS total FROM tenants")).rows[0].total, 2);
  console.log("PASS: fresh PostgreSQL migration, WMS and E-Commerce schema including guest orders, UUID/time defaults, NOT NULL/PK/slug uniqueness, second deploy unchanged, schema drift absent.");
} catch (error) {
  console.error(error instanceof assert.AssertionError ? `DB smoke assertion failed: ${error.message}` : "DB smoke failed; check PostgreSQL connectivity, CREATEDB permission and Prisma compatibility. Secrets suppressed.");
  process.exitCode = 1;
} finally {
  if (database) await database.end();
  try {
    if (created) {
      await admin.query(`DROP DATABASE "${name}"`);
      console.log("Disposable smoke database removed.");
    }
  } catch {
    console.error(`Cleanup failed for generated disposable database ${name}; remove only this database after checking connections.`);
    process.exitCode = 1;
  } finally {
    await admin.end();
  }
}
