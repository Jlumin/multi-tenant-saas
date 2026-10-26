import { randomUUID } from "node:crypto";
import { getAuth } from "./runtime";

const allowed: Record<string, Set<string>> = {
  GET: new Set(["get-session", "verify-email", "callback/google", "error"]),
  POST: new Set(["sign-up/email", "sign-in/email", "sign-in/social", "sign-out", "request-password-reset", "reset-password", "send-verification-email"]),
};

export async function handleAuth(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const path = new URL(request.url).pathname.replace(/^\/api\/auth\//, "");
  const resetLink = request.method === "GET" && /^reset-password\/[A-Za-z0-9_-]{1,256}$/.test(path);
  if (!allowed[request.method]?.has(path) && !resetLink) return Response.json({ error: "not_found", requestId }, { status: 404 });
  try {
    const upstream = await getAuth().handler(request);
    // Redirect headers may be immutable. Preserve cookies/status when adding metadata.
    const response = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
    response.headers.set("X-Request-ID", requestId);
    response.headers.set("Cache-Control", "no-store");
    console.info(JSON.stringify({ event: "auth.request", requestId, method: request.method, path: resetLink ? "reset-password/:token" : path, status: response.status }));
    return response;
  } catch {
    console.warn(JSON.stringify({ event: "auth.unavailable", requestId }));
    return Response.json({ error: "authentication_unavailable", requestId }, { status: 503, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId } });
  }
}
