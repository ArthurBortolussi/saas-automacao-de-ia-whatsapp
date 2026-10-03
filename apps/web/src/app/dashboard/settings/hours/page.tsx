import type { CalendarResponse, CompanySettingsResponse } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import type { Metadata } from "next";
import { CalendarManager } from "@/components/settings/calendar-manager";
import { SchedulesForm } from "@/components/settings/schedules-form";
import { fetchPageData, requireMembership } from "@/lib/api-server";

export const metadata: Metadata = { title: "Configurações · Horários" };

export default async function HoursSettingsPage({ searchParams }: PageProps<"/dashboard/settings/hours">) {
  const { companyId } = await requireMembership();
  const yearParam = (await searchParams)["year"];
  const year = typeof yearParam === "string" && /^\d{4}$/.test(yearParam) ? `?year=${yearParam}` : "";
  const [data, calendar] = await Promise.all([
    fetchPageData<CompanySettingsResponse>(`/companies/${companyId}/settings`),
    fetchPageData<CalendarResponse>(`/companies/${companyId}/settings/calendar${year}`),
  ]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Horários da semana</CardTitle>
          <CardDescription>Três agendas independentes: geral do negócio, da IA e da equipe.</CardDescription>
        </CardHeader>
        <CardContent>
          <SchedulesForm data={data} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feriados e datas especiais</CardTitle>
          <CardDescription>
            Os feriados nacionais aparecem como referência e não fecham a empresa automaticamente. Para mudar o funcionamento de uma data
            (inclusive feriados estaduais e municipais), cadastre uma data especial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarManager companyId={companyId} calendar={calendar} />
        </CardContent>
      </Card>
    </div>
  );
}
