import { useMutation } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { apiFetch, type ChatRequest, type ChatResponse } from "@/lib/api";

/** Single-turn POST /api/chat/. Mutation, not query — each ask is intentional. */
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
