import { Suspense } from "react";
import { Editor } from "@/components/editor";

// params 는 요청 시점에만 알 수 있으므로 Suspense 안에서 풀어 정적 셸을 유지한다
export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<div className="flex h-dvh items-center justify-center bg-paper text-sm text-ink-3">프로젝트 여는 중…</div>}>
      {params.then(({ id }) => (
        <Editor projectId={id} />
      ))}
    </Suspense>
  );
}
