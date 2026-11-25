import { graphOf, newNodeId, uniqueTitle, withGraph } from "./graph";
import { MEMORY_PORT, MEMORY_RUN, expandMemory, isMemoryBlock, memoryWarnings } from "./memory";
import type { DifyEdge, DifyNode, DslDoc } from "./types";

/**
 * 블록: 여러 노드를 한 영역으로 묶는 이 앱 전용 확장.
 *
 * - DSL에는 `type: custom-block`, `data.type: block` 노드로 저장한다. 안의 노드는 `parentId` 로 블록을 가리키고
 *   position 은 블록 왼쪽 위 기준 상대 좌표다(Dify 반복 노드의 자식과 같은 방식).
 * - 포트(핸들) 4개
 *     in    'target' : 바깥 노드 → 블록 (왼쪽 벽 바깥)
 *     entry 'entry'  : 엔트리 포인트 → 안쪽 첫 노드 (왼쪽 벽 안쪽)
 *     exit  'exit'   : 안쪽 마지막 노드 → 아웃 포인트 (오른쪽 벽 안쪽)
 *     out   'source' : 블록 → 바깥 노드 (오른쪽 벽 바깥)
 * - 실행할 때는 블록을 '진입'(블록 ID)과 '종료'(`블록ID::exit`) 두 노드로 펼쳐 일반 그래프처럼 돌린다.
 */

export const BLOCK = "block";
export const BLOCK_EXIT = "block-exit";
export const BLOCK_RENDER_TYPE = "custom-block";

export const PORT = { in: "target", entry: "entry", exit: "exit", out: "source" } as const;

type XY = { x: number; y: number };
export type Sizes = Record<string, { width: number; height: number } | undefined>;

export type BlockNode = DifyNode & { data: { type: typeof BLOCK } };
export const isBlock = (n?: DifyNode | null): n is BlockNode => n?.data.type === BLOCK;
export const isBlockRunType = (type: string) => type === BLOCK || type === BLOCK_EXIT;
export const exitIdOf = (blockId: string) => `${blockId}::exit`;

// ───────────────────────── 모양 ─────────────────────────

export const BLOCK_COLORS: { name: string; value: string }[] = [
  { name: "파랑", value: "#dbeafe" },
  { name: "보라", value: "#ede9fe" },
  { name: "분홍", value: "#fce7f3" },
  { name: "빨강", value: "#fee2e2" },
  { name: "주황", value: "#ffedd5" },
  { name: "노랑", value: "#fef3c7" },
  { name: "초록", value: "#dcfce7" },
  { name: "청록", value: "#ccfbf1" },
  { name: "회색", value: "#ebe9e4" },
];
export const DEFAULT_BLOCK_COLOR = BLOCK_COLORS[0].value;

export function blockColor(n: DifyNode): string {
  const c = String(n.data.color ?? "");
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : DEFAULT_BLOCK_COLOR;
}

/** 배경이 어두우면 글자를 밝게 */
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] < 0.36;
}

/** 화면에서 잰 크기를 받지 못했을 때 쓰는 노드 크기 */
export const NODE_SIZE = { width: 236, height: 92 };
export const BLOCK_SIZE = { width: 560, height: 280 };
export const BLOCK_MIN = { width: 320, height: 200 };
/** 블록 안쪽 여백: 왼쪽·오른쪽은 포트 자리, 위는 제목줄 자리 */
const PAD = { left: 84, right: 84, top: 64, bottom: 40 };
/** 블록을 넓힐 때 지키는 최소 여백 */
const FIT = { left: 72, right: 72, top: 56, bottom: 28 };

const sizeOf = (sizes: Sizes | undefined, id: string) => sizes?.[id] ?? NODE_SIZE;
const round = (p: XY): XY => ({ x: Math.round(p.x), y: Math.round(p.y) });
const blockRect = (b: DifyNode) => ({
  x: b.position?.x ?? 0,
  y: b.position?.y ?? 0,
  width: b.width ?? BLOCK_SIZE.width,
  height: b.height ?? BLOCK_SIZE.height,
});

