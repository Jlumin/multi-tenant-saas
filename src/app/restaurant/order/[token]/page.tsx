import { PublicOrder } from "./public-order";

export default async function PublicOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main><p className="eyebrow">TABLE QR ORDER</p><h1>桌邊點餐</h1><PublicOrder token={token} /></main>;
}
