import { formatPhoneNumber, type ConversationDetail } from "@arthur-ai/shared";
import type { ReactNode } from "react";
import { Button } from "@arthur-ai/ui/components/button";
import Link from "next/link";
import { ContactStatusBadge, ConversationModeBadge } from "@/components/contact-badges";
import { CONTACT_SOURCE_LABEL } from "@/lib/format";

export function ContactPanel({ conversation }: { conversation: ConversationDetail }) {
  const { contact } = conversation;
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Telefone", value: formatPhoneNumber(contact.phone) },
    { label: "E-mail", value: contact.email },
    { label: "Status", value: <ContactStatusBadge status={contact.status} /> },
    { label: "Origem", value: CONTACT_SOURCE_LABEL[contact.source] },
    { label: "Atendimento", value: <ConversationModeBadge mode={conversation.mode} /> },
    { label: "Responsável", value: conversation.assignedUser?.name ?? (conversation.mode === "AI" ? "IA" : null) },
  ];

  return (
    <div className="space-y-5 p-5">
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Cliente</p>
        <h3 className="text-base font-semibold">{contact.name}</h3>
      </div>
      <dl className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="break-words">{row.value ?? <span className="text-muted-foreground">—</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Observações</p>
        <p className="text-sm whitespace-pre-wrap">{contact.notes ?? <span className="text-muted-foreground">Sem observações.</span>}</p>
      </div>
      <Button asChild variant="outline" className="w-full">
        <Link href={`/dashboard/contacts/${contact.id}`} prefetch={false}>Abrir cadastro completo</Link>
      </Button>
    </div>
  );
}
