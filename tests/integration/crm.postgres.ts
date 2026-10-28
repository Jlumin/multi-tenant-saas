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
import { createCrm } from "../../src/server/crm/service";
import { type Actor } from "../../src/server/tenancy/service";
const runtime=vi.hoisted(()=>({auth:vi.fn(),database:vi.fn()}));
vi.mock("../../src/server/auth/runtime",()=>({getAuth:runtime.auth}));
vi.mock("../../src/server/platform",()=>({getDatabase:runtime.database}));
import { handleCrm } from "../../src/server/crm/api";
const baseURL="http://localhost:3000", dbName="crm_test_"+randomUUID().replaceAll("-","");
let admin:pg.Client,db:PrismaClient,created=false,tenantA="",tenantB="",ownerA:Actor,ownerB:Actor,member:Actor;
const cookies:Record<string,string>={};let crm:ReturnType<typeof createCrm>;
async function api(user:string,path:string,method="GET",body?:unknown,extra:Record<string,string>={}){
 return handleCrm(new Request(baseURL+"/api/crm/"+path,{method,headers:{"Content-Type":"application/json",Origin:baseURL,...(cookies[user]?{Cookie:cookies[user]}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}));
}
beforeAll(async()=>{
 if(!process.env.TEST_DATABASE_ADMIN_URL)throw new Error("TEST_DATABASE_ADMIN_URL required");
 admin=new pg.Client({connectionString:process.env.TEST_DATABASE_ADMIN_URL});await admin.connect();await admin.query('CREATE DATABASE "'+dbName+'"');created=true;
 const url=new URL(process.env.TEST_DATABASE_ADMIN_URL);url.pathname="/"+dbName;
 const migrated=spawnSync(process.execPath,[fileURLToPath(new URL("../../node_modules/prisma/build/index.js",import.meta.url)),"migrate","deploy"],{env:{...process.env,DATABASE_URL:url.toString()},encoding:"utf8",timeout:60000});expect(migrated.status,"Migration failed; output suppressed").toBe(0);
 db=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()}),log:[]});
 const secret=randomUUID()+randomUUID();vi.stubEnv("BETTER_AUTH_URL",baseURL);vi.stubEnv("BETTER_AUTH_SECRET",secret);vi.stubEnv("DATABASE_URL",url.toString());vi.stubEnv("SMTP_HOST","localhost");vi.stubEnv("SMTP_PORT","1025");vi.stubEnv("SMTP_FROM","noreply@example.test");
 const auth=createAuth({baseURL,secret,databaseURL:url.toString(),smtp:{host:"localhost",port:1025,secure:false,from:"noreply@example.test"}},db,async()=>{});runtime.auth.mockReturnValue(auth);runtime.database.mockReturnValue(db);crm=createCrm(db);
 const password="CRM-test-only-password-42!";
 for(const name of ["ownerA","ownerB","member"]){const user=await db.user.create({data:{name,email:name.toLowerCase()+"@example.test",emailVerified:true}});if(name==="ownerA")ownerA=user;if(name==="ownerB")ownerB=user;if(name==="member")member=user;await db.account.create({data:{userId:user.id,accountId:user.id,providerId:"credential",password:await hashPassword(password)}});const response=await auth.api.signInEmail({body:{email:user.email,password},headers:new Headers({Origin:baseURL}),asResponse:true});expect(response.status).toBe(200);cookies[name]=response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");}
});
beforeEach(async()=>{tenantA=(await db.tenant.create({data:{name:"CRM A",slug:"crma-"+randomUUID()}})).id;tenantB=(await db.tenant.create({data:{name:"CRM B",slug:"crmb-"+randomUUID()}})).id;await db.membership.createMany({data:[{tenantId:tenantA,userId:ownerA.id,role:"owner"},{tenantId:tenantA,userId:member.id,role:"member"},{tenantId:tenantB,userId:ownerB.id,role:"owner"}]});vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"warn").mockImplementation(()=>{});});
afterAll(async()=>{vi.restoreAllMocks();vi.unstubAllEnvs();try{await db?.$disconnect()}finally{try{if(created)await admin.query('DROP DATABASE "'+dbName+'"')}finally{await admin?.end()}}});
describe("CRM contact directory on PostgreSQL",()=>{
 it("normalizes and tenant-uniquely stores optional contacts",async()=>{
  const first=await crm.create(ownerA,tenantA,{displayName:"  Ada Lovelace ",email:" Ada@Example.COM ",phone:"+1 (202) 555-0100"});
  expect(first.displayName).toBe("Ada Lovelace");expect(first.email).toBe("ada@example.com");expect(first.phone).toBe("+12025550100");
  await expect(crm.create(ownerA,tenantA,{displayName:"Duplicate",email:"ADA@example.com"})).rejects.toMatchObject({status:409,code:"contact_exists"});
  await expect(crm.create(ownerA,tenantA,{displayName:"Phone duplicate",phone:"+1-202-555-0100"})).rejects.toMatchObject({status:409,code:"contact_exists"});
  await expect(crm.create(ownerA,tenantA,{displayName:"No contact",email:"not-an-email"})).rejects.toMatchObject({status:400,code:"invalid_contact"});
  const other=await crm.create(ownerB,tenantB,{displayName:"Same Email Other Tenant",email:"ada@example.com"});expect(other.displayName).toBe("Same Email Other Tenant");
 });
 it("enforces owner write and member read, tenant isolation and bounded search",async()=>{
  await crm.create(ownerA,tenantA,{displayName:"A Customer",email:"a@example.test"});
  expect((await api("anonymous",tenantA+"/contacts")).status).toBe(401);
  expect((await api("member",tenantA+"/contacts","POST",{displayName:"forged"})).status).toBe(403);
  expect((await api("ownerB",tenantA+"/contacts")).status).toBe(404);
  expect((await api("ownerA",tenantB+"/contacts")).status).toBe(404);
  expect((await api("member",tenantA+"/contacts?q=customer")).status).toBe(200);
  expect((await api("member",tenantA+"/contacts?limit=1000")).status).toBe(400);
  expect((await api("ownerA",tenantA+"/contacts","POST",{displayName:"Bad Origin"},{Origin:"https://attacker.test"})).status).toBe(403);
 });
 it("rejects stale writes, atomically audits and retains archived rows",async()=>{
  const contact=await crm.create(ownerA,tenantA,{displayName:"Retain Me",email:"retain@example.test",notes:"history"});
  const changed=await crm.update(ownerA,tenantA,contact.id,{displayName:"Updated",email:contact.email,phone:contact.phone,notes:"updated",version:contact.version});
  expect(changed.version).toBe(2);
  await expect(crm.update(ownerA,tenantA,contact.id,{displayName:"Stale",email:contact.email,phone:null,notes:"",version:contact.version})).rejects.toMatchObject({status:409,code:"version_conflict"});
  await expect(crm.update(ownerA,tenantA,contact.id,{displayName:"Rollback",email:contact.email,phone:null,notes:"",version:changed.version},"not-a-uuid")).rejects.toThrow();
  expect((await db.crmContact.findUniqueOrThrow({where:{id:contact.id}})).displayName).toBe("Updated");
  const archived=await crm.archive(ownerA,tenantA,contact.id,changed.version);expect(archived.isActive).toBe(false);expect(archived.archivedAt).not.toBeNull();
  expect((await crm.list(ownerA,tenantA,"",50,0)).items).toHaveLength(0);
  expect(await db.crmContact.count({where:{tenantId:tenantA,id:contact.id}})).toBe(1);
  await expect(crm.update(ownerA,tenantA,contact.id,{displayName:"Restore?",version:archived.version})).rejects.toMatchObject({status:409,code:"contact_archived"});
 });
 it("serializes concurrent duplicate normalized contacts",async()=>{
  const data={displayName:"Concurrent",email:"same@example.test"};
  const results=await Promise.allSettled([crm.create(ownerA,tenantA,data),crm.create(ownerA,tenantA,{...data,email:" SAME@example.test "})]);
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(results.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect(await db.crmContact.count({where:{tenantId:tenantA,email:"same@example.test"}})).toBe(1);
 });
});
