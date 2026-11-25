import type { DifyEdge, DifyNode, ValueSelector } from "./types";

/**
 * 메모리 모듈: LLM 노드에 붙였다 뗄 수 있는 블록(이 앱 전용 확장).
 *
 * - DSL에는 블록(`data.type: block`)에 `data.memory` 설정을 더해 저장한다.
 * - LLM 노드와는 흐름 선이 아니라 '부착 선'(블록 MEMORY_PORT.attach → LLM MEMORY_PORT.llm)으로 잇는다.
 * - 블록 안은 두 구역이다.
 *     읽기: LLM 호출 전에 실행. read 포트에서 시작해 read-end 포트로 모인다.
 *     쓰기: LLM 응답 뒤에 실행. write 포트에서 시작해 write-end 포트로 모인다.
 * - 실행할 때는 블록을 네 노드(읽기 시작·끝, 쓰기 시작·끝)로 펼쳐 LLM 노드 앞뒤에 끼운다(expandMemory).
 *   블록을 지우거나 부착 선을 끊으면 LLM 노드는 메모리 없이 원래대로 돈다.
 */

export const MEMORY_STORE = "memory-store";

export const MEMORY_PORT = {
  /** 블록 → LLM 노드 부착 (블록 위쪽) */
  attach: "memory",
  /** LLM 노드의 메모리 단자 (노드 아래쪽) */
  llm: "memory",
  read: "read",
  readEnd: "read-end",
  write: "write",
  writeEnd: "write-end",
} as const;

/** 실행 기록에 남는 노드 타입 */
export const MEMORY_RUN = {
  read: "memory-read",
  readEnd: "memory-read-end",
  write: "memory-write",
  writeEnd: "memory-write-end",
} as const;
const RUN_TYPES = new Set<string>(Object.values(MEMORY_RUN));
export const isMemoryRunType = (type: string) => RUN_TYPES.has(type);

export const readEndId = (blockId: string) => `${blockId}::read-end`;
export const writeId = (blockId: string) => `${blockId}::write`;
export const writeEndId = (blockId: string) => `${blockId}::write-end`;

export type MemoryKind = "window" | "summary" | "profile" | "facts" | "episodic" | "files" | "graph" | "dreaming" | "agentic";

export interface MemoryKindInfo {
  kind: MemoryKind;
  name: string;
  /** 한 줄 설명 */
  hint: string;
  /** 기억이 유지되는 범위 */
  horizon: string;
  /** 턴마다 추가되는 LLM 호출 */
  cost: string;
  /** 대표 구현 */
  source: string;
  color: string;
}

export const MEMORY_KINDS: MemoryKindInfo[] = [
  { kind: "window", name: "슬라이딩 윈도", hint: "최근 N턴만 그대로 넣는다", horizon: "한 대화", cost: "없음", source: "LangChain 윈도 버퍼 · Dify LLM 메모리", color: "#ebe9e4" },
  { kind: "summary", name: "요약 + 최근 버퍼", hint: "밀려난 턴을 요약에 접어 넣고 최근 턴은 원문으로", horizon: "한 대화(길게)", cost: "버퍼가 넘칠 때 1회", source: "LangChain 요약 버퍼 · 컨텍스트 압축", color: "#fef3c7" },
  { kind: "profile", name: "고정 프로필", hint: "크기 제한이 있는 프로필 문서를 항상 주입", horizon: "대화를 넘어 계속", cost: "쓰기 1회", source: "Letta 코어 메모리 · ChatGPT 저장된 메모리", color: "#dbeafe" },
  { kind: "facts", name: "사실 추출 + 통합", hint: "사실을 뽑아 기존 기억과 비교해 추가·갱신·삭제", horizon: "대화를 넘어 계속", cost: "쓰기 2회", source: "Mem0", color: "#dcfce7" },
  { kind: "episodic", name: "에피소드 스트림", hint: "턴을 시각·중요도와 함께 쌓고 최신성×중요도×관련성으로 꺼낸다", horizon: "대화를 넘어 계속", cost: "쓰기 1회", source: "Generative Agents", color: "#ede9fe" },
  { kind: "files", name: "파일 메모리", hint: "인덱스는 항상 읽고 주제 파일은 골라서 읽는다", horizon: "몇 달~몇 년", cost: "읽기 1회 + 쓰기 1회", source: "Claude Code 메모리 · OpenClaw MEMORY.md", color: "#ffedd5" },
  { kind: "graph", name: "시간축 사실 그래프", hint: "주어·관계·대상으로 저장하고 바뀐 사실은 지우지 않고 무효 표시", horizon: "몇 달~몇 년", cost: "쓰기 2회", source: "Zep · Graphiti", color: "#ccfbf1" },
  { kind: "dreaming", name: "백그라운드 통합", hint: "일일 기록을 쌓아 두고 주기적으로 장기 기억에 승격·병합", horizon: "몇 달~몇 년(항시작동)", cost: "N턴마다 1회", source: "OpenClaw 드리밍 · Letta 슬립타임", color: "#fce7f3" },
  { kind: "agentic", name: "도구 호출형", hint: "모델이 메모리 도구로 직접 읽고 쓴다. 인덱스만 항상 주입", horizon: "몇 달~몇 년", cost: "모델이 도구를 부를 때마다 1회", source: "Claude 메모리 도구 · Claude Code · Letta", color: "#e0e7ff" },
];

