import { MessageCircle } from "lucide-react";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export default function Page() {
  return (
    <PlaceholderPanel
      icon={<MessageCircle />}
      title="WhatsApp"
      description="Conexão do número de WhatsApp Business e status da integração. Disponível em uma próxima fase."
    />
  );
}
