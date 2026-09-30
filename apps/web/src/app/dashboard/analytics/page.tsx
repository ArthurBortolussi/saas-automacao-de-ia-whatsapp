import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <>
      <PageHeader title="Analytics" />
      <PlaceholderPanel icon={<BarChart3 />} title="Analytics" description="Métricas de atendimento e desempenho do assistente. Disponível em uma próxima fase." />
    </>
  );
}
