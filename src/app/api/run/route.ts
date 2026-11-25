import { DslError, parseDsl } from "@/lib/dsl/parse";
import { runWorkflow } from "@/lib/engine/runner";
import type { RunEvent, RunRequest } from "@/lib/engine/types";
import { bind, signedIn } from "@/lib/store/backend";

export const maxDuration = 300;

/** 워크플로를 실행하고 Dify 스타일 이벤트(node_started / node_finished / message …)를 SSE로 스트리밍한다. */
export async function POST(req: Request) {
  const denied = bind(await signedIn());
  if (denied) return denied;
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return Response.json({ error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  if (!body?.dsl || (typeof body.dsl !== "string" && typeof body.dsl !== "object") || typeof body.query !== "string") {
    return Response.json({ error: "dsl 과 query 가 필요합니다." }, { status: 400 });
  }

  let workflow;
  try {
    workflow = parseDsl(body.dsl);
  } catch (e) {
    const status = e instanceof DslError ? 422 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // 클라이언트 연결이 끊긴 뒤의 이벤트는 버린다
        }
      };
      try {
        await runWorkflow(workflow, body, emit, req.signal);
      } catch (e) {
        emit({
          event: "workflow_finished",
          workflowRunId: "",
          status: "failed",
          error: (e as Error).message,
          outputs: {},
          elapsedMs: 0,
          totalTokens: 0,
          variablePool: {},
          conversationVariables: {},
        });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
