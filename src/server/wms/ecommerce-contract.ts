import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { lockTenant, recordTenantEvent, requireTenantContext, TenantError, type Actor } from "../tenancy/service";
import { randomUUID } from "node:crypto";

type Tx = Prisma.TransactionClient;
export type WmsOrderReservationLine = { productId: string; quantity: number };

export async function getWmsOrderReservationStatuses(tx: Tx, tenantId: string, orderIds: string[]) {
  if (!orderIds.length) return {} as Record<string, string>;
  const items = await tx.wmsStockReservation.findMany({ where: { tenantId, sourceOrderId: { in: orderIds } }, select: { sourceOrderId: true, status: true } });
  return Object.fromEntries(items.map(item => [item.sourceOrderId, item.status]));
}

export async function requireWmsProduct(tx: Tx, tenantId: string, productId: string) {
  const product = await tx.wmsProduct.findFirst({ where: { tenantId, id: productId, isActive: true }, select: { id: true, code: true, name: true, baseUnit: true } });
  if (!product) throw new TenantError(409, "wms_product_unavailable");
  return product;
}

export async function requireWmsWarehouse(tx: Tx, tenantId: string, warehouseId: string) {
  const warehouse = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: warehouseId, isActive: true }, select: { id: true, name: true, isActive: true } });
  if (!warehouse) throw new TenantError(409, "wms_warehouse_unavailable");
  return warehouse;
}

export async function getWmsAvailableQuantity(tx: Tx, tenantId: string, warehouseId: string, productId: string) {
  const [balances, reserved] = await Promise.all([
    tx.wmsStockBalance.findMany({ where: { tenantId, warehouseId, productId, quantity: { gt: 0 } }, select: { locationId: true, quantity: true } }),
    tx.wmsStockReservationLine.groupBy({ by: ["locationId"], where: { tenantId, warehouseId, productId, reservation: { status: "active" } }, _sum: { quantity: true } }),
  ]);
  const held = new Map(reserved.map(line => [line.locationId, line._sum.quantity ?? 0]));
  return balances.reduce((total, line) => total + Math.max(0, line.quantity - (held.get(line.locationId) ?? 0)), 0);
}

export async function reserveWmsInventoryForOrder(
  tx: Tx,
  input: { tenantId: string; warehouseId: string; orderId: string; key: string; lines: WmsOrderReservationLine[] },
) {
  await lockTenant(tx, input.tenantId);
  await requireWmsWarehouse(tx, input.tenantId, input.warehouseId);
  const normalized = [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId));
  const payloadHash = createHash("sha256").update(JSON.stringify({ warehouseId: input.warehouseId, lines: normalized })).digest("hex");
  const keyHash = createHash("sha256").update(input.key).digest("hex");
  const prior = await tx.wmsStockReservation.findUnique({ where: { tenantId_sourceOrderId: { tenantId: input.tenantId, sourceOrderId: input.orderId } }, include: { lines: true } });
  if (prior) {
    if (prior.idempotencyKeyHash !== keyHash || prior.payloadHash !== payloadHash) throw new TenantError(409, "idempotency_conflict");
    return prior;
  }

  const allocations: Array<{ productId: string; locationId: string; quantity: number }> = [];
  for (const requested of normalized) {
    await requireWmsProduct(tx, input.tenantId, requested.productId);
    const balances = await tx.wmsStockBalance.findMany({ where: { tenantId: input.tenantId, warehouseId: input.warehouseId, productId: requested.productId, quantity: { gt: 0 } }, orderBy: { locationId: "asc" }, select: { locationId: true, quantity: true } });
    const reservations = await tx.wmsStockReservationLine.groupBy({ by: ["locationId"], where: { tenantId: input.tenantId, warehouseId: input.warehouseId, productId: requested.productId, reservation: { status: "active" } }, _sum: { quantity: true } });
    const held = new Map(reservations.map(line => [line.locationId, line._sum.quantity ?? 0]));
    let remaining = requested.quantity;
    for (const balance of balances) {
      const quantity = Math.min(remaining, Math.max(0, balance.quantity - (held.get(balance.locationId) ?? 0)));
      if (quantity > 0) allocations.push({ productId: requested.productId, locationId: balance.locationId, quantity });
      remaining -= quantity;
      if (!remaining) break;
    }
    if (remaining > 0) throw new TenantError(409, "insufficient_stock");
  }

  const reservation = await tx.wmsStockReservation.create({ data: {
    tenantId: input.tenantId, warehouseId: input.warehouseId, sourceOrderId: input.orderId, idempotencyKeyHash: keyHash, payloadHash,
  } });
  await tx.wmsStockReservationLine.createMany({ data: allocations.map(line => ({ ...line, tenantId: input.tenantId, warehouseId: input.warehouseId, reservationId: reservation.id })) });
  return tx.wmsStockReservation.findUniqueOrThrow({ where: { tenantId_sourceOrderId: { tenantId: input.tenantId, sourceOrderId: input.orderId } }, include: { lines: true } });
}

