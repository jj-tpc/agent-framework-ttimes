import { randomUUID } from "node:crypto";
import { BLOCK, BLOCK_EXIT, expandBlocks, isBlockRunType } from "../dsl/blocks";
import { MEMORY_RUN, MEMORY_STORE, isMemoryRunType } from "../dsl/memory";
import type { DifyEdge, DifyNode, Workflow } from "../dsl/types";
import { recordTurn } from "../memory/sessions";
import { MEMORY_TOOL, readMemoryCommands, readTools } from "../tools/config";
import { getLlmRuntime } from "../store/settings";
import type { NodeContext, NodeExecutor, NodeResult } from "./context";
import { answerNode, assignerNode, endNode, startNode, variableAggregatorNode } from "./nodes/basic";
import { blockEntryNode, blockExitNode } from "./nodes/block";
import { memoryReadEndNode, memoryReadNode, memoryStoreNode, memoryWriteEndNode, memoryWriteNode } from "./nodes/memory";
import { switchNode } from "./nodes/switch";
import { llmNode, parameterExtractorNode, questionClassifierNode } from "./nodes/llm";
import {
  codeNode,
  httpRequestNode,
  ifElseNode,
  knowledgeRetrievalNode,
  templateTransformNode,
  unsupportedNode,
} from "./nodes/logic";
import type { NodeRun, RunEvent, RunRequest } from "./types";
import { VariablePool } from "./variable-pool";

const EXECUTORS: Record<string, NodeExecutor> = {
  start: startNode,
  answer: answerNode,
  end: endNode,
  llm: llmNode,
  "question-classifier": questionClassifierNode,
  "parameter-extractor": parameterExtractorNode,
  "knowledge-retrieval": knowledgeRetrievalNode,
  "if-else": ifElseNode,
  code: codeNode,
  "template-transform": templateTransformNode,
  "http-request": httpRequestNode,
  "variable-aggregator": variableAggregatorNode,
  "variable-assigner": variableAggregatorNode,
  assigner: assignerNode,
  [BLOCK]: blockEntryNode,
  [BLOCK_EXIT]: blockExitNode,
  switch: switchNode,
  [MEMORY_RUN.read]: memoryReadNode,
  [MEMORY_RUN.readEnd]: memoryReadEndNode,
  [MEMORY_RUN.write]: memoryWriteNode,
  [MEMORY_RUN.writeEnd]: memoryWriteEndNode,
  [MEMORY_STORE]: memoryStoreNode,
  // 메모리 도구 노드는 선언이다(붙은 LLM 이 도구로 쓴다). 흐름에 이어져 있어도 그냥 지나간다
  [MEMORY_TOOL]: async (ctx) => {
    ctx.trace.processData = { note: "선언 노드 — 모듈이 붙은 LLM 노드가 memory 도구로 직접 호출합니다.", commands: readMemoryCommands(ctx.data) };
    return { outputs: {} };
  },
};

/** 출력 핸들로 분기를 고르는 노드 타입 */
const BRANCHING = new Set(["if-else", "question-classifier", "switch"]);
const MAX_STEPS = 500;

type EdgeState = "pending" | "taken" | "skipped";

/**
 * Dify 그래프 엔진과 같은 규칙으로 실행한다.
 * - 노드는 들어오는 엣지가 모두 결정되고(pending 없음) 그중 하나 이상이 taken 일 때 실행된다.
 * - 들어오는 엣지가 모두 skipped 면 노드도 건너뛰고, 그 뒤 엣지도 skipped 로 전파한다.
 * - 동시에 준비된 노드(병렬 분기)는 함께 실행한다.
 * - 블록은 진입(블록 ID)·종료(블록ID::exit) 두 노드로 펼쳐 실행한다(dsl/blocks.ts).
 * - 메모리 모듈은 붙은 LLM 노드 앞(읽기)·뒤(쓰기)에 끼워 실행한다(dsl/memory.ts). 네 지점의 출력은 모두 모듈 ID 아래에 둔다.
 */
