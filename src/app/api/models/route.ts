import { connection } from "next/server";
import { PROVIDER_IDS, type ProviderId } from "@/lib/llm/catalog";
import { describeError, listModels } from "@/lib/llm/client";
import { getLlmRuntime } from "@/lib/store/settings";
import { bind, signedIn } from "@/lib/store/backend";

/** 키가 있으면 공급자 API에서 실제 사용 가능한 모델 목록을 가져온다(10분 캐시). */
export async function GET(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  const provider = new URL(req.url).searchParams.get("provider") as ProviderId | null;
  if (!provider || !PROVIDER_IDS.includes(provider)) return Response.json({ error: "provider 가 필요합니다." }, { status: 400 });
  const key = (await getLlmRuntime()).keys[provider];
  if (!key) return Response.json({ models: [], hasKey: false });
  try {
    return Response.json({ models: await listModels(provider, key), hasKey: true });
  } catch (e) {
    return Response.json({ models: [], hasKey: true, error: describeError(e) });
  }
}
