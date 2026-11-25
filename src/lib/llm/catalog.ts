/**
 * 3사 모델 카탈로그와 하이퍼파라미터 정의. 서버(실행)와 클라이언트(노드 설정 폼)가 함께 쓴다.
 * 파라미터 값은 Dify DSL의 model.completion_params 에 그대로 저장한다.
 * 모델 목록은 2026-11 기준 각사 문서를 따랐고, API 키가 있으면 화면에서 실시간 목록을 함께 보여 준다.
 */

export type ProviderId = "anthropic" | "openai" | "google";

export const PROVIDERS: Record<ProviderId, { label: string; short: string; color: string; keyHint: string; console: string }> = {
  anthropic: { label: "Anthropic Claude", short: "Claude", color: "#c2410c", keyHint: "sk-ant-…", console: "console.anthropic.com → API Keys" },
  openai: { label: "OpenAI GPT", short: "GPT", color: "#0f766e", keyHint: "sk-…", console: "platform.openai.com → API keys" },
  google: { label: "Google Gemini", short: "Gemini", color: "#1d4ed8", keyHint: "AIza…", console: "aistudio.google.com → Get API key" },
};
export const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "google"];

export interface ParamDef {
  key: string;
  label: string;
  kind: "number" | "select" | "toggle" | "tags";
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  default: unknown;
  /** 새 노드를 만들거나 모델을 바꿀 때 켜 둘지 */
  on?: boolean;
  help: string;
}

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  label: string;
  summary: string;
  context?: string;
  maxOutput?: string;
  params: ParamDef[];
  /** 카탈로그에 없는 모델 ID — 일반 파라미터 세트로 처리 */
  generic?: boolean;
}

// ───────────────────────── 파라미터 묶음 ─────────────────────────

const claudeParams = (defaultEffort: string): ParamDef[] => [
  { key: "max_tokens", label: "max_tokens", kind: "number", min: 1, max: 128000, step: 1, default: 16000, on: true, help: "사고(thinking)와 응답을 합친 최대 출력 토큰. Messages API 필수 값." },
  { key: "effort", label: "effort", kind: "select", options: ["low", "medium", "high", "xhigh", "max"], default: defaultEffort, on: true, help: `사고 깊이와 토큰 사용량. 이 모델 기본값은 ${defaultEffort}. 분류·짧은 답은 low, 복잡한 추론은 high 이상.` },
  { key: "thinking_display", label: "thinking 표시", kind: "select", options: ["summarized", "omitted"], default: "summarized", on: true, help: "summarized 면 추론 요약이 실행 기록에 나옵니다. 비용·품질은 같습니다." },
  { key: "stop_sequences", label: "stop_sequences", kind: "tags", default: [], help: "이 문자열이 나오면 생성을 멈춥니다." },
];

const openaiParams = (efforts: string[], defaultEffort: string | null): ParamDef[] => [
  { key: "max_output_tokens", label: "max_output_tokens", kind: "number", min: 16, max: 128000, step: 1, default: 25000, on: true, help: "추론 토큰 + 보이는 출력의 합계. OpenAI는 처음엔 25,000 이상을 권장합니다." },
  {
    key: "reasoning_effort",
    label: "reasoning.effort",
    kind: "select",
    options: efforts,
    default: defaultEffort ?? "medium",
    on: defaultEffort !== null,
    help: `추론 깊이. 이 모델 지원 값: ${efforts.join(", ")}.`,
  },
  { key: "reasoning_summary", label: "reasoning.summary", kind: "select", options: ["auto", "concise", "detailed"], default: "auto", help: "추론 요약을 받아 실행 기록에 표시. 최신 추론 모델은 조직 인증이 필요할 수 있습니다." },
  { key: "verbosity", label: "text.verbosity", kind: "select", options: ["low", "medium", "high"], default: "medium", help: "응답 길이 경향. 지원하지 않는 모델은 오류를 낼 수 있습니다." },
  { key: "temperature", label: "temperature", kind: "number", min: 0, max: 2, step: 0.05, default: 1, help: "샘플링 온도. 추론 모델은 이 값을 거부할 수 있습니다." },
  { key: "top_p", label: "top_p", kind: "number", min: 0, max: 1, step: 0.01, default: 1, help: "누적 확률 샘플링. temperature 와 함께 바꾸지 않는 것을 권장." },
];

