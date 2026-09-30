import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Inbox" };

export default function Page() {
  return (
    <>
      <PageHeader title="Inbox" />
      <PlaceholderPanel icon={<Inbox />} title="Inbox" description="Conversas com seus clientes pelo WhatsApp aparecerão aqui. Disponível em uma próxima fase." />
    </>
  );
}
