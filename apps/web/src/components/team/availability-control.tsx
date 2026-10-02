"use client";

import { AGENT_AVAILABILITIES, type AgentAvailability } from "@arthur-ai/shared";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiMutate } from "@/lib/api-client";
import { AVAILABILITY_LABEL } from "@/lib/format";

const HINT: Record<AgentAvailability, string> = {
  AVAILABLE: "Recebendo novos atendimentos",
  BUSY: "Mantém os atuais, sem receber novos",
  AWAY: "Mantém os atuais, sem receber novos",
};

/** Disponibilidade do próprio funcionário. Fica salva no servidor: não depende desta aba aberta. */
export function AvailabilityControl({ companyId, availability }: { companyId: string; availability: AgentAvailability }) {
  const router = useRouter();
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
    <div className="space-y-1 rounded-md border border-sidebar-border bg-background px-2.5 py-2">
      <label htmlFor="availability" className="text-xs font-medium text-muted-foreground">
        Minha disponibilidade
      </label>
      <NativeSelect
        id="availability"
        size="sm"
        className="w-full"
        value={value}
        disabled={pending}
        onChange={(event) => {
          change(event.target.value as AgentAvailability);
        }}
      >
        {AGENT_AVAILABILITIES.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {AVAILABILITY_LABEL[option]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <p className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{error ?? HINT[value]}</p>
    </div>
  );
}
