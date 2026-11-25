import { PROVIDER_IDS, type ProviderId } from "../llm/catalog";
import { files } from "./backend";

/**
 * 공급자별 API 키. settings.json 에 저장한다(파일 모드에서는 data/settings.json, .gitignore 대상).
 * 우선순위: 화면에서 저장한 키 → 환경변수.
 */

type KeyFile = { keys?: Partial<Record<ProviderId, string>> };

const FILE = "settings.json";
const ENV: Record<ProviderId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

async function readFileSettings(): Promise<KeyFile> {
  const raw = (await files().read(FILE)) as (KeyFile & { anthropicApiKey?: string }) | null;
  if (!raw) return { keys: {} };
  // 이전 형식(anthropicApiKey) 호환
  if (raw.anthropicApiKey && !raw.keys?.anthropic) return { keys: { ...raw.keys, anthropic: raw.anthropicApiKey } };
  return { keys: raw.keys ?? {} };
}

export async function setApiKey(provider: ProviderId, apiKey: string | null) {
  const cur = await readFileSettings();
  const keys = { ...cur.keys };
  if (apiKey && apiKey.trim()) keys[provider] = apiKey.trim();
  else delete keys[provider];
  await files().write(FILE, { ...((await files().read(FILE)) as object | null), keys });
}

export interface LlmRuntime {
  /** LLM_MODE=mock 이면 모든 LLM 호출을 가짜 응답으로 대체(개발용) */
  mock: boolean;
  keys: Partial<Record<ProviderId, string>>;
}

function envKey(provider: ProviderId) {
  for (const name of ENV[provider]) if (process.env[name]) return { key: process.env[name]!, name };
  return null;
}

export async function getLlmRuntime(): Promise<LlmRuntime> {
  const file = await readFileSettings();
  const keys: Partial<Record<ProviderId, string>> = {};
  for (const p of PROVIDER_IDS) {
    const k = file.keys?.[p] || envKey(p)?.key;
    if (k) keys[p] = k;
  }
  return { mock: process.env.LLM_MODE === "mock", keys };
}

export interface ProviderKeyStatus {
  hasKey: boolean;
  source: "settings" | "env" | null;
  envName?: string;
  preview: string | null;
}

/** 화면에 돌려줄 키 상태(키 원문은 앞뒤 일부만) */
export async function publicSettings() {
  const file = await readFileSettings();
  const providers = {} as Record<ProviderId, ProviderKeyStatus>;
  for (const p of PROVIDER_IDS) {
    const saved = file.keys?.[p];
    const env = envKey(p);
    const key = saved || env?.key;
    providers[p] = {
      hasKey: !!key,
      source: saved ? "settings" : env ? "env" : null,
      ...(env && !saved ? { envName: env.name } : {}),
      preview: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null,
    };
  }
  return { mock: process.env.LLM_MODE === "mock", providers };
}
