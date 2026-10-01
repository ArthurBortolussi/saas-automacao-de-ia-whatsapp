"use client";

import type { ConversationDetail } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import { MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiMutate } from "@/lib/api-client";

export function StartConversationButton({ companyId, contactId }: { companyId: string; contactId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await apiMutate<ConversationDetail>("POST", `/companies/${companyId}/conversations`, { contactId });
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            router.push(`/dashboard/inbox?c=${result.data.id}`);
          })
        }
      >
        <MessageSquarePlus /> {pending ? "Abrindo…" : "Nova conversa"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
