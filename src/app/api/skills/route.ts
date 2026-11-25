import { connection } from "next/server";
import { rejectCrossSite } from "@/lib/tools/guard";
import { deleteSkill, getSkill, saveSkill } from "@/lib/tools/skills";
import { bind, signedIn } from "@/lib/store/backend";

/** ?id= 스킬 하나의 본문 */
export async function GET(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const skill = await getSkill(id);
  return skill ? Response.json(skill) : Response.json({ error: "없는 스킬입니다." }, { status: 404 });
}

/** { name, description, body } — data/skills/<name>/SKILL.md 로 저장 */
export async function PUT(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const b = (await req.json().catch(() => ({}))) as { name?: string; description?: string; body?: string };
  try {
    await saveSkill(String(b.name ?? "").trim(), String(b.description ?? ""), String(b.body ?? ""));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  try {
    await deleteSkill(new URL(req.url).searchParams.get("name") ?? "");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
