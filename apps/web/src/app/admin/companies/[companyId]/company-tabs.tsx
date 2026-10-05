import { NavTabs } from "@/components/nav-tabs";

const TABS = [
  { segment: "", label: "Visão geral" },
  { segment: "/users", label: "Usuários" },
  { segment: "/team", label: "Equipe" },
  { segment: "/ai", label: "IA" },
  { segment: "/whatsapp", label: "WhatsApp" },
  { segment: "/knowledge-base", label: "Base de conhecimento" },
  { segment: "/usage", label: "Uso" },
];

export function CompanyTabs({ companyId }: { companyId: string }) {
  const base = `/admin/companies/${companyId}`;
  return <NavTabs tabs={TABS.map((tab) => ({ href: `${base}${tab.segment}`, label: tab.label }))} label="Seções da empresa" />;
}