export const memoryKindInfo = (kind: unknown): MemoryKindInfo => MEMORY_KINDS.find((k) => k.kind === kind) ?? MEMORY_KINDS[0];

export interface MemoryConfig {
  kind: MemoryKind;
  /** 저장소 이름 — 프로젝트 안에서 같은 이름이면 같은 기억을 쓴다 */
  store: string;
  /** LLM 시스템 프롬프트에 붙일 텍스트(읽기 구역의 결과) */
  context: ValueSelector;
  /** LLM 에 넣을 대화 이력(메시지 배열). 비어 있으면 LLM 노드 자체의 메모리 설정을 그대로 쓴다 */
  history: ValueSelector;
  /** 읽기·쓰기 구역을 나누는 선의 높이(블록 위쪽 기준 px) */
  split: number;
  /** 프롬프트에 기억을 붙일 때 그 위에 두는 머리말. 빈 문자열이면 머리말 없이 붙인다 */
  header: string;
}

export const DEFAULT_MEMORY_HEADER = "[메모리]";

export type MemoryBlock = DifyNode & { data: { type: "block"; memory: Record<string, unknown> } };

export function isMemoryBlock(n?: DifyNode | null): n is MemoryBlock {
  return n?.data.type === "block" && !!n.data.memory && typeof n.data.memory === "object";
}

const selectorOf = (v: unknown): ValueSelector => (Array.isArray(v) ? v.map(String) : []);

export function readMemory(n: DifyNode): MemoryConfig {
  const m = (n.data.memory ?? {}) as Record<string, unknown>;
  return {
    kind: memoryKindInfo(m.kind).kind,
    store: String(m.store ?? "") || "default",
    context: selectorOf(m.context),
    history: selectorOf(m.history),
    split: Number(m.split) || Math.round((n.height ?? 400) / 2),
    header: m.header == null ? DEFAULT_MEMORY_HEADER : String(m.header),
  };
}

/** 메모리 블록이 안쪽 노드에 주는 변수 */
export const MEMORY_READ_VARS: [string, string, string][] = [
  ["query", "string", "이번 사용자 질문"],
  ["history", "array[object]", "지난 대화 [{role, content}]"],
  ["history_text", "string", "지난 대화를 글로 이은 것"],
  ["turn", "number", "이번이 몇 번째 턴인지"],
  ["conversation_id", "string", "대화 ID"],
  ["now", "string", "지금 시각(ISO)"],
  ["today", "string", "오늘 날짜(YYYY-MM-DD)"],
];
export const MEMORY_WRITE_VARS: [string, string, string][] = [["answer", "string", "LLM 이 방금 낸 응답"]];

/** 이 블록이 붙은 LLM 노드 ID */
export function attachedLlm(edges: DifyEdge[], blockId: string): string | null {
  return edges.find((e) => e.source === blockId && e.sourceHandle === MEMORY_PORT.attach)?.target ?? null;
}
/** 이 LLM 노드에 붙은 메모리 블록 ID */
export function memoryOf(edges: DifyEdge[], llmId: string): string | null {
  return edges.find((e) => e.target === llmId && e.targetHandle === MEMORY_PORT.llm)?.source ?? null;
}
export const isAttachEdge = (e: DifyEdge) => e.sourceHandle === MEMORY_PORT.attach || e.targetHandle === MEMORY_PORT.llm;

/** 안쪽 노드가 읽기·쓰기 중 어느 구역에 속하는지(포트에서 선을 따라가 닿는 쪽). 어느 쪽도 아니면 null */
export function zonesOf(nodes: DifyNode[], edges: DifyEdge[], blockId: string): Map<string, "read" | "write"> {
  const members = new Set(nodes.filter((n) => n.parentId === blockId).map((n) => n.id));
  const out = new Map<string, "read" | "write">();
  const walk = (port: string, zone: "read" | "write") => {
    const stack = edges.filter((e) => e.source === blockId && e.sourceHandle === port).map((e) => e.target);
    while (stack.length) {
      const id = stack.pop()!;
      if (!members.has(id) || out.has(id)) continue;
      out.set(id, zone);
      for (const e of edges) if (e.source === id) stack.push(e.target);
    }
  };
  walk(MEMORY_PORT.read, "read");
  walk(MEMORY_PORT.write, "write");
  return out;
}

