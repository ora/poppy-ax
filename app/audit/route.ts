import { noJsCheckTarget } from "@/lib/no-js-check";

// The domain box without JavaScript (Ruling R38): GET /audit?domain=...
// goes to the result page, or back home with the message to show.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const target = noJsCheckTarget(url.searchParams.get("domain"));
  return new Response(null, { status: 307, headers: { location: target, "cache-control": "no-store" } });
}