export function membersOf(nodes: DifyNode[], blockId: string): DifyNode[] {
  return nodes.filter((n) => n.parentId === blockId);
}

// ───────────────────────── 실행용 펼치기 ─────────────────────────

/**
 * 블록을 진입·종료 두 노드로 펼친 실행용 그래프.
 * - 블록 ID 노드(진입): in 으로 들어와 entry 로 나간다.
 * - `블록ID::exit` 노드(종료): exit 로 들어와 out 으로 나간다.
 * - 포트가 하나도 안쪽과 연결되지 않은 빈 블록은 진입 → 종료로 바로 통과한다.
 * 블록이 아닌 컨테이너(Dify 반복 등)의 자식은 실행 대상에서 뺀다.
 */
export function expandBlocks(allNodes: DifyNode[], allEdges: DifyEdge[]): { nodes: DifyNode[]; edges: DifyEdge[] } {
  // 메모리 모듈은 LLM 노드 앞뒤에 끼우는 방식으로 먼저 펼친다(dsl/memory.ts)
  const { nodes, edges } = expandMemory(allNodes, allEdges);
  const blocks = new Map(nodes.filter(isBlock).map((b) => [b.id, b]));
  const memory = new Set(nodes.filter((n) => n.data.type === MEMORY_RUN.read).map((n) => n.id));
  const out: DifyNode[] = nodes.filter((n) => !n.parentId || blocks.has(n.parentId) || memory.has(n.parentId));
  for (const b of blocks.values()) {
    out.push({ id: exitIdOf(b.id), type: "custom", position: b.position, data: { type: BLOCK_EXIT, title: b.data.title, block_id: b.id } });
  }
  const ids = new Set(out.map((n) => n.id));
  const wiredEntry = new Set<string>();
  const wiredExit = new Set<string>();
  const result: DifyEdge[] = [];
  for (const e of edges) {
    let { source, target } = e;
    let sourceHandle = e.sourceHandle ?? "source";
    let targetHandle = e.targetHandle ?? "target";
    if (blocks.has(source)) {
      if (sourceHandle === PORT.entry) {
        wiredEntry.add(source);
        sourceHandle = "source";
      } else source = exitIdOf(source);
    }
    if (blocks.has(target)) {
      if (targetHandle === PORT.exit) {
        wiredExit.add(target);
        target = exitIdOf(target);
      }
      targetHandle = "target";
    }
    if (ids.has(source) && ids.has(target)) result.push({ ...e, source, sourceHandle, target, targetHandle });
  }
  for (const id of blocks.keys()) {
    if (!wiredEntry.has(id) && !wiredExit.has(id)) {
      result.push({ id: `${id}::pass`, source: id, sourceHandle: "source", target: exitIdOf(id), targetHandle: "target" });
    }
  }
  return { nodes: out, edges: result };
}

// ───────────────────────── 연결 규칙 ─────────────────────────

