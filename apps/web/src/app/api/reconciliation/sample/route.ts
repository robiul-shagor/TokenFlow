import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connection, type NextRequest } from "next/server";
import { jsonError } from "@/server/http";

const FILES = {
  example: "allocations.example.csv",
  issues: "allocations.with-issues.csv",
} as const;

/** Download one of the sample CSVs from /sample-data. `?variant=example|issues` */
export async function GET(req: NextRequest) {
  await connection();
  const variant = (req.nextUrl.searchParams.get("variant") ?? "example") as keyof typeof FILES;
  const file = FILES[variant];
  if (!file) return jsonError(400, "variant must be example or issues");
  try {
    const text = await readFile(resolve(process.cwd(), "../../sample-data", file), "utf8");
    return new Response(text, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"` },
    });
  } catch {
    return jsonError(404, "Sample file not found");
  }
}
