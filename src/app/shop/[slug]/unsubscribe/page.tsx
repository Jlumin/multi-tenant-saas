import { UnsubscribeForm } from "./unsubscribe-form";

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ token?: string }> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <main><UnsubscribeForm slug={slug} token={query.token ?? ""} /></main>;
}
