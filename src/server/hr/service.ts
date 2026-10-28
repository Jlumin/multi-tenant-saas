import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { requireTenantContext, lockTenant, recordTenantEvent, TenantError, type Actor } from "../tenancy/service";
import { createTenancy } from "../tenancy/service";

type Tx = Prisma.TransactionClient;
const MAX = 2147483647;
const employeeView = { id: true, tenantId: true, userId: true, staffNumber: true, isActive: true, createdAt: true, updatedAt: true, version: true } as const;
type Field = "clock_in" | "clock_out";

function validVersion(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value >= MAX) throw new TenantError(400, "invalid_version");
}
function parseDate(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new TenantError(400, "invalid_timestamp");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TenantError(400, "invalid_timestamp");
  return date;
}
function effective(row: { clockInAt: Date; clockOutAt: Date | null; adjustments: { field: string; correctedAt: Date; createdAt: Date }[] }) {
  const latest = new Map<string, Date>();
  for (const item of row.adjustments) if (!latest.has(item.field)) latest.set(item.field, item.correctedAt);
  return { clockInAt: latest.get("clock_in") ?? row.clockInAt, clockOutAt: row.clockOutAt ? latest.get("clock_out") ?? row.clockOutAt : null };
}
function businessDate(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const date = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}
async function listMember(db: PrismaClient, actor: Actor, tenantId: string, userId: string) {
  const tenancy = createTenancy(db, async () => {}, "");
  for (let offset = 0; ; offset += 100) {
    const page = await tenancy.members(actor, tenantId, 100, offset);
    const match = page.items.find(item => item.userId === userId && item.isActive);
    if (match) return match;
    if (offset + page.limit >= page.total) return null;
  }
}
async function attendanceView(tx: Tx, tenantId: string, id: string) {
  const row = await tx.hrAttendance.findFirst({ where: { tenantId, id }, include: { adjustments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] } } });
  if (!row) throw new TenantError(404, "not_found");
  return { id: row.id, userId: row.userId, ...effective(row), createdAt: row.createdAt, adjustments: row.adjustments.map(({ field, previousAt, correctedAt, reason, createdAt }) => ({ field, previousAt, correctedAt, reason, createdAt })) };
}
function idempotencyKey(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new TenantError(400, "invalid_idempotency_key");
}