export async function runWorkflow(
  workflow: Workflow,
  request: RunRequest,
  emit: (e: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const workflowRunId = randomUUID();
  const startedAt = Date.now();
  const graph = expandBlocks(workflow.nodes, workflow.edges);
  const nodes = graph.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
  const incoming = new Map<string, DifyEdge[]>();
  const outgoing = new Map<string, DifyEdge[]>();
  for (const e of edges) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  const pool = new VariablePool();
  const history = request.history ?? [];
  pool.setNode("sys", {
    query: request.query,
    files: [],
    conversation_id: request.conversationId ?? workflowRunId,
    user_id: "web-user",
    dialogue_count: history.filter((h) => h.role === "user").length + 1,
    workflow_run_id: workflowRunId,
  });
  pool.setNode("env", workflow.environmentVariables);
  pool.setNode("conversation", { ...workflow.conversationVariables, ...(request.conversationVariables ?? {}) });

  const llm = await getLlmRuntime();
  emit({ event: "workflow_started", workflowRunId, workflowName: workflow.name, llmMode: llm.mock ? "mock" : "live", startedAt });

  const edgeState = new Map<string, EdgeState>(edges.map((e) => [e.id!, "pending"]));
  const done = new Set<string>();
  const answers: string[] = [];
  let endOutputs: Record<string, unknown> | null = null;
  let totalTokens = 0;
  let index = 0;
  let failure: string | null = null;

  const runOne = async (node: DifyNode): Promise<{ node: DifyNode; run: NodeRun; result?: NodeResult }> => {
    const run: NodeRun = {
      id: randomUUID(),
      nodeId: node.id,
      nodeType: node.data.type,
      title: node.data.title || node.data.type,
      // 블록 진입·종료는 실행 순서 번호를 쓰지 않는다(화면에서 블록 머리줄로 표시)
      index: isBlockRunType(node.data.type) || isMemoryRunType(node.data.type) ? 0 : ++index,
      status: "running",
      inputs: {},
      processData: {},
      outputs: {},
      startedAt: Date.now(),
    };
    emit({ event: "node_started", run: { ...run } });

    const ctx: NodeContext = {
      node,
      data: node.data as Record<string, unknown>,
      workflow,
      pool,
      request,
      signal,
      llm,
      trace: { inputs: {}, processData: {} },
      progress: (kind, delta) => emit({ event: "node_progress", runId: run.id, nodeId: node.id, kind, delta }),
    };
    const exec = EXECUTORS[node.data.type] ?? unsupportedNode;
    try {
      const result = await exec(ctx);
      Object.assign(run, {
        status: "succeeded",
        inputs: ctx.trace.inputs,
        processData: ctx.trace.processData,
        outputs: result.outputs,
        selectedHandle: result.selectedHandle,
        usage: result.usage,
      });
      return finish(run, result);
    } catch (e) {
      Object.assign(run, {
        status: "failed",
        inputs: ctx.trace.inputs,
        processData: ctx.trace.processData,
        error: (e as Error).message || String(e),
      });
      return finish(run);
    }

    function finish(r: NodeRun, result?: NodeResult) {
      r.finishedAt = Date.now();
      r.elapsedMs = r.finishedAt - r.startedAt;
      return { node, run: r, result };
    }
  };

  const markOutgoing = (nodeId: string, handle: string | null, branching: boolean) => {
    for (const e of outgoing.get(nodeId) ?? []) {
      const h = e.sourceHandle ?? "source";
      let taken: boolean;
      if (handle === null) taken = false; // 노드가 건너뛰어짐
      else if (branching) taken = h === handle;
      else taken = h !== "fail-branch";
      edgeState.set(e.id!, taken ? "taken" : "skipped");
    }
  };

  /** 실행 준비가 된 노드를 찾고, 모든 입력이 skipped 인 노드는 연쇄적으로 건너뛴다. */
  const collectReady = (): DifyNode[] => {
    let changed = true;
    const ready: DifyNode[] = [];
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (done.has(node.id) || ready.includes(node)) continue;
        const ins = incoming.get(node.id) ?? [];
        if (ins.length === 0) continue; // start 이외의 고립 노드는 실행하지 않음
        const states = ins.map((e) => edgeState.get(e.id!));
        if (states.includes("pending")) continue;
        if (states.includes("taken")) ready.push(node);
        else {
          done.add(node.id);
          markOutgoing(node.id, null, false);
          changed = true;
        }
      }
    }
    return ready;
  };

  let ready: DifyNode[] = nodes.filter((n) => n.data.type === "start");
  let steps = 0;
  while (ready.length && !failure) {
    if (signal.aborted) {
      failure = "사용자가 실행을 중단했습니다.";
      break;
    }
    if ((steps += ready.length) > MAX_STEPS) {
      failure = `실행 단계가 ${MAX_STEPS}회를 넘었습니다 (순환 그래프?).`;
      break;
    }
    for (const n of ready) done.add(n.id);
    const results = await Promise.all(ready.map(runOne));

    for (const { node, run, result } of results) {
      if (run.status === "failed") {
        const strategy = node.data.error_strategy as string | undefined;
        if (strategy === "fail-branch" || strategy === "default-value") {
          // 오류 처리 전략: 실패를 기록하되 워크플로는 계속 진행
          const defaults =
            strategy === "default-value"
              ? Object.fromEntries(((node.data.default_value as { key: string; value: unknown }[]) ?? []).map((d) => [d.key, d.value]))
              : {};
          run.outputs = { ...defaults, error_message: run.error, error_type: "NodeError" };
          run.processData = { ...run.processData, error_strategy: strategy };
          pool.setNode(node.id, run.outputs);
          emit({ event: "node_finished", run });
          markOutgoing(node.id, strategy === "fail-branch" ? "fail-branch" : "source", true);
          continue;
        }
        emit({ event: "node_finished", run });
        failure = `[${run.title}] ${run.error}`;
        continue;
      }

      if (isMemoryRunType(node.data.type)) pool.setNode(String(node.data.block_id), run.outputs);
      else if (!isBlockRunType(node.data.type)) pool.setNode(node.id, run.outputs);
      if (run.usage) totalTokens += run.usage.inputTokens + run.usage.outputTokens;
      emit({ event: "node_finished", run });
      if (result?.answer !== undefined) {
        answers.push(result.answer);
        emit({ event: "message", nodeId: node.id, answer: result.answer });
      }
      if (node.data.type === "end") endOutputs = run.outputs;
      markOutgoing(node.id, result?.selectedHandle ?? "source", BRANCHING.has(node.data.type));
    }
    if (!failure) ready = collectReady();
  }

  // 지난 대화 검색 도구를 켠 LLM 노드가 있으면 이번 턴을 세션 기록에 쌓는다
  if (!failure && answers.length && workflow.nodes.some((n) => n.data.type === "llm" && readTools(n.data as Record<string, unknown>).enabled && readTools(n.data as Record<string, unknown>).builtin.includes("conversation_search"))) {
    await recordTurn(String(request.memoryScope ?? "") || "default", request.conversationId ?? workflowRunId, request.query, answers.join("")).catch(() => {});
  }

  emit({
    event: "workflow_finished",
    workflowRunId,
    status: failure ? "failed" : "succeeded",
    ...(failure ? { error: failure } : {}),
    outputs: endOutputs ?? { answer: answers.join("") },
    elapsedMs: Date.now() - startedAt,
    totalTokens,
    variablePool: pool.snapshot(),
    conversationVariables: pool.snapshot().conversation ?? {},
  });
}
