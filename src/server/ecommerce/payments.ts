import { createHash } from "node:crypto";
import { Prisma, type EcomPaymentEventKind, type EcomPaymentStatus } from "../../generated/prisma/client";
import type { PrismaClient } from "../../generated/prisma/client";
import { lockTenant, recordTenantEvent, requireTenantContext, TenantError, type Actor } from "../tenancy/service";

export type VerifiedPaymentEvent = {
  tenantId: string;
  storeId: string;
  orderId: string;
  attemptId: string;
  providerCode: string;
  providerEventId: string;
  providerTransactionId?: string;
  kind: EcomPaymentEventKind;
  amount: string;
  currency: string;
  occurredAt: Date;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const attemptView = {
  id: true, tenantId: true, storeId: true, orderId: true, attemptNumber: true,
  providerCode: true, providerTransactionId: true, amount: true, currency: true,
  status: true, createdAt: true, updatedAt: true,
} as const;

function nextStatus(current: EcomPaymentStatus, incoming: EcomPaymentEventKind): EcomPaymentStatus {
  if (current === "succeeded" || current === "failed") {
    if (incoming === "processing") return current;
    if (current !== incoming) throw new TenantError(409, "payment_terminal_conflict");
    return current;
  }
  if (incoming === "processing" || incoming === "succeeded" || incoming === "failed") return incoming;
  throw new TenantError(409, "invalid_payment_transition");
}

function safeAmount(value: string) {
  if (!/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/.test(value)) throw new TenantError(400, "invalid_payment_amount");
  const amount = new Prisma.Decimal(value);
  if (amount.greaterThan("9999999999.99")) throw new TenantError(400, "invalid_payment_amount");
  return amount;
}

export function createEcommercePayments(db: PrismaClient) {
  return {
    async createAttempt(actor: Actor, tenantId: string, orderId: string, providerCode: string, idempotencyKey: string) {
      if (!/^[a-z][a-z0-9._-]{0,39}$/.test(providerCode)) throw new TenantError(400, "invalid_payment_provider");
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey)) throw new TenantError(400, "invalid_idempotency_key");
      return db.$transaction(async tx => {
        await lockTenant(tx, tenantId);
        await requireTenantContext(tx, actor, tenantId, true);
        const order = await tx.ecomOrder.findFirst({ where: { tenantId, id: orderId }, select: { id: true, storeId: true, totalAmount: true, currency: true } });
        if (!order) throw new TenantError(404, "not_found");
        const idempotencyKeyHash = hash(idempotencyKey);
        const previous = await tx.ecomPaymentAttempt.findUnique({ where: { tenantId_storeId_idempotencyKeyHash: { tenantId, storeId: order.storeId, idempotencyKeyHash } }, select: { ...attemptView, providerCode: true } });
        if (previous) {
          if (previous.orderId !== order.id || previous.providerCode !== providerCode) throw new TenantError(409, "idempotency_conflict");
          return { ...previous, amount: previous.amount.toFixed(2), replayed: true };
        }
        if (await tx.ecomPaymentAttempt.findFirst({ where: { tenantId, orderId, status: "succeeded" }, select: { id: true } })) throw new TenantError(409, "order_already_paid");
        const attemptNumber = (await tx.ecomPaymentAttempt.aggregate({ where: { tenantId, orderId }, _max: { attemptNumber: true } }))._max.attemptNumber ?? 0;
        const attempt = await tx.ecomPaymentAttempt.create({ data: {
          tenantId, storeId: order.storeId, orderId, attemptNumber: attemptNumber + 1,
          providerCode, idempotencyKeyHash, amount: order.totalAmount, currency: order.currency,
        }, select: attemptView });
        await recordTenantEvent(tx, tenantId, actor.id, "ecommerce.payment.attempt_created", attempt.id);
        return { ...attempt, amount: attempt.amount.toFixed(2), replayed: false };
      });
    },

    // Only a provider adapter that has already verified its signature may call this internal contract.
    async applyVerifiedEvent(event: VerifiedPaymentEvent, requestId?: string) {
      if (!/^[a-z][a-z0-9._-]{0,39}$/.test(event.providerCode) || typeof event.providerEventId !== "string" || !event.providerEventId || event.providerEventId.length > 512 || !["processing", "succeeded", "failed"].includes(event.kind)) throw new TenantError(400, "invalid_provider_event");
      if (!Number.isFinite(event.occurredAt.getTime()) || !/^[A-Z]{3}$/.test(event.currency)) throw new TenantError(400, "invalid_provider_event");
      const amount = safeAmount(event.amount);
      const providerEventIdHash = hash(event.providerEventId);
      return db.$transaction(async tx => {
        await lockTenant(tx, event.tenantId);
        const attempt = await tx.ecomPaymentAttempt.findFirst({ where: { tenantId: event.tenantId, storeId: event.storeId, orderId: event.orderId, id: event.attemptId }, select: attemptView });
        if (!attempt || attempt.providerCode !== event.providerCode) throw new TenantError(404, "not_found");
        if (!attempt.amount.equals(amount) || attempt.currency !== event.currency) throw new TenantError(409, "payment_amount_or_currency_mismatch");
      const providerTransactionId = event.providerTransactionId?.trim() || null;
      if (providerTransactionId && providerTransactionId.length > 160) throw new TenantError(400, "invalid_provider_event");
      if (attempt.providerTransactionId && providerTransactionId && attempt.providerTransactionId !== providerTransactionId) throw new TenantError(409, "provider_transaction_conflict");

        const existing = await tx.ecomPaymentEvent.findUnique({ where: { tenantId_providerCode_providerEventIdHash: { tenantId: event.tenantId, providerCode: event.providerCode, providerEventIdHash } } });
        if (existing) {
          if (existing.paymentAttemptId !== attempt.id || existing.kind !== event.kind || !existing.amount.equals(amount) || existing.currency !== event.currency) throw new TenantError(409, "provider_event_conflict");
          return { status: attempt.status, replayed: true, stale: false };
        }

        const status = nextStatus(attempt.status, event.kind);
        const stale = status === attempt.status && (attempt.status === "succeeded" || attempt.status === "failed") && event.kind === "processing";
        await tx.ecomPaymentEvent.create({ data: {
          tenantId: event.tenantId, storeId: event.storeId, paymentAttemptId: attempt.id,
          providerCode: event.providerCode, providerEventIdHash, kind: event.kind,
          amount, currency: event.currency, occurredAt: event.occurredAt,
        } });
        const update = status !== attempt.status || (providerTransactionId && !attempt.providerTransactionId);
        if (update) {
          await tx.ecomPaymentAttempt.update({ where: { id: attempt.id }, data: {
            status,
            ...(providerTransactionId && !attempt.providerTransactionId ? { providerTransactionId } : {}),
          } });
        }
        await recordTenantEvent(tx, event.tenantId, null, "ecommerce.payment.event_recorded", attempt.id, requestId);
        return { status, replayed: false, stale };
      });
    },
  };
}
