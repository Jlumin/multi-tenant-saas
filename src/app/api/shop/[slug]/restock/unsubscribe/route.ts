import { handlePublicRestock } from "../../../../../../server/ecommerce/restock-api";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return handlePublicRestock(request, slug, "unsubscribe");
}