/** 이 연결을 만들 수 없는 이유. 만들 수 있으면 null. */
export function connectionError(
  nodes: DifyNode[],
  c: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null },
): string | null {
  if (c.source === c.target) return "같은 노드끼리는 연결할 수 없습니다.";
  const s = nodes.find((n) => n.id === c.source);
  const t = nodes.find((n) => n.id === c.target);
  if (!s || !t) return "노드를 찾을 수 없습니다.";
  if (t.data.type === "start") return "시작 노드로 들어가는 선은 만들 수 없습니다.";
  const sh = c.sourceHandle || "source";
  const th = c.targetHandle || "target";
  // 메모리 모듈: 부착 선은 LLM 노드의 메모리 단자로만, 안쪽 포트는 안의 노드로만
  if (sh === MEMORY_PORT.attach || th === MEMORY_PORT.llm) {
    if (!isMemoryBlock(s) || sh !== MEMORY_PORT.attach) return "LLM 노드의 메모리 단자에는 메모리 모듈만 붙일 수 있습니다.";
    if (t.data.type !== "llm" || th !== MEMORY_PORT.llm) return "메모리 모듈은 LLM 노드 아래쪽 메모리 단자에 붙입니다.";
    if (t.parentId === s.id) return "모듈 안의 LLM 노드에는 붙일 수 없습니다.";
    return null;
  }
  if (isMemoryBlock(s)) {
    if (sh !== MEMORY_PORT.read && sh !== MEMORY_PORT.write) return "메모리 모듈은 흐름 선으로 잇지 않습니다. 위쪽 단자를 LLM 노드에 붙이세요.";
    return t.parentId === s.id ? null : "읽기·쓰기 시작점은 모듈 안의 노드로만 이어집니다.";
  }
  if (isMemoryBlock(t)) {
    if (th !== MEMORY_PORT.readEnd && th !== MEMORY_PORT.writeEnd) return "메모리 모듈은 흐름 선으로 잇지 않습니다. 위쪽 단자를 LLM 노드에 붙이세요.";
    return s.parentId === t.id ? null : "읽기·쓰기 끝점에는 모듈 안의 노드만 연결합니다.";
  }
  if (isBlock(s)) {
    if (sh === PORT.entry && t.parentId !== s.id) return "엔트리 포인트는 블록 안의 노드로만 이어집니다.";
    if (sh !== PORT.entry && t.parentId === s.id) return "블록 안의 노드는 엔트리 포인트에서 이어 주세요.";
  }
  if (isBlock(t)) {
    if (th === PORT.exit && s.parentId !== t.id) return "아웃 포인트에는 블록 안의 노드만 연결합니다.";
    if (th !== PORT.exit && s.parentId === t.id) return "블록 안의 노드는 아웃 포인트로 연결해 주세요.";
  }
  return null;
}

/** 블록 설정이 덜 된 부분 — 캔버스와 설정 패널에 표시 */
export function blockWarnings(nodes: DifyNode[], edges: DifyEdge[], blockId: string): string[] {
  if (isMemoryBlock(nodes.find((n) => n.id === blockId))) return memoryWarnings(nodes, edges, blockId);
  const members = membersOf(nodes, blockId);
  const entry = edges.some((e) => e.source === blockId && e.sourceHandle === PORT.entry);
  const exit = edges.some((e) => e.target === blockId && e.targetHandle === PORT.exit);
  const out = edges.some((e) => e.source === blockId && (e.sourceHandle ?? "source") !== PORT.entry);
  const warnings: string[] = [];
  if (members.length > 0 && !entry) warnings.push("엔트리 미연결");
  if (entry && !exit && out) warnings.push("아웃 미연결");
  return warnings;
}

// ───────────────────────── 엣지 도우미 ─────────────────────────

function edgeIdOf(source: string, sourceHandle: string, target: string, targetHandle: string) {
  return targetHandle === "target" ? `${source}-${sourceHandle}-${target}` : `${source}-${sourceHandle}-${target}-${targetHandle}`;
}

function makeEdge(nodes: DifyNode[], source: string, sourceHandle: string, target: string, targetHandle: string): DifyEdge {
  return {
    id: edgeIdOf(source, sourceHandle, target, targetHandle),
    source,
    sourceHandle,
    target,
    targetHandle,
    type: "custom",
    data: {
      sourceType: nodes.find((n) => n.id === source)?.data.type,
      targetType: nodes.find((n) => n.id === target)?.data.type,
    },
  };
}

