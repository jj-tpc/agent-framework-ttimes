import { readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { runCode } from "../engine/nodes/code-runner";
import { loadDataset, rankChunks, type Chunk } from "../knowledge/store";
import { searchSessions } from "../memory/sessions";
import { type CustomTool, type ToolOutput } from "./config";

type Args = Record<string, unknown>;
const args = (input: unknown): Args => (input && typeof input === "object" ? (input as Args) : {});
const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

// ───────────────────────── 내장 도구 ─────────────────────────

function currentTime(input: unknown): ToolOutput {
  const timeZone = String(args(input).timezone || "Asia/Seoul");
  const now = new Date();
  try {
    const local = new Intl.DateTimeFormat("ko-KR", { timeZone, dateStyle: "full", timeStyle: "long" }).format(now);
    return { output: JSON.stringify({ iso_utc: now.toISOString(), timezone: timeZone, local }) };
  } catch {
    return { output: `모르는 시간대: ${timeZone}`, isError: true };
  }
}

const MATH_NAMES = new Set(Object.getOwnPropertyNames(Math));

function calculator(input: unknown): ToolOutput {
  const expression = String(args(input).expression ?? "").trim();
  if (!expression) return { output: "expression 이 비어 있습니다.", isError: true };
  if (!/^[\d\s+\-*/%^().,a-zA-Z_]+$/.test(expression)) return { output: "숫자, 연산자, 괄호, 수학 함수 이름만 쓸 수 있습니다.", isError: true };
  const unknown = (expression.match(/[a-zA-Z_]\w*/g) ?? []).filter((w) => !MATH_NAMES.has(w));
  if (unknown.length) return { output: `쓸 수 없는 이름: ${[...new Set(unknown)].join(", ")} (Math 의 함수·상수만 가능)`, isError: true };
  try {
    const value = vm.runInNewContext(`with (Math) { (${expression.replace(/\^/g, "**")}) }`, { Math }, { timeout: 500 });
    if (typeof value !== "number" || !Number.isFinite(value)) return { output: `계산 결과가 유한한 수가 아닙니다: ${String(value)}`, isError: true };
    return { output: String(Number(value.toPrecision(15))) };
  } catch (e) {
    return { output: `식을 계산하지 못했습니다: ${(e as Error).message}`, isError: true };
  }
}

/** 모델이 고른 주소로 요청을 보내므로 내부망 주소는 막는다 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n")
    .trim();
}

async function webFetch(input: unknown, signal: AbortSignal): Promise<ToolOutput> {
  const a = args(input);
  let url: URL;
  try {
    url = new URL(String(a.url ?? ""));
  } catch {
    return { output: "올바른 주소가 아닙니다.", isError: true };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { output: "http/https 주소만 가져올 수 있습니다.", isError: true };
  if (isPrivateHost(url.hostname)) return { output: "내부망·로컬 주소는 가져올 수 없습니다.", isError: true };
  const max = Math.min(30_000, Math.max(500, Number(a.max_chars) || 8000));
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: { "User-Agent": "workflow-runner/1.0", Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
    redirect: "follow",
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) return { output: `HTTP ${res.status} ${res.statusText}`, isError: true };
  if (!/text|json|xml/.test(type)) return { output: `글이 아닌 응답입니다 (content-type: ${type || "없음"})`, isError: true };
  const raw = await res.text();
  const body = /html/.test(type) ? htmlToText(raw) : raw;
  return { output: `[${res.url}]\n${body.slice(0, max)}${body.length > max ? `\n…(전체 ${body.length}자 중 ${max}자)` : ""}` };
}

async function knowledgeSearch(input: unknown): Promise<ToolOutput> {
  const a = args(input);
  const query = String(a.query ?? "").trim();
  if (!query) return { output: "query 가 비어 있습니다.", isError: true };
  const topK = Math.min(10, Math.max(1, Number(a.top_k) || 4));
  let ids: string[];
  if (a.dataset_id) ids = [String(a.dataset_id)];
  else {
    try {
      ids = (await readdir(path.join(process.cwd(), "data", "datasets"))).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch {
      ids = [];
    }
  }
  const chunks: Chunk[] = [];
  for (const id of ids) chunks.push(...((await loadDataset(id))?.chunks ?? []));
  if (!chunks.length) return { output: a.dataset_id ? `지식베이스 '${a.dataset_id}' 를 찾지 못했습니다.` : "등록된 지식베이스가 없습니다.", isError: true };
  const hits = rankChunks(query, chunks)
    .filter((c) => c.score > 0)
    .slice(0, topK);
  if (!hits.length) return { output: "관련된 문단을 찾지 못했습니다." };
  return { output: hits.map((h) => `[${h.datasetName} / ${h.title} · 점수 ${h.score.toFixed(2)}]\n${h.content}`).join("\n\n") };
}

async function conversationSearch(input: unknown, where: BuiltinContext): Promise<ToolOutput> {
  const a = args(input);
  const query = String(a.query ?? "").trim();
  if (!query) return { output: "query 가 비어 있습니다.", isError: true };
  const { hits, searched } = await searchSessions(where.scope ?? "default", query, Math.min(15, Math.max(1, Number(a.top_k) || 5)), where.conversationId);
  if (!searched) return { output: "아직 쌓인 대화 기록이 없습니다." };
  if (!hits.length) return { output: `지난 대화 ${searched}턴에서 관련된 내용을 찾지 못했습니다.` };
  return { output: hits.map((h) => `[${h.date}${h.same_conversation ? " · 이번 대화" : ""} · 관련도 ${h.relevance}]\n${h.text}`).join("\n\n") };
}

export interface BuiltinContext {
  /** 메모리 범위(프로젝트 ID) */
  scope?: string;
  conversationId?: string;
}

export async function runBuiltin(name: string, input: unknown, signal: AbortSignal, where: BuiltinContext = {}): Promise<ToolOutput> {
  switch (name) {
    case "conversation_search":
      return conversationSearch(input, where);
    case "current_time":
      return currentTime(input);
    case "calculator":
      return calculator(input);
    case "web_fetch":
      return webFetch(input, signal);
    case "knowledge_search":
      return knowledgeSearch(input);
    default:
      return { output: `모르는 내장 도구: ${name}`, isError: true };
  }
}

// ───────────────────────── 직접 만든 도구(코드) ─────────────────────────

/** function main(args) { … } 를 코드 노드와 같은 실행기로 돌린다(보안 샌드박스가 아니다) */
export async function runCustom(tool: CustomTool, input: unknown): Promise<ToolOutput> {
  if (!tool.code.trim()) return { output: "이 도구에는 코드가 없습니다.", isError: true };
  const { result, logs } = await runCode("javascript", tool.code, args(input));
  return { output: text(result) + (logs.length ? `\n\n[log]\n${logs.join("\n")}` : "") };
}
