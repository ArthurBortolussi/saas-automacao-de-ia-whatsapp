"use client";

import {
  createTeamMemberSchema,
  MEMBER_ROLES,
  type MemberRole,
  type TeamMemberItem,
  type TeamResponse,
} from "@arthur-ai/shared";
import { Alert, AlertDescription } from "@arthur-ai/ui/components/alert";
import { Badge } from "@arthur-ai/ui/components/badge";
import { Button } from "@arthur-ai/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Input } from "@arthur-ai/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@arthur-ai/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@arthur-ai/ui/components/table";
import { cn } from "@arthur-ai/ui/lib/utils";
import { Clock, Plus, Timer, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition, type FormEvent } from "react";
import { StatCard } from "@/components/analytics/stat-card";
import { Avatar } from "@/components/avatar";
import { ConfirmAction } from "@/components/confirm-action";
import { AvailabilityBadge } from "@/components/contact-badges";
import { Field } from "@/components/field";
import { apiMutate } from "@/lib/api-client";
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from "@/lib/form-errors";
import { MEMBER_ROLE_LABEL } from "@/lib/format";

interface Props {
  companyId: string;
  team: TeamResponse;
  /** Prefixo do link para os atendimentos de um funcionário (null = sem link, ex.: supervisão do Superadmin). */
  inboxHrefPrefix: string | null;
}

type TeamView = "all" | "available" | "inactive";

const VIEW_FILTERS: { value: TeamView; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "available", label: "Disponíveis" },
  { value: "inactive", label: "Inativos" },
];

