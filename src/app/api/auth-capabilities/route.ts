export function GET(): Response {
  return Response.json({ google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }, { headers: { "Cache-Control": "no-store" } });
}
