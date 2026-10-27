import { handlePublicCheckout } from "../../../../../server/ecommerce/checkout-api";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  return handlePublicCheckout(request, slug);
}
