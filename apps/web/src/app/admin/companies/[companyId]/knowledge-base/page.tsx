import { BookOpen } from "lucide-react";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function Page() {
  return (
    <PlaceholderPanel
      icon={<BookOpen />}
      title="Base de conhecimento"
      description="Documentos e informações que o assistente usará para responder os clientes. Disponível em uma próxima fase."
    />
  );
}
