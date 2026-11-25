import { connection } from "next/server";
import { listTemplates } from "@/lib/store/templates";
import { bind, signedIn } from "@/lib/store/backend";

export async function GET() {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  return Response.json({ templates: await listTemplates() });
}
