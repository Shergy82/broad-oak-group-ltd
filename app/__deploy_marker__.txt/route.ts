export const runtime = "nodejs";

export async function GET() {
  const rev = process.env.K_REVISION || "no-K_REVISION";
  const svc = process.env.K_SERVICE || "no-K_SERVICE";
  const body = `${svc}\n${rev}\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
