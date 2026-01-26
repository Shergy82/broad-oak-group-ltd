import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

export async function GET() {
  const p = join(process.cwd(), "public", "__deploy_marker__.txt");
  const body = readFileSync(p, "utf8");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
