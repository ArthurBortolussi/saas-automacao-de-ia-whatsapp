"use client";

import type { ConversationAction, ConversationMode } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { Bot, Pause, Play, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { apiMutate } from "@/lib/api-client";

const ACTIONS: Record<ConversationAction, { label: string; done: string; icon: ReactNode }> = {
  ASSUME: { label: "Assumir atendimento", done: "Você assumiu o atendimento.", icon: <UserRound /> },
  RETURN_TO_AI: { label: "Devolver para IA", done: "Conversa devolvida para a IA.", icon: <Bot /> },
  PAUSE: { label: "Pausar", done: "Atendimento pausado.", icon: <Pause /> },
  RESUME: { label: "Reativar", done: "Atendimento reativado.", icon: <Play /> },
};

const AVAILABLE: Record<ConversationMode, ConversationAction[]> = {
  AI: ["ASSUME", "PAUSE"],
  HUMAN: ["RETURN_TO_AI", "PAUSE"],
  PAUSED: ["RESUME", "ASSUME"],
};

interface ModeControlsProps {
  companyId: string;
  conversationId: string;
  mode: ConversationMode;
}

export function ModeControls({ companyId, conversationId, mode }: ModeControlsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // A confirmação some sozinha; erros ficam até a próxima ação.
  useEffect(() => {
    if (feedback?.kind !== "success") return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  function run(action: ConversationAction) {
    setFeedback(null);
    startTransition(async () => {
      const result = await apiMutate("POST", `/companies/${companyId}/conversations/${conversationId}/mode`, { action });
      if (!result.ok) {
        setFeedback({ kind: "error", text: result.error.message });
        router.refresh();
        return;
      }
      setFeedback({ kind: "success", text: ACTIONS[action].done });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex flex-wrap gap-2">
        {AVAILABLE[mode].map((action, index) => (
          <Button key={action} size="sm" variant={index === 0 ? "default" : "outline"} disabled={pending} onClick={() => run(action)}>
            {ACTIONS[action].icon}
            {ACTIONS[action].label}
          </Button>
        ))}
      </div>
      {feedback ? (
        <p role="status" className={feedback.kind === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
