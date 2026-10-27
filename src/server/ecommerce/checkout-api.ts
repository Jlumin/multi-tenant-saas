import { randomUUID } from "node:crypto";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createEcommerceOrders, validateCheckout } from "./orders";

export async function handlePublicCheckout(request: Request, slug: string): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    if (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site") throw new TenantError(403, "invalid_origin");
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new TenantError(415, "invalid_content_type");
    const key = request.headers.get("idempotency-key") ?? "";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw new TenantError(400, "invalid_idempotency_key");
    const text = await request.text();
    if (text.length > 16384) throw new TenantError(413, "payload_too_large");
    const input = validateCheckout(JSON.parse(text));
    const order = await createEcommerceOrders(getDatabase()).checkout(slug, key, input, requestId);
    console.info(JSON.stringify({ event: "ecommerce.checkout", requestId, replayed: order.replayed }));
    return Response.json(order, { status: order.replayed ? 200 : 201, headers });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    if (status === 503) console.error(JSON.stringify({ event: "ecommerce.checkout.failed", requestId, errorType: error instanceof Error ? error.name : typeof error }));
    console.warn(JSON.stringify({ event: "ecommerce.checkout.denied", requestId, status, code }));
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
