import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = { title: "Equipe" };

export default function Page() {
  return (
    <>
      <PageHeader title="Equipe" />
      <PlaceholderPanel icon={<UsersRound />} title="Equipe" description="Gestão dos usuários da sua empresa. Disponível em uma próxima fase." />
    </>
  );
}
