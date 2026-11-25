import { connection } from "next/server";
import { applyDream, discardDream, dreamView, proposeDream, restoreDream } from "@/lib/memory/dream";
import { getLlmRuntime } from "@/lib/store/settings";
import { rejectCrossSite } from "@/lib/tools/guard";
import { bind, signedIn } from "@/lib/store/backend";

export const maxDuration = 300;

/** ?scope=&store= — 검토를 기다리는 정리안과 되돌릴 수 있는지 */
export async function GET(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  const q = new URL(req.url).searchParams;
  return Response.json(await dreamView(q.get("scope") ?? "", q.get("store") ?? ""));
}

/** { scope, store, action: propose | apply | discard | restore, model? } */
export async function POST(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const blocked = rejectCrossSite(req);
  if (blocked) return blocked;
  const b = (await req.json().catch(() => ({}))) as { scope?: string; store?: string; action?: string; model?: unknown };
  if (!b.scope || !b.store) return Response.json({ error: "scope 와 store 가 필요합니다." }, { status: 400 });
  try {
    if (b.action === "propose") return Response.json(await proposeDream({ scope: b.scope, store: b.store, model: b.model, runtime: await getLlmRuntime(), signal: req.signal }));
    if (b.action === "apply") return Response.json(await applyDream(b.scope, b.store));
    if (b.action === "discard") return Response.json(await discardDream(b.scope, b.store));
    if (b.action === "restore") return Response.json(await restoreDream(b.scope, b.store));
    return Response.json({ error: "action 은 propose | apply | discard | restore 중 하나여야 합니다." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
