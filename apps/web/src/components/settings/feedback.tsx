import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export function Feedback({ value }: { value: { kind: "error" | "success"; text: string } | null }) {
  if (!value) return null;
  return (
    <Alert variant={value.kind === "error" ? "destructive" : "success"} role={value.kind === "error" ? "alert" : "status"}>
      {value.kind === "success" ? <CheckCircle2 /> : <AlertCircle />}
      <AlertDescription>{value.text}</AlertDescription>
    </Alert>
  );
}
