// Liveness only. Do not import database clients or expose environment metadata here.
export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
