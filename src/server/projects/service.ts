import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { requireTenantContext, lockTenant, recordTenantEvent, TenantError, type Actor } from "../tenancy/service";

const view = { id: true, name: true, description: true, createdBy: true, createdAt: true, updatedAt: true, version: true } as const;
export interface ProjectInput { name: string; description: string }
export function validateProject(data: ProjectInput) {
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 120 || typeof data.description !== "string" || data.description.length > 2000) throw new TenantError(400, "invalid_project");
  return { name: data.name.trim(), description: data.description.trim() };
}
function version(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value >= 2147483647) throw new TenantError(400, "invalid_version");
}
async function find(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const project = await tx.project.findFirst({ where: { tenantId, id, deletedAt: null }, select: view });
  if (!project) throw new TenantError(404, "not_found");
  return project;
}
export function createProjects(db: PrismaClient) {
  return {
    async list(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => {
        const member = await requireTenantContext(tx, actor, tenantId);
        const where = { tenantId, deletedAt: null };
        return { items: await tx.project.findMany({ where, select: view, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }), total: await tx.project.count({ where }), limit, offset, role: member.role };
      });
    },
    async detail(actor: Actor, tenantId: string, id: string) {
      return db.$transaction(async tx => { await requireTenantContext(tx, actor, tenantId); return find(tx, tenantId, id); });
    },
    async create(actor: Actor, tenantId: string, input: ProjectInput, requestId?: string) {
      const data = validateProject(input);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const project = await tx.project.create({ data: { ...data, tenantId, createdBy: actor.id }, select: view });
        await recordTenantEvent(tx, tenantId, actor.id, "project.created", project.id, requestId);
        return project;
      });
    },
    async update(actor: Actor, tenantId: string, id: string, input: ProjectInput, expectedVersion: number, requestId?: string) {
      const data = validateProject(input); version(expectedVersion);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const project = await find(tx, tenantId, id);
        if (project.version !== expectedVersion) throw new TenantError(409, "version_conflict");
        await tx.project.update({ where: { tenantId_id: { tenantId, id } }, data: { ...data, version: { increment: 1 } } });
        await recordTenantEvent(tx, tenantId, actor.id, "project.updated", id, requestId);
        return find(tx, tenantId, id);
      });
    },
    async remove(actor: Actor, tenantId: string, id: string, expectedVersion: number, requestId?: string) {
      version(expectedVersion);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const project = await find(tx, tenantId, id);
        await requireTenantContext(tx, actor, tenantId, true);
        if (project.version !== expectedVersion) throw new TenantError(409, "version_conflict");
        await tx.project.update({ where: { tenantId_id: { tenantId, id } }, data: { deletedAt: new Date(), version: { increment: 1 } } });
        await recordTenantEvent(tx, tenantId, actor.id, "project.deleted", id, requestId);
        return { deleted: true };
      });
    },
  };
}
