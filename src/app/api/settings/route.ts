import { connection } from "next/server";
import { PROVIDER_IDS, type ProviderId } from "@/lib/llm/catalog";
import { publicSettings, setApiKey } from "@/lib/store/settings";
import { bind, signedIn } from "@/lib/store/backend";

export async function GET() {
  const denied = bind(await signedIn());
  if (denied) return denied;
  await connection();
  return Response.json(await publicSettings());
}

/** { provider, apiKey } — apiKey 가 null/빈 문자열이면 저장된 키를 지운다 */
export async function PUT(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { provider?: ProviderId; apiKey?: string | null };
  if (!body.provider || !PROVIDER_IDS.includes(body.provider)) {
    return Response.json({ error: "provider 는 anthropic | openai | google 중 하나여야 합니다." }, { status: 400 });
  }
  await setApiKey(body.provider, body.apiKey ?? null);
  return Response.json(await publicSettings());
}
