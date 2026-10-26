import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, MembershipRole } from "../../generated/prisma/client";

export class TenantError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export interface Actor { id: string; email: string; emailVerified: boolean }
type Tx = Prisma.TransactionClient;
// Public platform contracts shared by tenant-scoped business services.
export { context as requireTenantContext, lock as lockTenant, audit as recordTenantEvent };
type Mail = (message: { to: string; subject: string; text: string }) => Promise<void>;
const invitationView = { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true } as const;
const memberView = { userId: true, role: true, isActive: true, user: { select: { name: true, email: true } } } as const;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

async function context(tx: Tx, actor: Actor, tenantId: string, owner = false) {
  if (!actor.emailVerified) throw new TenantError(401, "unauthenticated");
  const member = await tx.membership.findFirst({ where: { tenantId, userId: actor.id, isActive: true, tenant: { isActive: true }, user: { emailVerified: true } }, include: { tenant: true } });
  if (!member) throw new TenantError(404, "not_found");
  if (owner && member.role !== "owner") throw new TenantError(403, "owner_required");
  return member;
}
async function lock(tx: Tx, tenantId: string) {
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
}
async function audit(tx: Tx, tenantId: string, actorId: string | null, action: string, targetId: string, requestId?: string) {
  await tx.tenantAudit.create({ data: { tenantId, actorId, action, targetId, requestId } });
}

