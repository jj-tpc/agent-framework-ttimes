import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // nunjucks 는 선택적 파일 감시 의존성을 갖고 있어 번들하지 않고 node_modules 에서 그대로 불러온다.
  serverExternalPackages: ["nunjucks"],
  // 런타임에 fs 로 읽는 워크플로·지식베이스 파일을 배포 번들에 포함한다.
  outputFileTracingIncludes: {
    "/api/templates": ["./templates/**/*"],
    "/api/projects": ["./templates/**/*"],
    "/api/run": ["./data/datasets/**/*", "./data/skills/**/*", "./data/plugins/**/*"],
    "/api/datasets": ["./data/datasets/**/*"],
    "/api/tools": ["./data/datasets/**/*", "./data/skills/**/*", "./data/plugins/**/*"],
    "/api/skills": ["./data/skills/**/*", "./data/plugins/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
