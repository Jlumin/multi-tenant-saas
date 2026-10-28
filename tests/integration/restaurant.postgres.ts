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
import { createRestaurant } from "../../src/server/restaurant/service";
import { type Actor } from "../../src/server/tenancy/service";

const runtime = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }));
vi.mock("../../src/server/auth/runtime", () => ({ getAuth: runtime.auth }));
vi.mock("../../src/server/platform", () => ({ getDatabase: runtime.database }));
import { handleRestaurant } from "../../src/server/restaurant/api";

const baseURL = "http://localhost:3000", dbName = `restaurant_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client, db: PrismaClient, created = false, tenantA = "", tenantB = "", ownerA: Actor, ownerB: Actor, member: Actor;
const cookies: Record<string,string> = {};
let restaurant: ReturnType<typeof createRestaurant>;
async function api(user: string, path: string, method = "GET", body?: unknown, extra: Record<string,string> = {}) {
  return handleRestaurant(new Request(`${baseURL}/api/restaurant/${path}`, { method, headers: { "Content-Type": "application/json", Origin: baseURL, ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_ADMIN_URL) throw new Error("TEST_DATABASE_ADMIN_URL required");
  admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL }); await admin.connect(); await admin.query(`CREATE DATABASE "${dbName}"`); created = true;
  const url = new URL(process.env.TEST_DATABASE_ADMIN_URL); url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, [fileURLToPath(new URL("../../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
  expect(migrated.status, "Migration failed; output suppressed").toBe(0);
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }), log: [] });
  const secret = randomUUID()+randomUUID(); vi.stubEnv("BETTER_AUTH_URL",baseURL); vi.stubEnv("BETTER_AUTH_SECRET",secret); vi.stubEnv("DATABASE_URL",url.toString()); vi.stubEnv("SMTP_HOST","localhost"); vi.stubEnv("SMTP_PORT","1025"); vi.stubEnv("SMTP_FROM","noreply@example.test");
  const auth = createAuth({ baseURL, secret, databaseURL: url.toString(), smtp: { host:"localhost", port:1025, secure:false, from:"noreply@example.test" } }, db, async()=>{}); runtime.auth.mockReturnValue(auth); runtime.database.mockReturnValue(db); restaurant = createRestaurant(db,baseURL);
  const hash = await hashPassword("Restaurant-test-only-password-72!");
  for (const name of ["ownerA","ownerB","member"]) { const user=await db.user.create({data:{name,email:`${name.toLowerCase()}@example.test`,emailVerified:true}}); if(name==="ownerA")ownerA=user; if(name==="ownerB")ownerB=user; if(name==="member")member=user; await db.account.create({data:{userId:user.id,accountId:user.id,providerId:"credential",password:hash}}); const response=await auth.api.signInEmail({body:{email:user.email,password:"Restaurant-test-only-password-72!"},headers:new Headers({Origin:baseURL}),asResponse:true}); expect(response.status).toBe(200); cookies[name]=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; "); }
});
beforeEach(async()=>{tenantA=(await db.tenant.create({data:{name:"Restaurant A",slug:`resta-${randomUUID()}`}})).id;tenantB=(await db.tenant.create({data:{name:"Restaurant B",slug:`restb-${randomUUID()}`}})).id;await db.membership.createMany({data:[{tenantId:tenantA,userId:ownerA.id,role:"owner"},{tenantId:tenantA,userId:member.id,role:"member"},{tenantId:tenantB,userId:ownerB.id,role:"owner"}]});vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});});
afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();try{await db?.$disconnect()}finally{try{if(created)await admin.query(`DROP DATABASE "${dbName}"`)}finally{await admin?.end()}}});

describe("Restaurant QR and POS on PostgreSQL",()=>{
  async function fixture(){
    const setup=await restaurant.saveSetup(ownerA,tenantA,{name:"Demo Kitchen",isActive:true});
    const category=await restaurant.saveCategory(ownerA,tenantA,null,{name:"Food"});
    const item=await restaurant.saveItem(ownerA,tenantA,null,{categoryId:category.id,code:"FOOD-1",name:"Rice bowl",description:"Hot meal",price:"125.50",isPublished:true});
    const table=await restaurant.createTable(ownerA,tenantA,{tableNumber:"1",label:"Table 1"});
    const token=new URL(table.qrUrl).pathname.split("/").pop()!;
    return {setup,category,item,table,token};
  }
  it("requires Owner for menu/table writes and scopes management to active membership",async()=>{
    await fixture();
    expect((await api("anonymous",`${tenantA}/items`)).status).toBe(401);
    expect((await api("member",`${tenantA}/items`,"POST",{categoryId:randomUUID(),code:"X",name:"X",description:"",price:"1"})).status).toBe(403);
    expect((await api("ownerB",`${tenantA}/items`)).status).toBe(404);
    expect((await api("member",`${tenantA}/restaurant`)).status).toBe(200);
    expect((await api("ownerA",`${tenantB}/restaurant`)).status).toBe(404);
  });
  it("stores only QR token digests and accepts guest menu orders idempotently",async()=>{
    const {item,table,token}=await fixture();
    expect((await db.restaurantTable.findUniqueOrThrow({where:{id:table.id}})).qrTokenHash).not.toBe(token);
    const menu=await restaurant.publicMenu(token);expect(menu.categories[0].items[0].name).toBe("Rice bowl");
    const first=await restaurant.submitPublicOrder(token,"restaurant-idempotency-key-0001",[{itemId:item.id,quantity:2}]);
    await restaurant.saveItem(ownerA,tenantA,item.id,{categoryId:(await restaurant.categories(ownerA,tenantA))[0].id,code:"FOOD-1",name:"Rice bowl updated",description:"",price:"300",isPublished:true,version:item.version});
    expect((await db.restaurantOrderLine.findFirstOrThrow({where:{orderId:first.id}})).unitPrice.toString()).toBe("125.5");
    const retry=await restaurant.submitPublicOrder(token,"restaurant-idempotency-key-0001",[{itemId:item.id,quantity:2}]);
    expect(retry.id).toBe(first.id);expect(first.totalAmount.toString()).toBe("251");
    await expect(restaurant.submitPublicOrder(token,"restaurant-idempotency-key-0001",[{itemId:item.id,quantity:1}])).rejects.toMatchObject({status:409,code:"idempotency_conflict"});
    expect((await api("anonymous",`public/${token}/orders`,"POST",{lines:[{itemId:item.id,quantity:1}]},{"Idempotency-Key":"guest-api-idempotency-01"})).status).toBe(201);
  });
  it("applies POS transitions to Owner and Member and rejects illegal changes",async()=>{
    const {item,token}=await fixture();const created=await restaurant.submitPublicOrder(token,"restaurant-status-key-0001",[{itemId:item.id,quantity:1}]);
    await expect(restaurant.transitionOrder(ownerB,tenantA,created.id,"accepted")).rejects.toMatchObject({status:404});
    await expect(restaurant.transitionOrder(member,tenantA,created.id,"accepted")).resolves.toMatchObject({status:"accepted"});
    await expect(restaurant.transitionOrder(member,tenantA,created.id,"completed")).rejects.toMatchObject({status:409,code:"invalid_transition"});
    await restaurant.transitionOrder(member,tenantA,created.id,"preparing");await restaurant.transitionOrder(member,tenantA,created.id,"ready");await restaurant.transitionOrder(member,tenantA,created.id,"completed");
    expect((await restaurant.orders(ownerA,tenantA,20,0)).items[0].status).toBe("completed");
    await expect(db.restaurantOrderLine.deleteMany({where:{orderId:created.id}})).rejects.toThrow();
    await expect(db.restaurantOrder.deleteMany({where:{id:created.id}})).rejects.toThrow();
  });
  it("serializes concurrent duplicate submissions and rolls back order status with audit failure",async()=>{
    const {item,token}=await fixture();
    const attempts=await Promise.all([1,2].map(()=>restaurant.submitPublicOrder(token,"restaurant-concurrent-idempotency-01",[{itemId:item.id,quantity:2}])));
    expect(attempts[0].id).toBe(attempts[1].id);
    expect(await db.restaurantOrder.count({where:{tenantId:tenantA}})).toBe(1);
    await expect(restaurant.transitionOrder(member,tenantA,attempts[0].id,"accepted","not-a-uuid")).rejects.toThrow();
    expect((await db.restaurantOrder.findUniqueOrThrow({where:{id:attempts[0].id}})).status).toBe("pending");
    await expect(restaurant.submitPublicOrder(token,"restaurant-concurrent-idempotency-01",[{itemId:item.id,quantity:3}])).rejects.toMatchObject({status:409,code:"idempotency_conflict"});
  });
  it("invalidates rotated QR and rejects unavailable menu items and bad request origin",async()=>{
    const {item,table,token}=await fixture();
    const rotated=await restaurant.rotateTableQr(ownerA,tenantA,table.id);const nextToken=new URL(rotated.qrUrl).pathname.split("/").pop()!;
    await expect(restaurant.publicMenu(token)).rejects.toMatchObject({status:404});
    await db.restaurantMenuItem.update({where:{id:item.id},data:{isPublished:false}});
    await expect(restaurant.submitPublicOrder(nextToken,"restaurant-unavailable-key-01",[{itemId:item.id,quantity:1}])).rejects.toMatchObject({status:409,code:"menu_changed"});
    expect((await api("ownerA",`${tenantA}/categories`,"POST",{name:"Bad"},{Origin:"https://attacker.test"})).status).toBe(403);
  });
});