export async function releaseWmsOrderReservation(tx: Tx, actor: Actor, tenantId: string, orderId: string, stockStillInWarehouseConfirmed: boolean, requestId?: string) {
  if (stockStillInWarehouseConfirmed !== true) throw new TenantError(400, "stock_confirmation_required");
  await lockTenant(tx, tenantId);
  await requireTenantContext(tx, actor, tenantId, true);
  const reservation = await tx.wmsStockReservation.findUnique({ where: { tenantId_sourceOrderId: { tenantId, sourceOrderId: orderId } } });
  if (!reservation) throw new TenantError(404, "not_found");
  if (reservation.status !== "active") throw new TenantError(409, "reservation_not_active");
  await tx.wmsStockReservation.update({ where: { tenantId_sourceOrderId: { tenantId, sourceOrderId: orderId } }, data: { status: "released" } });
  await recordTenantEvent(tx, tenantId, actor.id, "wms.ecommerce_reservation.released", orderId, requestId);
  return { orderId, status: "released" as const };
}

export async function fulfillWmsOrderReservation(tx: Tx, actor: Actor, tenantId: string, orderId: string, shipmentConfirmed: boolean, requestId: string) {
  if (shipmentConfirmed !== true) throw new TenantError(400, "shipment_confirmation_required");
  await lockTenant(tx, tenantId);
  await requireTenantContext(tx, actor, tenantId, true);
  const reservation = await tx.wmsStockReservation.findUnique({ where: { tenantId_sourceOrderId: { tenantId, sourceOrderId: orderId } }, include: { lines: true } });
  if (!reservation) throw new TenantError(404, "not_found");
  const key = `ecom-order-${orderId}`;
  if (reservation.status === "fulfilled") {
    const previous = await tx.wmsPostingKey.findUnique({ where: { tenantId_key: { tenantId, key } }, include: { document: true } });
    if (previous) return { orderId, status: "fulfilled" as const, documentId: previous.documentId, replayed: true };
    throw new TenantError(409, "reservation_not_active");
  }
  if (reservation.status !== "active") throw new TenantError(409, "reservation_not_active");
  const warehouse = await tx.wmsWarehouse.findFirst({ where: { tenantId, id: reservation.warehouseId, isActive: true } });
  if (!warehouse) throw new TenantError(409, "master_inactive");
  const id = randomUUID(), number = `OUT-${randomUUID().slice(0, 8).toUpperCase()}`, postedAt = new Date();
  await tx.wmsDocument.create({ data: { id, tenantId, warehouseId: reservation.warehouseId, number, type: "outbound", memo: `E-Commerce order ${orderId}`, createdById: actor.id } });
  const lines = [];
  for (const [index, item] of reservation.lines.entries()) {
    const [product, unit, location, balance] = await Promise.all([
      tx.wmsProduct.findFirst({ where: { tenantId, id: item.productId, isActive: true } }),
      tx.wmsProductUnit.findFirst({ where: { tenantId, productId: item.productId, isBase: true, isActive: true } }),
      tx.wmsLocation.findFirst({ where: { tenantId, warehouseId: item.warehouseId, id: item.locationId, isActive: true } }),
      tx.wmsStockBalance.findUnique({ where: { tenantId_productId_warehouseId_locationId: { tenantId, productId: item.productId, warehouseId: item.warehouseId, locationId: item.locationId } } }),
    ]);
    if (!product || !unit || !location) throw new TenantError(409, "master_inactive");
    if ((balance?.quantity ?? 0) < item.quantity) throw new TenantError(409, "insufficient_stock");
    const line = await tx.wmsDocumentLine.create({ data: { tenantId, documentId: id, warehouseId: item.warehouseId, productId: item.productId, locationId: item.locationId, unitId: unit.id, unitCode: unit.code, unitName: unit.name, baseUnit: product.baseUnit, quantity: item.quantity, factor: 1, unitVersion: unit.version, baseQuantity: item.quantity, position: index + 1 } });
    lines.push({ lineId: line.id, productId: item.productId, warehouseId: item.warehouseId, locationId: item.locationId, quantity: item.quantity });
  }
  await tx.wmsDocument.update({ where: { tenantId_id: { tenantId, id } }, data: { status: "posted", postedById: actor.id, postedAt, version: { increment: 1 } } });
  await tx.wmsStockMovement.createMany({ data: lines.map(line => ({ tenantId, documentId: id, lineId: line.lineId, productId: line.productId, warehouseId: line.warehouseId, locationId: line.locationId, delta: -line.quantity, actorId: actor.id, requestId })) });
  const payloadHash = createHash("sha256").update(JSON.stringify({ orderId, reservationId: reservation.id, lines })).digest("hex");
  await tx.wmsPostingKey.create({ data: { tenantId, key, documentId: id, payloadHash } });
  await tx.wmsStockReservation.update({ where: { tenantId_sourceOrderId: { tenantId, sourceOrderId: orderId } }, data: { status: "fulfilled" } });
  await recordTenantEvent(tx, tenantId, actor.id, "wms.ecommerce_reservation.fulfilled", orderId, requestId);
  return { orderId, status: "fulfilled" as const, documentId: id, replayed: false };
}
