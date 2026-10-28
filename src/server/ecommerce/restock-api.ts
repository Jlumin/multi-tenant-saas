import { randomUUID } from "node:crypto";
import { readAuthConfig } from "../auth/config";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createRestockNotifications } from "./restock";

export async function handlePublicRestock(request: Request, slug: string, action: "subscribe" | "unsubscribe" = "subscribe") {
  const requestId = randomUUID(), headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try {
    if (request.headers.get("origin") !== readAuthConfig().baseURL || request.headers.get("sec-fetch-site") === "cross-site") throw new TenantError(403, "invalid_origin");
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new TenantError(415, "invalid_content_type");
    const raw = await request.text();
    if (raw.length > 8192) throw new TenantError(413, "payload_too_large");
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new TenantError(400, "invalid_payload");
    const body = data as Record<string, unknown>;
    const allowed = action === "subscribe" ? ["productId", "email", "optIn"] : ["token"];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new TenantError(400, "invalid_payload");
    const service = createRestockNotifications(getDatabase());
    const result = action === "subscribe"
      ? typeof body.productId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.productId) && typeof body.email === "string" && typeof body.optIn === "boolean"
        ? await service.subscribe(slug, body.productId, body.email, body.optIn, requestId)
        : (() => { throw new TenantError(400, "invalid_payload"); })()
      : typeof body.token === "string"
        ? await service.unsubscribe(slug, body.token, requestId)
        : (() => { throw new TenantError(400, "invalid_payload"); })();
    return Response.json(result, { status: action === "subscribe" ? 202 : 200, headers });
  } catch (error) {
    const status = error instanceof TenantError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const code = error instanceof TenantError ? error.code : error instanceof SyntaxError ? "invalid_json" : "service_unavailable";
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