export function createTenancy(db: PrismaClient, mail: Mail, baseURL: string) {
  return {
    async provision(name: string, slug: string, ownerId: string) {
      if (!name.trim() || name.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new TenantError(400, "invalid_tenant");
      return db.$transaction(async tx => {
        const owner = await tx.user.findFirst({ where: { id: ownerId, emailVerified: true } });
        if (!owner) throw new TenantError(400, "verified_owner_required");
        const tenant = await tx.tenant.create({ data: { name: name.trim(), slug } });
        await tx.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: "owner" } });
        await audit(tx, tenant.id, null, "tenant.provisioned", tenant.id);
        return { id: tenant.id, name: tenant.name, slug: tenant.slug };
      });
    },
    async list(actor: Actor, limit: number, offset: number) {
      if (!actor.emailVerified) throw new TenantError(401, "unauthenticated");
      const where = { userId: actor.id, isActive: true, tenant: { isActive: true }, user: { emailVerified: true } };
      const [items, total] = await db.$transaction([
        db.membership.findMany({ where, select: { role: true, tenant: { select: { id: true, name: true, slug: true } } }, orderBy: { tenantId: "asc" }, take: limit, skip: offset }),
        db.membership.count({ where }),
      ]);
      return { items, total, limit, offset };
    },
    async detail(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => {
        const member = await context(tx, actor, tenantId);
        return { id: member.tenant.id, name: member.tenant.name, slug: member.tenant.slug, role: member.role };
      });
    },
    async members(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => {
        await context(tx, actor, tenantId, true);
        const where = { tenantId };
        return { items: await tx.membership.findMany({ where, select: memberView, orderBy: { userId: "asc" }, take: limit, skip: offset }), total: await tx.membership.count({ where }), limit, offset };
      });
    },
    async changeMember(actor: Actor, tenantId: string, userId: string, data: { role?: MembershipRole; isActive?: boolean }, requestId?: string) {
      return db.$transaction(async tx => {
        await lock(tx, tenantId);
        await context(tx, actor, tenantId, true);
        const target = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } }, include: { user: true } });
        if (!target) throw new TenantError(404, "not_found");
        const nextRole = data.role ?? target.role; const active = data.isActive ?? target.isActive;
        if (target.role === "owner" && target.isActive && (nextRole !== "owner" || !active)) {
          const remaining = await tx.membership.count({ where: { tenantId, userId: { not: userId }, role: "owner", isActive: true, user: { emailVerified: true } } });
          if (!remaining) throw new TenantError(409, "last_owner_required");
        }
        const changed = await tx.membership.update({ where: { tenantId_userId: { tenantId, userId } }, data, select: memberView });
        await tx.invitation.updateMany({ where: { tenantId, acceptedAt: null, revokedAt: null, OR: [{ email: target.user.email.toLowerCase() }, ...((!active || nextRole !== "owner") ? [{ createdById: userId }] : [])] }, data: { revokedAt: new Date() } });
        await audit(tx, tenantId, actor.id, "membership.changed", userId, requestId);
        return changed;
      });
    },
    async invitations(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => {
        await context(tx, actor, tenantId, true);
        return { items: await tx.invitation.findMany({ where: { tenantId }, select: invitationView, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }), total: await tx.invitation.count({ where: { tenantId } }), limit, offset };
      });
    },
    async invite(actor: Actor, tenantId: string, email: string, role: MembershipRole, requestId?: string) {
      const normalized = email.trim().toLowerCase();
      if (normalized.length > 254 || /[<>()",;\\]/.test(normalized) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new TenantError(400, "invalid_email");
      const token = randomBytes(32).toString("base64url");
      const invitation = await db.$transaction(async tx => {
        await lock(tx, tenantId);
        await context(tx, actor, tenantId, true);
        if (await tx.invitation.count({ where: { tenantId, createdById: actor.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } }) >= 20) throw new TenantError(429, "invitation_rate_limited");
        if (await tx.membership.findFirst({ where: { tenantId, isActive: true, user: { email: normalized } } })) throw new TenantError(409, "already_member");
        await tx.invitation.updateMany({ where: { tenantId, email: normalized, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        const entry = await tx.invitation.create({ data: { tenantId, createdById: actor.id, email: normalized, role, tokenHash: digest(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }, select: invitationView });
        await audit(tx, tenantId, actor.id, "invitation.created", entry.id, requestId);
        return entry;
      });
      try {
        const url = new URL("/invite", baseURL); url.searchParams.set("token", token);
        await mail({ to: normalized, subject: "工作空間加入邀請", text: `請使用收件帳號登入並驗證電子郵件後開啟連結。邀請有效期限為 24 小時。\n${url}` });
      } catch {
        await db.$transaction(async tx => {
          await lock(tx, tenantId);
          await tx.invitation.updateMany({ where: { id: invitation.id, tenantId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
          await audit(tx, tenantId, actor.id, "invitation.delivery_failed", invitation.id, requestId);
        });
        throw new TenantError(502, "invitation_delivery_failed");
      }
      return invitation;
    },
    async revoke(actor: Actor, tenantId: string, invitationId: string, requestId?: string) {
      return db.$transaction(async tx => {
        await lock(tx, tenantId); await context(tx, actor, tenantId, true);
        const entry = await tx.invitation.findFirst({ where: { id: invitationId, tenantId } });
        if (!entry) throw new TenantError(404, "not_found");
        if (entry.acceptedAt) throw new TenantError(409, "invitation_already_used");
        const revoked = await tx.invitation.update({ where: { id: entry.id }, data: { revokedAt: new Date() }, select: invitationView });
        await audit(tx, tenantId, actor.id, "invitation.revoked", entry.id, requestId);
        return revoked;
      });
    },
    async accept(actor: Actor, token: string, requestId?: string) {
      if (!actor.emailVerified || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TenantError(400, "invalid_invitation");
      return db.$transaction(async tx => {
        const found = await tx.invitation.findUnique({ where: { tokenHash: digest(token) } });
        if (!found) throw new TenantError(400, "invalid_invitation");
        await lock(tx, found.tenantId);
        const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: found.id }, include: { tenant: true, creator: { include: { user: { select: { emailVerified: true } } } } } });
        if (!invitation.tenant.isActive || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date() || invitation.email !== actor.email.toLowerCase() || !invitation.creator.isActive || invitation.creator.role !== "owner" || !invitation.creator.user.emailVerified) throw new TenantError(400, "invalid_invitation");
        const user = await tx.user.findFirst({ where: { id: actor.id, email: invitation.email, emailVerified: true } });
        if (!user) throw new TenantError(400, "invalid_invitation");
        const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: found.tenantId, userId: actor.id } } });
        if (existing?.isActive) throw new TenantError(409, "already_member");
        await tx.membership.upsert({ where: { tenantId_userId: { tenantId: found.tenantId, userId: actor.id } }, create: { tenantId: found.tenantId, userId: actor.id, role: invitation.role }, update: { role: invitation.role, isActive: true } });
        await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
        await audit(tx, found.tenantId, actor.id, "invitation.accepted", invitation.id, requestId);
        return { tenantId: found.tenantId };
      });
    },
    async events(actor: Actor, tenantId: string, limit: number, offset: number) {
      return db.$transaction(async tx => {
        await context(tx, actor, tenantId, true);
        return { items: await tx.tenantAudit.findMany({ where: { tenantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset }), total: await tx.tenantAudit.count({ where: { tenantId } }), limit, offset };
      });
    },
  };
}
