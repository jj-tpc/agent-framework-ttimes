"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

/** 브라우저용 Supabase 클라이언트(로그인 · 로그아웃). 설정이 없으면 null */
export function browserClient() {
  const cfg = supabaseConfig();
  return cfg ? createBrowserClient(cfg.url, cfg.key) : null;
}