const geminiParams = (levels: string[], defaultLevel: string | null): ParamDef[] => [
  {
    key: "thinking_level",
    label: "thinkingLevel",
    kind: "select",
    options: levels,
    default: defaultLevel ?? levels[0],
    on: defaultLevel !== null,
    help: `사고 깊이. 이 모델 지원 값: ${levels.join(", ")}${defaultLevel ? ` (기본 ${defaultLevel})` : " (기본은 사고 꺼짐)"}.`,
  },
  { key: "include_thoughts", label: "includeThoughts", kind: "toggle", default: true, on: true, help: "사고 요약을 받아 실행 기록에 표시합니다." },
  { key: "max_output_tokens", label: "maxOutputTokens", kind: "number", min: 1, max: 65536, step: 1, default: 16384, help: "최대 출력 토큰(사고 포함). 끄면 모델 최대값." },
  { key: "temperature", label: "temperature", kind: "number", min: 0, max: 2, step: 0.05, default: 1, help: "샘플링 온도. 최신 Gemini는 기본값(1.0) 유지를 권장합니다." },
  { key: "top_p", label: "topP", kind: "number", min: 0, max: 1, step: 0.01, default: 0.95, help: "누적 확률 샘플링." },
  { key: "top_k", label: "topK", kind: "number", min: 1, max: 100, step: 1, default: 64, help: "상위 K개 토큰에서 샘플링." },
  { key: "stop_sequences", label: "stopSequences", kind: "tags", default: [], help: "이 문자열이 나오면 생성을 멈춥니다." },
];

// ───────────────────────── 모델 카탈로그 ─────────────────────────

export const MODEL_CATALOG: ModelSpec[] = [
  // Anthropic
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", summary: "기본 추천. 복잡한 추론·에이전트 작업", context: "1M", maxOutput: "128K", params: claudeParams("medium") },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", summary: "속도와 성능의 균형", context: "1M", maxOutput: "128K", params: claudeParams("high") },
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", summary: "가장 빠르고 저렴. 분류·추출", context: "1M", maxOutput: "128K", params: claudeParams("medium") },
  { id: "claude-fable-5-2", provider: "anthropic", label: "Claude Fable 5.2", summary: "가장 강력한 모델(비용 높음)", context: "1M", maxOutput: "128K", params: claudeParams("high") },
  // OpenAI
  { id: "gpt-6-astra", provider: "openai", label: "GPT-6 Astra", summary: "플래그십. 복잡한 추론·코딩", params: openaiParams(["low", "medium", "high", "xhigh", "max"], "medium") },
  { id: "gpt-6.1-sol", provider: "openai", label: "GPT-6.1 Sol", summary: "Astra에 가까운 성능, 더 저렴", params: openaiParams(["low", "medium", "high", "xhigh", "max"], "medium") },
  { id: "gpt-6.1-terra", provider: "openai", label: "GPT-6.1 Terra", summary: "빠르고 효율적", params: openaiParams(["none", "low", "medium", "high", "xhigh", "max"], "medium") },
  { id: "gpt-6-luna", provider: "openai", label: "GPT-6 Luna", summary: "대량·저비용 작업", params: openaiParams(["none", "low", "medium", "high", "xhigh", "max"], "medium") },
  // Google
  { id: "gemini-4-carbon", provider: "google", label: "Gemini 4 Carbon", summary: "가장 강한 추론", context: "1M", params: geminiParams(["low", "medium", "high"], "medium") },
  { id: "gemini-4-argon", provider: "google", label: "Gemini 4 Argon", summary: "효율적인 프런티어 추론", params: geminiParams(["low", "medium", "high"], "medium") },
  { id: "gemini-4-hydrogen", provider: "google", label: "Gemini 4 Hydrogen", summary: "속도·효율, 코딩·에이전트", params: geminiParams(["low", "medium", "high", "xhigh"], "high") },
  { id: "gemini-3.8-flash", provider: "google", label: "Gemini 3.8 Flash", summary: "안정판 Flash", params: geminiParams(["low", "medium", "high"], "medium") },
  { id: "gemini-3.6-flash", provider: "google", label: "Gemini 3.6 Flash", summary: "안정판 Flash", params: geminiParams(["minimal", "low", "medium", "high"], "medium") },
  { id: "gemini-3.5-flash-lite", provider: "google", label: "Gemini 3.5 Flash-Lite", summary: "가장 가볍고 저렴", params: geminiParams(["minimal", "low", "medium", "high"], "minimal") },
  { id: "gemini-3.1-pro-preview", provider: "google", label: "Gemini 3.1 Pro (preview)", summary: "프리뷰", params: geminiParams(["low", "medium", "high"], "high") },
];

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-6.1-sol",
  google: "gemini-4-argon",
};

