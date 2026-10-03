import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Configurações" description="Atendimento, horários, mensagens automáticas e permissões da sua empresa." />
      <SettingsTabs />
      {children}
    </>
  );
}
