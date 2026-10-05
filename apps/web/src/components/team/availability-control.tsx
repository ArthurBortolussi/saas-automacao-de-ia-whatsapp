"use client";

import { AGENT_AVAILABILITIES, type AgentAvailability } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { apiMutate } from "@/lib/api-client";
import { AVAILABILITY_LABEL } from "@/lib/format";

const HINT: Record<AgentAvailability, string> = {
  AVAILABLE: "Recebendo novos atendimentos",
  BUSY: "Mantém os atuais, sem receber novos",
  AWAY: "Mantém os atuais, sem receber novos",
};

const DOT: Record<AgentAvailability, string> = {
  AVAILABLE: "bg-sidebar-success",
  BUSY: "bg-sidebar-warning",
  AWAY: "bg-sidebar-muted",
};

/** Disponibilidade do próprio funcionário (na sidebar escura). Fica salva no servidor: não depende desta aba aberta. */
export function AvailabilityControl({ companyId, availability }: { companyId: string; availability: AgentAvailability }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(availability);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: AgentAvailability) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await apiMutate("PATCH", `/companies/${companyId}/team/me/availability`, { availability: next });
      if (!result.ok) {
        setValue(previous);
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-sidebar-border bg-sidebar-surface px-3 py-2.5">
      <label htmlFor={id} className="text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">
        Minha disponibilidade
      </label>
      <div className="relative">
        <span aria-hidden className={cn("pointer-events-none absolute top-1/2 left-2.5 size-2 -translate-y-1/2 rounded-full", DOT[value])} />
        <select
          id={id}
          className="h-8 w-full cursor-pointer appearance-none rounded-md border border-sidebar-border bg-sidebar pr-8 pl-7 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          value={value}
          disabled={pending}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            change(event.target.value as AgentAvailability);
          }}
        >
          {AGENT_AVAILABILITIES.map((option) => (
            <option key={option} value={option} className="bg-[Canvas] text-[CanvasText]">
              {AVAILABILITY_LABEL[option]}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-sidebar-muted" />
      </div>
      <p id={`${id}-hint`} className={error ? "text-xs text-sidebar-danger" : "text-xs text-sidebar-muted"}>
        {error ?? HINT[value]}
      </p>
    </div>
  );
}
