import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { CheckCircle2 } from "lucide-react";

export function Feedback({ value }: { value: { kind: "error" | "success"; text: string } | null }) {
  if (!value) return null;
  return (
    <Alert variant={value.kind === "error" ? "destructive" : "default"}>
      {value.kind === "success" ? <CheckCircle2 className="text-success" /> : null}
      <AlertDescription>{value.text}</AlertDescription>
    </Alert>
  );
}
