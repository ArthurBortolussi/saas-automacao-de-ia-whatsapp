"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { apiMutate } from "@/lib/api-client";

/** Ao abrir uma conversa com mensagens não lidas, marca como lida e atualiza a lista. */
export function MarkRead({ companyId, conversationId, unreadCount }: { companyId: string; conversationId: string; unreadCount: number }) {
  const router = useRouter();
  useEffect(() => {
    if (unreadCount === 0) return;
    void apiMutate("POST", `/companies/${companyId}/conversations/${conversationId}/read`).then((result) => {
      if (result.ok) router.refresh();
    });
  }, [companyId, conversationId, unreadCount, router]);
  return null;
}
