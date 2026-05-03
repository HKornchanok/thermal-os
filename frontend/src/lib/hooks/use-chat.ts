import { useMutation } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type ChatRequest, type ChatResponse } from "@/lib/api";

/**
 * One-shot chat mutation — POST /api/chat/ → { reply }.
 *
 * The backend is single-turn: each request carries one user message and
 * gets one assistant reply, with the building snapshot rebuilt every
 * time. The page maintains the visible transcript in local state; we
 * don't replay it server-side.
 *
 * Why mutation instead of query: we don't want auto-refetch, dedup, or
 * cache reuse — each ask is intentional and the inputs (message text)
 * are user-driven.
 */
export function useChat() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;

  return useMutation<ChatResponse, Error, ChatRequest>({
    mutationFn: (body) =>
      apiFetch<ChatResponse>("/api/chat/", {
        method: "POST",
        token,
        body,
      }),
  });
}