/** 같은 (출발, 핸들, 도착, 핸들) 엣지는 하나만 남기고, ID 충돌도 정리한다 */
function dedupe(edges: DifyEdge[]): DifyEdge[] {
  const keys = new Set<string>();
  const ids = new Set<string>();
  const out: DifyEdge[] = [];
  for (const e of edges) {
    const key = [e.source, e.sourceHandle ?? "source", e.target, e.targetHandle ?? "target"].join("\u0000");
    if (keys.has(key)) continue;
    keys.add(key);
    let id = e.id ?? edgeIdOf(e.source, e.sourceHandle ?? "source", e.target, e.targetHandle ?? "target");
    while (ids.has(id)) id += "_";
    ids.add(id);
    out.push(id === e.id ? e : { ...e, id });
  }
  return out;
}

function detach(n: DifyNode, offset: XY): DifyNode {
  const copy: DifyNode = { ...n, position: round({ x: (n.position?.x ?? 0) + offset.x, y: (n.position?.y ?? 0) + offset.y }) };
  delete copy.parentId;
  return copy;
}

// ───────────────────────── 문서 조작 ─────────────────────────

export function addBlock(doc: DslDoc, at: XY, size = BLOCK_SIZE): { doc: DslDoc; id: string } {
  const { nodes, edges } = graphOf(doc);
  const id = newNodeId(nodes);
  const block: DifyNode = {
    id,
    type: BLOCK_RENDER_TYPE,
    position: round(at),
    width: size.width,
    height: size.height,
    data: { type: BLOCK, title: uniqueTitle("블록", nodes), desc: "", color: DEFAULT_BLOCK_COLOR },
  };
  // 블록이 안쪽 노드보다 먼저 그려지도록 앞에 둔다
  return { doc: withGraph(doc, [block, ...nodes], edges), id };
}

/**
 * 고른 노드들을 새 블록으로 묶는다(블록 밖 최상위 노드만, 시작 노드 제외).
 * 들어오는 선이 모두 같은 노드로 향하면 in → entry 로, 나가는 선이 모두 같은 출력에서 나가면 exit → out 으로 다시 잇는다.
 * 그 밖의 경우 선은 그대로 둔다(블록 벽을 가로지르는 선).
 */
export function groupIntoBlock(doc: DslDoc, ids: string[], sizes?: Sizes): { doc: DslDoc; id: string } | null {
  const { nodes, edges } = graphOf(doc);
  const picked = new Set(ids);
  const members = nodes.filter((n) => picked.has(n.id) && !n.parentId && !isBlock(n) && n.data.type !== "start");
  if (members.length === 0) return null;
  const set = new Set(members.map((m) => m.id));

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const m of members) {
    const p = m.position ?? { x: 0, y: 0 };
    const s = sizeOf(sizes, m.id);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  const rect = {
    x: minX - PAD.left,
    y: minY - PAD.top,
    width: Math.max(BLOCK_MIN.width, maxX - minX + PAD.left + PAD.right),
    height: Math.max(BLOCK_MIN.height, maxY - minY + PAD.top + PAD.bottom),
  };
  const id = newNodeId(nodes);
  const block: DifyNode = {
    id,
    type: BLOCK_RENDER_TYPE,
    position: round(rect),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    data: { type: BLOCK, title: uniqueTitle("블록", nodes), desc: "", color: DEFAULT_BLOCK_COLOR },
  };
  const nextNodes = [
    block,
    ...nodes.map((n) =>
      set.has(n.id)
        ? { ...n, parentId: id, position: round({ x: (n.position?.x ?? 0) - block.position!.x, y: (n.position?.y ?? 0) - block.position!.y }) }
        : n,
    ),
  ];

  const incoming = edges.filter((e) => !set.has(e.source) && set.has(e.target));
  const outgoing = edges.filter((e) => set.has(e.source) && !set.has(e.target));
  const rewired = new Map<DifyEdge, DifyEdge>();
  const added: DifyEdge[] = [];
  const inTargets = new Set(incoming.map((e) => e.target));
  if (incoming.length > 0 && inTargets.size === 1) {
    for (const e of incoming) {
      const sh = e.sourceHandle ?? "source";
      rewired.set(e, { ...e, id: edgeIdOf(e.source, sh, id, PORT.in), target: id, targetHandle: PORT.in, data: { ...e.data, targetType: BLOCK } });
    }
    added.push(makeEdge(nextNodes, id, PORT.entry, [...inTargets][0], "target"));
  }
  const outKeys = new Set(outgoing.map((e) => `${e.source}\u0000${e.sourceHandle ?? "source"}`));
  if (outgoing.length > 0 && outKeys.size === 1) {
    for (const e of outgoing) {
      rewired.set(e, { ...e, id: edgeIdOf(id, PORT.out, e.target, e.targetHandle ?? "target"), source: id, sourceHandle: PORT.out, data: { ...e.data, sourceType: BLOCK } });
    }
    added.push(makeEdge(nextNodes, outgoing[0].source, outgoing[0].sourceHandle ?? "source", id, PORT.exit));
  }
  const nextEdges = dedupe([...edges.map((e) => rewired.get(e) ?? e), ...added]);
  return { doc: withGraph(doc, nextNodes, nextEdges), id };
}

