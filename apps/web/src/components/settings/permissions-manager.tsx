"use client";

import {
  SETTINGS_PERMISSION_HINT,
  SETTINGS_PERMISSION_LABEL,
  SETTINGS_PERMISSIONS,
  type CompanySettingsResponse,
  type MemberPermissionItem,
  type SettingsPermission,
} from "@arthur-ai/shared";
import { Badge } from "@arthur-ai/ui/components/badge";
import { useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { MEMBER_ROLE_LABEL } from "@/lib/format";
import { Feedback } from "./feedback";
import { useSettingsMutation } from "./use-settings-mutation";

/** Aba Permissões. O proprietário concede/revoga grupos por pessoa; os demais veem só o que receberam. */
export function PermissionsManager({ data }: { data: CompanySettingsResponse }) {
  if (!data.permissions.managePermissions || !data.members) {
    const granted = data.permissions.granted;
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">Somente o proprietário da empresa concede ou revoga permissões.</p>
        <p className="font-medium">O que você pode alterar:</p>
        {granted.length === 0 ? (
          <p className="text-muted-foreground">Nenhum grupo de configurações (você pode consultar as abas).</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {granted.map((permission) => (
              <li key={permission}>{SETTINGS_PERMISSION_LABEL[permission]}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {SETTINGS_PERMISSIONS.map((permission) => (
          <li key={permission}>
            <span className="font-medium text-foreground">{SETTINGS_PERMISSION_LABEL[permission]}:</span> {SETTINGS_PERMISSION_HINT[permission]}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Nome comercial, logotipo, fuso e permissões são sempre exclusivos do proprietário. Controles técnicos e financeiros da plataforma não
        podem ser concedidos.
      </p>
      <div className="divide-y rounded-md border">
        {data.members.map((member) => (
          <MemberRow key={member.userId} companyId={data.company.id} member={member} />
        ))}
      </div>
    </div>
  );
}

function MemberRow({ companyId, member }: { companyId: string; member: MemberPermissionItem }) {
  const { feedback, pending, submit } = useSettingsMutation();
  const [selected, setSelected] = useState<SettingsPermission[]>(member.permissions);
  const locked = member.role === "OWNER" || member.isMe;
  const changed = [...selected].sort().join() !== [...member.permissions].sort().join();
  const granted = selected.filter((permission) => !member.permissions.includes(permission));
  const revoked = member.permissions.filter((permission) => !selected.includes(permission));

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{member.name}</span>
        <Badge variant="secondary">{MEMBER_ROLE_LABEL[member.role]}</Badge>
        {!member.active ? <Badge variant="outline">Inativo</Badge> : null}
        {member.isMe ? <span className="text-xs text-muted-foreground">(você)</span> : null}
      </div>
      <div className="flex flex-wrap gap-4">
        {SETTINGS_PERMISSIONS.map((permission) => (
          <label key={permission} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={selected.includes(permission)}
              disabled={locked || pending}
              onChange={(event) => {
                setSelected((current) => (event.target.checked ? [...current, permission] : current.filter((item) => item !== permission)));
              }}
            />
            {SETTINGS_PERMISSION_LABEL[permission]}
          </label>
        ))}
      </div>
      {member.role === "OWNER" ? <p className="text-xs text-muted-foreground">Proprietários têm todas as permissões.</p> : null}
      <Feedback value={feedback} />
      {!locked && changed ? (
        <ConfirmAction
          size="sm"
          label="Salvar permissões"
          title={`Alterar as permissões de ${member.name}?`}
          effect={
            <ul className="list-disc space-y-1 pl-4">
              {granted.length ? <li>Concede: {granted.map((permission) => SETTINGS_PERMISSION_LABEL[permission]).join(", ")}.</li> : null}
              {revoked.length ? <li>Revoga: {revoked.map((permission) => SETTINGS_PERMISSION_LABEL[permission]).join(", ")}.</li> : null}
              <li>Vale na próxima ação da pessoa, mesmo que ela esteja com o painel aberto.</li>
            </ul>
          }
          confirmLabel="Confirmar"
          pending={pending}
          onConfirm={() => {
            submit("PUT", `/companies/${companyId}/settings/permissions/${member.userId}`, { permissions: selected, confirm: true }, "Permissões atualizadas.");
          }}
        />
      ) : null}
    </div>
  );
}
