import { Gauge } from "lucide-react";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function Page() {
  return (
    <PlaceholderPanel
      icon={<Gauge />}
      title="Uso"
      description="Consumo de mensagens, custos e limites da empresa. Disponível em uma próxima fase."
    />
  );
}
