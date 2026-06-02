"use client";

import { useRouter } from "next/navigation";
import { useLiveRefresh } from "@/lib/use-live-refresh";

/**
 * Zero-render client: subscribes to SSE and calls router.refresh() after every
 * mutation, so the SERVER-rendered detail pages (solution/project) refresh
 * live - just like Overview and Explorer. router.refresh() reloads the server
 * data while preserving client component state (e.g. an open TaskPanel).
 */
export function LiveRefresher() {
  const router = useRouter();
  useLiveRefresh(() => router.refresh());
  return null;
}