export function createHr(db: PrismaClient) {
  return {
    async employees(actor: Actor, tenantId: string, limit: number, offset: number) {
      const members = await createTenancy(db, async () => {}, "").members(actor, tenantId, 100, 0);
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId, true);
        const profiles = await tx.hrEmployee.findMany({ where: { tenantId }, select: employeeView, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit, skip: offset });
        const settings = await tx.hrTenantSetting.findUnique({ where: { tenantId } });
        const total = await tx.hrEmployee.count({ where: { tenantId } });
        const byUser = new Map(members.items.map(x => [x.userId, x]));
        const employeeIds = new Set(profiles.map(profile => profile.userId));
        return { items: profiles.map(profile => ({ ...profile, member: byUser.get(profile.userId) ?? null })), candidates: members.items.filter(member => member.isActive && !employeeIds.has(member.userId)), total, limit, offset, timezone: settings?.timeZone ?? "Asia/Taipei" };
      });
    },
    async createEmployee(actor: Actor, tenantId: string, input: { userId: string; staffNumber: string }, requestId?: string) {
      if (typeof input.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.userId) || typeof input.staffNumber !== "string" || input.staffNumber.trim().length > 40) throw new TenantError(400, "invalid_employee");
      const staffNumber = input.staffNumber.trim() || null;
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const member = await listMember(db, actor, tenantId, input.userId);
        if (!member) throw new TenantError(404, "not_found");
        const profile = await tx.hrEmployee.create({ data: { tenantId, userId: input.userId, staffNumber, createdById: actor.id }, select: employeeView });
        await recordTenantEvent(tx, tenantId, actor.id, "hr.employee.created", profile.id, requestId);
        return profile;
      }).catch(error => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "employee_exists");
        throw error;
      });
    },
    async updateEmployee(actor: Actor, tenantId: string, userId: string, data: { staffNumber: string; isActive: boolean; version: number }, requestId?: string) {
      if (typeof data.staffNumber !== "string" || data.staffNumber.trim().length > 40 || typeof data.isActive !== "boolean") throw new TenantError(400, "invalid_employee");
      validVersion(data.version);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const current = await tx.hrEmployee.findUnique({ where: { tenantId_userId: { tenantId, userId } }, select: employeeView });
        if (!current) throw new TenantError(404, "not_found");
        if (current.version !== data.version) throw new TenantError(409, "version_conflict");
        if (current.isActive && !data.isActive && await tx.hrAttendance.findFirst({ where: { tenantId, userId, clockOutAt: null }, select: { id: true } })) throw new TenantError(409, "employee_has_open_attendance");
        const updated = await tx.hrEmployee.update({ where: { tenantId_userId: { tenantId, userId } }, data: { staffNumber: data.staffNumber.trim() || null, isActive: data.isActive, version: { increment: 1 } }, select: employeeView });
        await recordTenantEvent(tx, tenantId, actor.id, "hr.employee.updated", current.id, requestId);
        return updated;
      }).catch(error => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "staff_number_exists");
        throw error;
      });
    },
    async settings(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const setting = await tx.hrTenantSetting.findUnique({ where: { tenantId }, select: { timeZone: true, updatedAt: true } });
        return setting ?? { timeZone: "Asia/Taipei", updatedAt: null };
      });
    },
    async setTimezone(actor: Actor, tenantId: string, timeZone: string, requestId?: string) {
      try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date()); } catch { throw new TenantError(400, "invalid_timezone"); }
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const setting = await tx.hrTenantSetting.upsert({ where: { tenantId }, create: { tenantId, timeZone }, update: { timeZone }, select: { timeZone: true, updatedAt: true } });
        await recordTenantEvent(tx, tenantId, actor.id, "hr.timezone.updated", tenantId, requestId);
        return setting;
      });
    },
    async history(actor: Actor, tenantId: string, limit: number, offset: number, targetUserId?: string) {
      return db.$transaction(async tx => {
        const member = await requireTenantContext(tx, actor, tenantId);
        const userId = member.role === "owner" ? targetUserId : actor.id;
        if (member.role !== "owner" && targetUserId && targetUserId !== actor.id) throw new TenantError(403, "self_only");
        const where = { tenantId, ...(userId ? { userId } : {}) };
        const rows = await tx.hrAttendance.findMany({
            where,
            include: {
              adjustments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }] },
              employee: { include: { membership: { include: { user: { select: { name: true, email: true } } } } } },
            },
            orderBy: [{ clockInAt: "desc" }, { id: "desc" }], take: limit, skip: offset,
          });
        const total = await tx.hrAttendance.count({ where });
        const setting = await tx.hrTenantSetting.findUnique({ where: { tenantId } });
        const timeZone = setting?.timeZone ?? "Asia/Taipei";
        return { items: rows.map(row => { const times = effective(row); return { id: row.id, userId: row.userId, name: row.employee.membership.user.name, staffNumber: row.employee.staffNumber, ...times, businessDate: businessDate(times.clockInAt, timeZone), createdAt: row.createdAt, adjustments: row.adjustments.map(({ field, previousAt, correctedAt, reason, createdAt }) => ({ field, previousAt, correctedAt, reason, createdAt })) }; }), total, limit, offset, timezone: timeZone, role: member.role };
      });
    },
    async current(actor: Actor, tenantId: string) {
      return db.$transaction(async tx => {
        await requireTenantContext(tx, actor, tenantId);
        const employee = await tx.hrEmployee.findUnique({ where: { tenantId_userId: { tenantId, userId: actor.id } }, select: { isActive: true } });
        if (!employee?.isActive) return { employeeActive: false, open: null };
        const row = await tx.hrAttendance.findFirst({ where: { tenantId, userId: actor.id, clockOutAt: null }, select: { id: true, clockInAt: true } });
        return { employeeActive: true, open: row };
      });
    },
    async clockIn(actor: Actor, tenantId: string, key: string, requestId?: string) {
      idempotencyKey(key);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const employee = await tx.hrEmployee.findUnique({ where: { tenantId_userId: { tenantId, userId: actor.id } } });
        if (!employee?.isActive) throw new TenantError(404, "not_found");
        const previous = await tx.hrAttendance.findUnique({ where: { tenantId_clockInKey: { tenantId, clockInKey: key } }, select: { id: true, userId: true } });
        if (previous) {
          if (previous.userId !== actor.id) throw new TenantError(409, "idempotency_conflict");
          return attendanceView(tx, tenantId, previous.id);
        }
        const active = await tx.hrAttendance.findFirst({ where: { tenantId, userId: actor.id, clockOutAt: null }, select: { id: true } });
        if (active) throw new TenantError(409, "already_clocked_in");
        const row = await tx.hrAttendance.create({ data: { tenantId, userId: actor.id, clockInKey: key } });
        await recordTenantEvent(tx, tenantId, actor.id, "hr.attendance.clocked_in", row.id, requestId);
        return attendanceView(tx, tenantId, row.id);
      }).catch(error => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "attendance_conflict");
        throw error;
      });
    },
    async clockOut(actor: Actor, tenantId: string, key: string, requestId?: string) {
      idempotencyKey(key);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId);
        const previous = await tx.hrAttendance.findUnique({ where: { tenantId_clockOutKey: { tenantId, clockOutKey: key } }, select: { id: true, userId: true } });
        if (previous) {
          if (previous.userId !== actor.id) throw new TenantError(409, "idempotency_conflict");
          return attendanceView(tx, tenantId, previous.id);
        }
        const employee = await tx.hrEmployee.findUnique({ where: { tenantId_userId: { tenantId, userId: actor.id } } });
        if (!employee?.isActive) throw new TenantError(404, "not_found");
        const row = await tx.hrAttendance.findFirst({ where: { tenantId, userId: actor.id, clockOutAt: null }, select: { id: true } });
        if (!row) throw new TenantError(409, "not_clocked_in");
        const updated = await tx.hrAttendance.update({ where: { tenantId_id: { tenantId, id: row.id } }, data: { clockOutAt: new Date(), clockOutKey: key } });
        await recordTenantEvent(tx, tenantId, actor.id, "hr.attendance.clocked_out", updated.id, requestId);
        return attendanceView(tx, tenantId, updated.id);
      }).catch(error => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") throw new TenantError(409, "attendance_conflict");
        throw error;
      });
    },
    async adjust(actor: Actor, tenantId: string, attendanceId: string, field: Field, correctedValue: string, reason: string, requestId?: string) {
      if (!(field === "clock_in" || field === "clock_out") || typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) throw new TenantError(400, "invalid_adjustment");
      const correctedAt = parseDate(correctedValue);
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId); await requireTenantContext(tx, actor, tenantId, true);
        const attendance = await attendanceView(tx, tenantId, attendanceId);
        const previousAt = field === "clock_in" ? attendance.clockInAt : attendance.clockOutAt;
        if (field === "clock_in" && !previousAt) throw new TenantError(409, "attendance_incomplete");
        if ((field === "clock_in" && attendance.clockOutAt && correctedAt > attendance.clockOutAt) || (field === "clock_out" && correctedAt < attendance.clockInAt)) throw new TenantError(400, "invalid_adjustment_range");
        if (field === "clock_out" && !previousAt) await tx.hrAttendance.update({ where: { tenantId_id: { tenantId, id: attendanceId } }, data: { clockOutAt: correctedAt, clockOutKey: `owner-correction-${randomUUID()}` } });
        const adjustment = await tx.hrAttendanceAdjustment.create({ data: { tenantId, attendanceId, field, previousAt, correctedAt, reason: reason.trim(), createdById: actor.id } });
        await recordTenantEvent(tx, tenantId, actor.id, "hr.attendance.corrected", attendanceId, requestId);
        return { id: adjustment.id, attendance: await attendanceView(tx, tenantId, attendanceId) };
      });
    },
  };
}
