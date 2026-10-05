import { NavTabs } from "@/components/nav-tabs";

const BASE = "/dashboard/settings";
const TABS = [
  { href: BASE, label: "Empresa" },
  { href: `${BASE}/ai`, label: "IA" },
  { href: `${BASE}/service`, label: "Atendimento" },
  { href: `${BASE}/hours`, label: "Horários" },
  { href: `${BASE}/messages`, label: "Mensagens" },
  { href: `${BASE}/permissions`, label: "Permissões" },
];

export function SettingsTabs() {
  return <NavTabs tabs={TABS} label="Seções das configurações" />;
}
