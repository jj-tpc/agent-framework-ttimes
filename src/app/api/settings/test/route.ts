import { PROVIDER_IDS, type ProviderId } from "@/lib/llm/catalog";
import { testConnection } from "@/lib/llm/client";
import { getLlmRuntime } from "@/lib/store/settings";
import { bind, signedIn } from "@/lib/store/backend";

/** 입력한 키(저장 전) 또는 저장된 키로 모델 목록 API를 호출해 확인한다. 토큰을 쓰지 않는다. */
export async function POST(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { provider?: ProviderId; apiKey?: string };
  if (!body.provider || !PROVIDER_IDS.includes(body.provider)) return Response.json({ ok: false, error: "provider 가 필요합니다." });
  const key = body.apiKey?.trim() || (await getLlmRuntime()).keys[body.provider];
  if (!key) return Response.json({ ok: false, error: "확인할 API 키가 없습니다." });
  return Response.json(await testConnection(body.provider, key));
}
