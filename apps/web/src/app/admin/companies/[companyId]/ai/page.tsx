import { Bot } from "lucide-react";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function Page() {
  return (
    <PlaceholderPanel
      icon={<Bot />}
      title="Inteligência artificial"
      description="Configuração do assistente de IA desta empresa: modelo, instruções e comportamento. Disponível em uma próxima fase."
    />
  );
}