/**
 * 메모리 블록을 실행용 그래프로 펼친다(일반 블록 펼치기보다 먼저 적용).
 *
 *   (LLM 으로 들어오던 선) → [읽기 시작] → 읽기 구역 노드… → [읽기 끝] → LLM → [쓰기 시작] → 쓰기 구역 노드… → [쓰기 끝]
 *
 * - 읽기 끝·쓰기 끝은 구역 안에서 분기가 건너뛰어져도 항상 실행되도록 시작 노드에서 직통 선을 하나 더 둔다.
 * - LLM 에서 다음 노드로 가는 선은 그대로다. 답변은 쓰기를 기다리지 않고 나간다.
 * - LLM 에 붙지 않은 메모리 블록은 실행 대상에서 뺀다.
 */
export function expandMemory(nodes: DifyNode[], edges: DifyEdge[]): { nodes: DifyNode[]; edges: DifyEdge[] } {
  const blocks = nodes.filter(isMemoryBlock);
  if (blocks.length === 0) return { nodes, edges };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const blockIds = new Set(blocks.map((b) => b.id));
  /** LLM ID → 블록, 블록 ID → LLM ID */
  const byLlm = new Map<string, MemoryBlock>();
  const llmOf = new Map<string, string>();
  for (const b of blocks) {
    const llm = attachedLlm(edges, b.id);
    if (llm && byId.get(llm)?.data.type === "llm" && !byLlm.has(llm)) {
      byLlm.set(llm, b);
      llmOf.set(b.id, llm);
    }
  }
  const dropped = new Set(blocks.filter((b) => !llmOf.has(b.id)).map((b) => b.id));

  const outNodes: DifyNode[] = [];
  for (const n of nodes) {
    if (dropped.has(n.id) || (n.parentId && dropped.has(n.parentId))) continue;
    if (isMemoryBlock(n)) {
      const llmId = llmOf.get(n.id)!;
      const base = { type: "custom", position: n.position };
      const data = { title: n.data.title, memory: n.data.memory, block_id: n.id, llm_id: llmId };
      outNodes.push(
        { ...base, id: n.id, data: { ...data, type: MEMORY_RUN.read } },
        { ...base, id: readEndId(n.id), data: { ...data, type: MEMORY_RUN.readEnd } },
        { ...base, id: writeId(n.id), data: { ...data, type: MEMORY_RUN.write } },
        { ...base, id: writeEndId(n.id), data: { ...data, type: MEMORY_RUN.writeEnd } },
      );
    } else if (byLlm.has(n.id)) {
      outNodes.push({ ...n, data: { ...n.data, __memory: byLlm.get(n.id)!.id } });
    } else outNodes.push(n);
  }

  const outEdges: DifyEdge[] = [];
  for (const e of edges) {
    if (isAttachEdge(e)) continue;
    if (dropped.has(e.source) || dropped.has(e.target)) continue;
    let { source, target } = e;
    let sourceHandle = e.sourceHandle ?? "source";
    let targetHandle = e.targetHandle ?? "target";
    if (blockIds.has(source)) {
      if (sourceHandle === MEMORY_PORT.write) source = writeId(source);
      else if (sourceHandle !== MEMORY_PORT.read) continue;
      sourceHandle = "source";
    }
    if (blockIds.has(target)) {
      if (targetHandle === MEMORY_PORT.readEnd) target = readEndId(target);
      else if (targetHandle === MEMORY_PORT.writeEnd) target = writeEndId(target);
      else continue;
      targetHandle = "target";
    } else if (byLlm.has(target)) {
      // LLM 으로 들어오던 선은 읽기 시작으로 돌린다
      target = byLlm.get(target)!.id;
      targetHandle = "target";
    }
    outEdges.push({ ...e, source, sourceHandle, target, targetHandle });
  }
  for (const [blockId, llmId] of llmOf) {
    const link = (id: string, source: string, target: string): DifyEdge => ({ id: `${blockId}::${id}`, source, sourceHandle: "source", target, targetHandle: "target" });
    outEdges.push(
      link("read-pass", blockId, readEndId(blockId)),
      link("to-llm", readEndId(blockId), llmId),
      link("from-llm", llmId, writeId(blockId)),
      link("write-pass", writeId(blockId), writeEndId(blockId)),
    );
  }
  return { nodes: outNodes, edges: outEdges };
}

/** 메모리 블록 설정이 덜 된 부분 */
export function memoryWarnings(nodes: DifyNode[], edges: DifyEdge[], blockId: string): string[] {
  const block = nodes.find((n) => n.id === blockId);
  if (!isMemoryBlock(block)) return [];
  const warnings: string[] = [];
  const llm = attachedLlm(edges, blockId);
  if (!llm) warnings.push("LLM 미연결");
  const cfg = readMemory(block);
  const members = new Set(nodes.filter((n) => n.parentId === blockId).map((n) => n.id));
  const bad = (sel: ValueSelector) => sel.length > 0 && !members.has(sel[0]) && sel[0] !== blockId;
  if (bad(cfg.context) || bad(cfg.history)) warnings.push("읽기 결과 변수 없음");
  if (cfg.context.length === 0 && cfg.history.length === 0) warnings.push("읽기 결과 미지정");
  return warnings;
}