/**
 * 블록을 풀어 안의 노드를 밖으로 꺼낸다. 포트를 거치던 선은 직접 잇는다.
 * (in × entry) → 바깥에서 안쪽 첫 노드로, (exit × out) → 안쪽 마지막 노드에서 바깥으로.
 * 안쪽과 연결되지 않은 빈 블록이면 in × out 으로 통과시킨다.
 */
export function ungroupBlock(doc: DslDoc, blockId: string): DslDoc {
  const { nodes, edges } = graphOf(doc);
  const block = nodes.find((n) => n.id === blockId);
  if (!isBlock(block)) return doc;
  const offset = block.position ?? { x: 0, y: 0 };
  const nextNodes = nodes.filter((n) => n.id !== blockId).map((n) => (n.parentId === blockId ? detach(n, offset) : n));

  const ins = edges.filter((e) => e.target === blockId && e.targetHandle !== PORT.exit);
  const entries = edges.filter((e) => e.source === blockId && e.sourceHandle === PORT.entry);
  const exits = edges.filter((e) => e.target === blockId && e.targetHandle === PORT.exit);
  const outs = edges.filter((e) => e.source === blockId && e.sourceHandle !== PORT.entry);
  const join = (from: DifyEdge[], to: DifyEdge[]) =>
    from.flatMap((a) => to.map((b) => makeEdge(nextNodes, a.source, a.sourceHandle ?? "source", b.target, b.targetHandle ?? "target")));
  // 메모리 모듈의 포트는 바깥 흐름과 이어지지 않으므로 다시 이을 선이 없다
  const added = isMemoryBlock(block)
    ? []
    : entries.length === 0 && exits.length === 0
      ? join(ins, outs)
      : [...join(ins, entries), ...join(exits, outs)];
  const kept = edges.filter((e) => e.source !== blockId && e.target !== blockId);
  return withGraph(doc, nextNodes, dedupe([...kept, ...added]));
}

/** 블록과 안의 노드를 모두 지운다 */
export function deleteBlockWithMembers(doc: DslDoc, blockId: string): DslDoc {
  const { nodes, edges } = graphOf(doc);
  const drop = new Set([blockId, ...membersOf(nodes, blockId).map((n) => n.id)]);
  return withGraph(
    doc,
    nodes.filter((n) => !drop.has(n.id)),
    edges.filter((e) => !drop.has(e.source) && !drop.has(e.target)),
  );
}

export interface Placement {
  id: string;
  /** parentId 기준 좌표(없으면 캔버스 절대 좌표) */
  position: XY;
  parentId: string | null;
}

/**
 * 노드 위치와 소속 블록을 바꾼다(끌어서 블록에 넣기/빼기).
 * 소속이 바뀐 노드의 선 중 블록 연결 규칙에 맞지 않게 된 선은 지우고, 넣은 블록은 노드를 감싸도록 넓힌다.
 */
