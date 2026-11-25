/**
 * 설정을 바꾸는 API 를 다른 사이트가 사용자의 브라우저를 통해 부르지 못하게 막는다.
 * 같은 출처에서 온 JSON 요청만 받는다(다른 출처의 폼·no-cors 요청은 JSON content-type 을 못 붙인다).
 */
export function rejectCrossSite(req: Request): Response | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: "다른 출처의 요청은 받지 않습니다." }, { status: 403 });
  if (req.method !== "DELETE" && !(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "JSON 요청만 받습니다." }, { status: 415 });
  }
  return null;
}
