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
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition, type FormEvent } from "react";
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

export function TeamManager({ companyId, team, inboxHrefPrefix }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const isOwner = team.me?.role === "OWNER";
  const roles = MEMBER_ROLES.filter((role) => isOwner || role !== "OWNER");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="gap-1 px-5 py-4">
          <p className="text-xs text-muted-foreground">Aguardando na fila</p>
          <p className="text-xl font-semibold tabular-nums">{team.queue.waiting}</p>
        </Card>
        <Card className="gap-1 px-5 py-4">
          <p className="text-xs text-muted-foreground">Disponíveis agora</p>
          <p className="text-xl font-semibold tabular-nums">
            {team.members.filter((member) => member.active && member.canAttend && member.availability === "AVAILABLE").length}
          </p>
        </Card>
        <Card className="gap-1 px-5 py-4">
          <p className="text-xs text-muted-foreground">Encerramento por inatividade</p>
          <p className="text-xl font-semibold tabular-nums">{formatMinutes(team.settings.inactivityTimeoutMinutes)}</p>
        </Card>
      </div>

      {team.canManage && !creating ? (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> Cadastrar funcionário
          </Button>
        </div>
      ) : null}
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
            {team.members.map((member) => (
              <Fragment key={member.userId}>
                <TableRow>
                  <TableCell className="pl-5">
                    <p className="font-medium">
                      {member.name}
                      {member.isMe ? <span className="font-normal text-muted-foreground"> (você)</span> : null}
                    </p>
                    {member.email ? <p className="text-xs text-muted-foreground">{member.email}</p> : null}
                  </TableCell>
                  <TableCell>{MEMBER_ROLE_LABEL[member.role]}</TableCell>
                  <TableCell>
                    <AvailabilityBadge availability={member.availability} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inboxHrefPrefix && member.activeConversations > 0 && (team.canManage || member.isMe) ? (
                      <Link className="underline-offset-4 hover:underline" href={`${inboxHrefPrefix}${member.userId}`}>
                        {member.activeConversations} / {member.maxConcurrent}
                      </Link>
                    ) : (
                      `${member.activeConversations} / ${member.maxConcurrent}`
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={member.active ? "outline" : "secondary"}>{member.active ? "Ativo" : "Inativo"}</Badge>
                      {!member.canAttend ? <Badge variant="secondary">Não recebe atendimentos</Badge> : null}
                      {member.mustChangePassword ? <Badge variant="secondary">Senha provisória</Badge> : null}
                    </div>
                  </TableCell>
                  {team.canManage ? (
                    <TableCell className="pr-5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
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
                    <TableCell colSpan={6} className="bg-muted/30 px-5">
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
    const confirmText = member.active
      ? `Desativar ${member.name}? A pessoa perde o acesso e as conversas dela voltam para a fila.`
      : `Reativar ${member.name}?`;
    if (window.confirm(confirmText)) run("PATCH", path, { active: !member.active }, onDone);
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
          <Button type="button" size="sm" variant={member.active ? "destructive" : "outline"} onClick={toggleActive} disabled={pending}>
            {member.active ? "Desativar" : "Reativar"}
          </Button>
        ) : null}
      </div>
      {message ? <p className="w-full text-sm text-destructive">{message}</p> : null}
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