export function TeamManager({ companyId, team, inboxHrefPrefix }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const isOwner = team.me?.role === "OWNER";
  const roles = MEMBER_ROLES.filter((role) => isOwner || role !== "OWNER");
  const [view, setView] = useState<TeamView>("all");
  const activeCount = team.members.filter((member) => member.active).length;
  const availableNow = team.members.filter((member) => member.active && member.canAttend && member.availability === "AVAILABLE").length;
  const visible = team.members.filter((member) =>
    view === "available" ? member.active && member.availability === "AVAILABLE" : view === "inactive" ? !member.active : true,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Aguardando na fila"
          value={String(team.queue.waiting)}
          hint={team.queue.waiting > 0 ? "Clientes esperando alguém da equipe" : "Ninguém esperando agora"}
          icon={<Clock />}
          attention={team.queue.waiting > 0}
        />
        <StatCard label="Disponíveis agora" value={String(availableNow)} hint={`De ${activeCount} ${activeCount === 1 ? "pessoa ativa" : "pessoas ativas"}`} icon={<UserCheck />} />
        <StatCard
          label="Encerramento por inatividade"
          value={formatMinutes(team.settings.inactivityTimeoutMinutes)}
          hint="Atendimentos humanos sem resposta do cliente"
          icon={<Timer />}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-lg border bg-card p-1 shadow-card" role="group" aria-label="Filtrar equipe">
          {VIEW_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={view === item.value}
              onClick={() => {
                setView(item.value);
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                view === item.value ? "bg-brand-soft font-medium text-brand-strong" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {team.canManage && !creating ? (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> Cadastrar funcionário
          </Button>
        ) : null}
      </div>
      {creating ? (
        <NewMemberForm
          companyId={companyId}
          roles={roles}
          onDone={() => {
            setCreating(false);
          }}
        />
      ) : null}

      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Funcionário</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Disponibilidade</TableHead>
              <TableHead className="text-right">Atendimentos</TableHead>
              <TableHead>Situação</TableHead>
              {team.canManage ? <TableHead className="pr-5 text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Ninguém neste filtro.
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((member) => (
              <Fragment key={member.userId}>
                <TableRow>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <Avatar name={member.name} size="sm" className={member.active ? "" : "bg-muted text-muted-foreground"} />
                      <div className="min-w-0">
                        <p className="font-medium">
                          {member.name}
                          {member.isMe ? <span className="font-normal text-muted-foreground"> (você)</span> : null}
                        </p>
                        {member.email ? <p className="text-xs text-muted-foreground">{member.email}</p> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{MEMBER_ROLE_LABEL[member.role]}</TableCell>
                  <TableCell>
                    <AvailabilityBadge availability={member.availability} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="ml-auto flex w-24 flex-col items-end gap-1">
                      <span className="text-sm tabular-nums">
                        {inboxHrefPrefix && member.activeConversations > 0 && (team.canManage || member.isMe) ? (
                          <Link className="font-medium text-brand-strong underline-offset-4 hover:underline" href={`${inboxHrefPrefix}${member.userId}`}>
                            {member.activeConversations} / {member.maxConcurrent}
                          </Link>
                        ) : (
                          `${member.activeConversations} / ${member.maxConcurrent}`
                        )}
                      </span>
                      {/* Ocupação do limite individual (não é comparação entre pessoas). */}
                      <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn("block h-full rounded-full", member.activeConversations >= member.maxConcurrent ? "bg-warning" : "bg-brand")}
                          style={{ width: `${Math.min(100, (member.activeConversations / Math.max(1, member.maxConcurrent)) * 100)}%` }}
                        />
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={member.active ? "success" : "neutral"}>{member.active ? "Ativo" : "Inativo"}</Badge>
                      {!member.canAttend ? <Badge variant="neutral">Não recebe atendimentos</Badge> : null}
                      {member.mustChangePassword ? <Badge variant="warning">Senha provisória</Badge> : null}
                    </div>
                  </TableCell>
                  {team.canManage ? (
                    <TableCell className="pr-5 text-right">
                      <Button
                        size="sm"
                        variant={editing === member.userId ? "secondary" : "outline"}
                        aria-expanded={editing === member.userId}
                        onClick={() => {
                          setEditing(editing === member.userId ? null : member.userId);
                        }}
                      >
                        {editing === member.userId ? "Fechar" : "Editar"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
                {editing === member.userId ? (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-subtle px-5 whitespace-normal">
                      <EditMember
                        companyId={companyId}
                        member={member}
                        roles={roles}
                        canChangeRole={!member.isMe && (isOwner || member.role !== "OWNER")}
                        onDone={() => {
                          setEditing(null);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </Card>

      {team.me ? <SettingsLink canEdit={team.canEditSettings} /> : null}
    </div>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

function useMutation() {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(method: "POST" | "PATCH", path: string, body: unknown, onSuccess: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await apiMutate(method, path, body);
      if (!result.ok) {
        setErrors(apiFieldErrors(result.error));
        setMessage(result.error.message);
        return;
      }
      setErrors({});
      onSuccess();
      router.refresh();
    });
  }
  return { errors, setErrors, message, pending, run };
}

function NewMemberForm({ companyId, roles, onDone }: { companyId: string; roles: MemberRole[]; onDone: () => void }) {
  const { errors, setErrors, message, pending, run } = useMutation();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      role: form.get("role"),
      maxConcurrent: Number(form.get("maxConcurrent")),
      canAttend: form.get("canAttend") === "on",
    };
    const parsed = createTeamMemberSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    run("POST", `/companies/${companyId}/team/members`, parsed.data, onDone);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cadastrar funcionário</CardTitle>
        <CardDescription>
          Defina uma senha provisória e passe-a à pessoa por um canal seguro. No primeiro acesso ela será obrigada a trocá-la.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4" autoComplete="off">
          {message ? (
            <Alert variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Nome" error={errors["name"]}>
              <Input id="name" name="name" maxLength={120} />
            </Field>
            <Field id="email" label="E-mail" error={errors["email"]}>
              <Input id="email" name="email" type="email" maxLength={254} />
            </Field>
            <Field id="password" label="Senha provisória" error={errors["password"]} hint="Mínimo de 10 caracteres.">
              <Input id="password" name="password" type="password" autoComplete="new-password" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="role" label="Perfil" error={errors["role"]}>
                <NativeSelect id="role" name="role" defaultValue="AGENT" className="w-full">
                  {roles.map((role) => (
                    <NativeSelectOption key={role} value={role}>
                      {MEMBER_ROLE_LABEL[role]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="maxConcurrent" label="Limite simultâneo" error={errors["maxConcurrent"]}>
                <Input id="maxConcurrent" name="maxConcurrent" type="number" min={1} max={100} defaultValue={5} />
              </Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="canAttend" defaultChecked className="size-4 accent-primary" />
            Recebe atendimentos (distribuição automática e transferências)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Cadastrando…" : "Cadastrar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditMember({
  companyId,
  member,
  roles,
  canChangeRole,
  onDone,
}: {
  companyId: string;
  member: TeamMemberItem;
  roles: MemberRole[];
  canChangeRole: boolean;
  onDone: () => void;
}) {
  const { errors, message, pending, run } = useMutation();
  const path = `/companies/${companyId}/team/members/${member.userId}`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      maxConcurrent: Number(form.get("maxConcurrent")),
      canAttend: form.get("canAttend") === "on",
    };
    if (canChangeRole) body["role"] = form.get("role");
    run("PATCH", path, body, onDone);
  }

  function toggleActive() {
    run("PATCH", path, { active: !member.active }, onDone);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-4 py-2">
      {canChangeRole ? (
        <Field id={`role-${member.userId}`} label="Perfil" error={errors["role"]}>
          <NativeSelect id={`role-${member.userId}`} name="role" defaultValue={member.role}>
            {roles.map((role) => (
              <NativeSelectOption key={role} value={role}>
                {MEMBER_ROLE_LABEL[role]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field id={`limit-${member.userId}`} label="Limite simultâneo" error={errors["maxConcurrent"]}>
        <Input id={`limit-${member.userId}`} name="maxConcurrent" type="number" min={1} max={100} defaultValue={member.maxConcurrent} className="w-28" />
      </Field>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="canAttend" defaultChecked={member.canAttend} className="size-4 accent-primary" />
        Recebe atendimentos
      </label>
      <div className="flex gap-2 pb-0.5">
        <Button type="submit" size="sm" disabled={pending}>
          Salvar
        </Button>
        {!member.isMe && canChangeRole ? (
          <ConfirmAction
            size="sm"
            triggerVariant={member.active ? "destructive-outline" : "outline"}
            label={member.active ? "Desativar" : "Reativar"}
            title={member.active ? `Desativar ${member.name}?` : `Reativar ${member.name}?`}
            effect={
              member.active
                ? "A pessoa perde o acesso imediatamente e as conversas dela voltam para a fila."
                : "A pessoa volta a acessar o painel com a senha atual."
            }
            confirmLabel={member.active ? "Desativar" : "Reativar"}
            destructive={member.active}
            pending={pending}
            onConfirm={toggleActive}
          />
        ) : null}
      </div>
      {message ? <p className="w-full text-sm font-medium text-destructive">{message}</p> : null}
    </form>
  );
}

/** Fase 7: o prazo de inatividade é editado em Configurações → Atendimento (um único controle para o dado). */
function SettingsLink({ canEdit }: { canEdit: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Encerramento automático e fila</CardTitle>
        <CardDescription>
          O prazo de inatividade da equipe e o tempo máximo de espera na fila ficam em{" "}
          <Link href="/dashboard/settings/service" prefetch={false} className="font-medium text-foreground underline underline-offset-4">
            Configurações → Atendimento
          </Link>
          {canEdit ? "." : " (somente o proprietário ou quem tem a permissão \"Atendimento e fila\" altera)."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