// ───────────────────────── 조회·정규화 ─────────────────────────

/** Dify DSL의 provider 문자열(예: "langgenius/openai/openai")과 모델 이름으로 공급자를 판단한다. */
export function inferProvider(provider?: string, name?: string): ProviderId {
  const p = (provider ?? "").toLowerCase();
  if (p.includes("anthropic")) return "anthropic";
  if (p.includes("openai")) return "openai";
  if (p.includes("gemini") || p.includes("google") || p.includes("vertex")) return "google";
  const n = (name ?? "").toLowerCase();
  if (n.startsWith("claude")) return "anthropic";
  if (/^(gpt|o\d|chatgpt)/.test(n)) return "openai";
  if (n.startsWith("gemini")) return "google";
  return "anthropic";
}

export function specFor(provider: ProviderId, modelId: string): ModelSpec {
  const known = MODEL_CATALOG.find((m) => m.provider === provider && m.id === modelId);
  if (known) return known;
  // 카탈로그에 없는 모델(실시간 목록·직접 입력)은 공급자별 일반 파라미터 세트
  const params =
    provider === "anthropic"
      ? claudeParams("medium")
      : provider === "openai"
        ? openaiParams(["none", "minimal", "low", "medium", "high", "xhigh", "max"], null)
        : geminiParams(["minimal", "low", "medium", "high", "xhigh"], null);
  return { id: modelId, provider, label: modelId, summary: "카탈로그 밖 모델 — 일반 파라미터 세트", params, generic: true };
}

/** 공급자마다 Dify가 쓰는 다른 이름의 파라미터를 이 앱의 키로 맞춘다. */
const ALIASES: Record<ProviderId, Record<string, string>> = {
  anthropic: { max_tokens_to_sample: "max_tokens", reasoning_effort: "effort" },
  openai: { max_tokens: "max_output_tokens", max_completion_tokens: "max_output_tokens", effort: "reasoning_effort" },
  google: { max_tokens: "max_output_tokens", effort: "thinking_level" },
};

export function defaultParams(spec: ModelSpec): Record<string, unknown> {
  return Object.fromEntries(spec.params.filter((p) => p.on).map((p) => [p.key, p.default]));
}

export interface ResolvedModel {
  provider: ProviderId;
  model: string;
  spec: ModelSpec;
  /** 실제 요청에 반영할 파라미터 */
  params: Record<string, unknown>;
  /** 이 모델이 받지 않아 무시한 파라미터 */
  ignored: Record<string, unknown>;
}

/** DSL의 model 블록 → 실제 호출할 공급자·모델·파라미터 */
export function resolveModelConfig(model: unknown): ResolvedModel {
  const m = (model ?? {}) as { provider?: string; name?: string; completion_params?: Record<string, unknown> };
  const provider = inferProvider(m.provider, m.name);
  const id = m.name?.trim() || DEFAULT_MODEL[provider];
  const spec = specFor(provider, id);
  const keys = new Set(spec.params.map((p) => p.key));
  const params: Record<string, unknown> = {};
  const ignored: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(m.completion_params ?? {})) {
    const key = ALIASES[provider][rawKey] ?? rawKey;
    if (value === null || value === undefined || value === "") continue;
    if (keys.has(key)) params[key] = value;
    else ignored[rawKey] = value;
  }
  return { provider, model: id, spec, params, ignored };
}
