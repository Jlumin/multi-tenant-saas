import { handlePublicShop } from "../../../../server/ecommerce/public-api";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return handlePublicShop(request, slug);
}
