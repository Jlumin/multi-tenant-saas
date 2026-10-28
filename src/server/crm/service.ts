import type { PrismaClient } from "../../generated/prisma/client";
import { lockTenant, recordTenantEvent, requireTenantContext, TenantError, type Actor } from "../tenancy/service";

const view = { id: true, displayName: true, email: true, phone: true, notes: true, isActive: true, archivedAt: true, version: true, createdAt: true, updatedAt: true } as const;
const validName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 120;
const versionValid = (value: number) => Number.isSafeInteger(value) && value >= 1 && value < 2147483647;

function normalizeEmail(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TenantError(400, "invalid_contact");
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || /[<>()",;\\]/.test(normalized)) throw new TenantError(400, "invalid_contact");
  return normalized;
}
function normalizePhone(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TenantError(400, "invalid_contact");
  const raw = value.trim();
  if (!/^[+0-9().\-\s]+$/.test(raw)) throw new TenantError(400, "invalid_contact");
  const normalized = (raw.startsWith("+") ? "+" : "") + raw.replace(/\D/g, "");
  if (!/^\+?[0-9]{6,31}$/.test(normalized)) throw new TenantError(400, "invalid_contact");
  return normalized;
}
function normalizeInput(data: { displayName: string; email?: string | null; phone?: string | null; notes?: string }) {
  if (!validName(data.displayName) || (data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 2000))) throw new TenantError(400, "invalid_contact");
  return { displayName: data.displayName.trim(), email: normalizeEmail(data.email), phone: normalizePhone(data.phone), notes: data.notes?.trim() ?? "" };
}

export function createCrm(db: PrismaClient) {
  return {
    async list(actor: Actor, tenantId: string, query: string, limit: number, offset: number) {
      if (typeof query !== "string" || query.length > 100 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new TenantError(400, "invalid_pagination");
      return db.$transaction(async tx => {
        const member = await requireTenantContext(tx, actor, tenantId);
        const q = query.trim();
        const phoneQuery = q.replace(/[^\d+]/g, "");
        const where = { tenantId, isActive: true, ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" as const } }, { email: { contains: q.toLowerCase() } }, ...(phoneQuery ? [{ phone: { contains: phoneQuery } }] : [])] } : {}) };
        const [items, total] = await Promise.all([
          tx.crmContact.findMany({ where, select: view, orderBy: [{ displayName: "asc" }, { id: "asc" }], take: limit, skip: offset }),
          tx.crmContact.count({ where }),
        ]);
        return { items, total, limit, offset, role: member.role };
      });
    },
    async get(actor: Actor, tenantId: string, contactId: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const contact = await tx.crmContact.findFirst({ where: { tenantId, id: contactId }, select: view });
        if (!contact) throw new TenantError(404, "not_found");
        return contact;
      });
    },
    async create(actor: Actor, tenantId: string, data: { displayName: string; email?: string | null; phone?: string | null; notes?: string }, requestId?: string) {
      const input = normalizeInput(data);
      try {
        return await db.$transaction(async tx => {
          await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
          const contact = await tx.crmContact.create({ data: { tenantId, ...input, createdById: actor.id }, select: view });
          await recordTenantEvent(tx, tenantId, actor.id, "crm.contact.created", contact.id, requestId);
          return contact;
        });
      } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "contact_exists"); throw error; }
    },
    async update(actor: Actor, tenantId: string, contactId: string, data: { displayName: string; email?: string | null; phone?: string | null; notes?: string; version: number }, requestId?: string) {
      if (!versionValid(data.version)) throw new TenantError(400, "invalid_version");
      const input = normalizeInput(data);
      try {
        return await db.$transaction(async tx => {
          await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
          const current = await tx.crmContact.findFirst({ where: { tenantId, id: contactId } });
          if (!current) throw new TenantError(404, "not_found");
          if (current.archivedAt) throw new TenantError(409, "contact_archived");
          if (current.version !== data.version) throw new TenantError(409, "version_conflict");
          const updated = await tx.crmContact.update({ where: { id: contactId }, data: { ...input, version: { increment: 1 } }, select: view });
          await recordTenantEvent(tx, tenantId, actor.id, "crm.contact.updated", contactId, requestId);
          return updated;
        });
      } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "contact_exists"); throw error; }
    },
    async archive(actor: Actor, tenantId: string, contactId: string, version: number, requestId?: string) {
      if (!versionValid(version)) throw new TenantError(400, "invalid_version");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const current = await tx.crmContact.findFirst({ where: { tenantId, id: contactId } });
        if (!current) throw new TenantError(404, "not_found");
        if (current.archivedAt) throw new TenantError(409, "contact_archived");
        if (current.version !== version) throw new TenantError(409, "version_conflict");
        const updated = await tx.crmContact.update({ where: { id: contactId }, data: { isActive: false, archivedAt: new Date(), version: { increment: 1 } }, select: view });
        await recordTenantEvent(tx, tenantId, actor.id, "crm.contact.archived", contactId, requestId);
        return updated;
      });
    },
  };
}
