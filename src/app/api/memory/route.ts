import { connection } from "next/server";
import { clearMemory, loadMemory } from "@/lib/memory/store";
import { bind, signedIn } from "@/lib/store/backend";

/** 메모리 저장소 내용 보기(설정 패널의 '저장소 내용') */
export async function GET(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "";
  const store = url.searchParams.get("store") ?? "";
  if (!scope || !store) return Response.json({ error: "scope 와 store 가 필요합니다." }, { status: 400 });
  const m = await loadMemory(scope, store);
  return Response.json({
    docs: Object.entries(m.docs).map(([key, d]) => ({ key, text: d.text, updatedAt: d.updatedAt, ...(d.prov ? { prov: d.prov } : {}) })),
    records: m.records,
  });
}

/** 저장소 비우기 */
export async function DELETE(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "";
  const store = url.searchParams.get("store") ?? "";
  if (!scope || !store) return Response.json({ error: "scope 와 store 가 필요합니다." }, { status: 400 });
  await clearMemory(scope, store);
  return Response.json({ ok: true });
}
