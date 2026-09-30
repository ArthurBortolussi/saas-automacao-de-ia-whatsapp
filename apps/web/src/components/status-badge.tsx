import type { CompanyStatus } from "@arthur-ai/shared";
import { cn } from "@arthur-ai/ui/lib/utils";
import { COMPANY_STATUS_LABEL } from "@/lib/format";

const TONE: Record<CompanyStatus, string> = {
  ACTIVE: "bg-success",
  ONBOARDING: "bg-brand",
  PAUSED: "bg-warning",
  INACTIVE: "bg-muted-foreground",
};

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE[status])} />
      {COMPANY_STATUS_LABEL[status]}
    </span>
  );
}
