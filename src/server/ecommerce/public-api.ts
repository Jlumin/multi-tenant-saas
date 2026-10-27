import { randomUUID } from "node:crypto";
import { getDatabase } from "../platform";
import { TenantError } from "../tenancy/service";
import { createEcommerce } from "./service";
export async function handlePublicShop(_request: Request, slug: string): Promise<Response> {
  const requestId = randomUUID(); const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  try { return Response.json(await createEcommerce(getDatabase()).publicStore(slug), { headers }); }
  catch (error) {
    const status = error instanceof TenantError ? error.status : 503; const code = error instanceof TenantError ? error.code : "service_unavailable";
    return Response.json({ error: { code, requestId } }, { status, headers });
  }
}
