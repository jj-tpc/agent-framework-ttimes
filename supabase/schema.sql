-- Node Trace · Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 한 번 실행한다. 여러 번 실행해도 안전하다.
--
-- 저장하는 것은 "사용자 · 경로 → JSON" 한 가지다.
--   projects/<id>.json        프로젝트(워크플로)
--   memory/<범위>/<이름>.json  메모리 저장소 · 대화 기록
--   settings.json             LLM API 키
--   connectors.json           Google 커넥터의 OAuth 앱 · 토큰
--   mcp.json · mcp-auth.json  외부 MCP 서버 · 그 로그인 토큰

create table if not exists public.app_files (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path       text        not null,
  content    jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

-- 행 수준 보안: 자기 행만 읽고 쓴다. 서버도 로그인한 사용자의 권한으로 부르므로 이 정책이 사용자 간 격리를 지킨다.
alter table public.app_files enable row level security;

drop policy if exists "own files: select" on public.app_files;
drop policy if exists "own files: insert" on public.app_files;
drop policy if exists "own files: update" on public.app_files;
drop policy if exists "own files: delete" on public.app_files;

create policy "own files: select" on public.app_files for select to authenticated using ((select auth.uid()) = user_id);
create policy "own files: insert" on public.app_files for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own files: update" on public.app_files for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own files: delete" on public.app_files for delete to authenticated using ((select auth.uid()) = user_id);

-- 로그인하지 않은 요청은 아무것도 못 한다
revoke all on public.app_files from anon;
grant select, insert, update, delete on public.app_files to authenticated;