export function placeNodes(doc: DslDoc, moves: Placement[], sizes?: Sizes): DslDoc {
  const { nodes, edges } = graphOf(doc);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const moveOf = new Map(moves.map((m) => [m.id, m]));
  const reparented = new Set<string>();
  const grow = new Set<string>();
  const nextNodes = nodes.map((n) => {
    const mv = moveOf.get(n.id);
    if (!mv) return n;
    const parentId = mv.parentId;
    if (parentId && (!isBlock(byId.get(parentId)) || isBlock(n) || n.data.type === "start")) return n;
    const next: DifyNode = { ...n, position: round(mv.position) };
    if (parentId) next.parentId = parentId;
    else delete next.parentId;
    if ((n.parentId ?? null) !== parentId) reparented.add(n.id);
    if (parentId) grow.add(parentId);
    return next;
  });
  const nextEdges = reparented.size
    ? edges.filter((e) => !(reparented.has(e.source) || reparented.has(e.target)) || connectionError(nextNodes, e) === null)
    : edges;
  let out = withGraph(doc, nextNodes, nextEdges);
  for (const b of grow) out = fitBlock(out, b, sizes);
  return out;
}

/** 블록이 안의 노드를 모두 감싸도록 넓힌다(줄이지는 않음). 왼쪽·위로 넓힐 때는 안의 노드 좌표를 보정한다. */
export function fitBlock(doc: DslDoc, blockId: string, sizes?: Sizes): DslDoc {
  const { nodes, edges } = graphOf(doc);
  const block = nodes.find((n) => n.id === blockId);
  if (!isBlock(block)) return doc;
  const members = membersOf(nodes, blockId);
  if (members.length === 0) return doc;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const m of members) {
    const p = m.position ?? { x: 0, y: 0 };
    const s = sizeOf(sizes, m.id);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  const r = blockRect(block);
  const dx = Math.max(0, FIT.left - minX);
  const dy = Math.max(0, FIT.top - minY);
  const width = Math.max(r.width + dx, maxX + dx + FIT.right);
  const height = Math.max(r.height + dy, maxY + dy + FIT.bottom);
  if (dx === 0 && dy === 0 && width === r.width && height === r.height) return doc;
  const nextNodes = nodes.map((n) => {
    if (n.id === blockId) return { ...n, position: round({ x: r.x - dx, y: r.y - dy }), width: Math.round(width), height: Math.round(height) };
    if (n.parentId === blockId && (dx || dy)) return { ...n, position: round({ x: (n.position?.x ?? 0) + dx, y: (n.position?.y ?? 0) + dy }) };
    return n;
  });
  return withGraph(doc, nextNodes, edges);
}

/** 블록 크기 조절. 왼쪽·위 모서리를 끌었으면 안의 노드가 제자리에 있도록 상대 좌표를 보정한다. */
export function resizeBlock(doc: DslDoc, blockId: string, rect: XY & { width: number; height: number }, sizes?: Sizes): DslDoc {
  const { nodes, edges } = graphOf(doc);
  const block = nodes.find((n) => n.id === blockId);
  if (!isBlock(block)) return doc;
  const r = blockRect(block);
  const dx = Math.round(rect.x) - r.x;
  const dy = Math.round(rect.y) - r.y;
  const nextNodes = nodes.map((n) => {
    if (n.id === blockId) return { ...n, position: round(rect), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (n.parentId === blockId) return { ...n, position: round({ x: (n.position?.x ?? 0) - dx, y: (n.position?.y ?? 0) - dy }) };
    return n;
  });
  return fitBlock(withGraph(doc, nextNodes, edges), blockId, sizes);
}

/** 모든 블록을 풀어 Dify가 읽을 수 있는 순수 그래프로 만든다(내보내기용) */
export function flattenBlocks(doc: DslDoc): DslDoc {
  let out = doc;
  for (const b of graphOf(doc).nodes.filter((n) => isBlock(n) && !isMemoryBlock(n))) out = ungroupBlock(out, b.id);
  return out;
}
