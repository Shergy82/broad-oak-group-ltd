export const runtime = "nodejs";
export async function GET() {
  return new Response("a679883e\n", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
