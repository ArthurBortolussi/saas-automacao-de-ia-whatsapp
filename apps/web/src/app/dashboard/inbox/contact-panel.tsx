import { formatPhoneNumber, type ConversationDetail } from "@arthur-ai/shared";
import { Button } from "@arthur-ai/ui/components/button";
import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { ContactStatusBadge, ConversationModeBadge, ConversationStatusBadge } from "@/components/contact-badges";
import { CONTACT_SOURCE_LABEL, CONVERSATION_STATUS_LABEL } from "@/lib/format";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t px-5 py-4">
      <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="space-y-2.5 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 text-right break-words">{row.value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ContactPanel({ conversation }: { conversation: ConversationDetail }) {
  const { contact } = conversation;
  return (
    <div className="pb-5">
      <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-5 text-center">
        <Avatar name={contact.name} size="lg" />
        <div>
          <h3 className="text-[15px] font-semibold">{contact.name}</h3>
          <p className="text-xs text-muted-foreground tabular-nums">{formatPhoneNumber(contact.phone)}</p>
        </div>
        <ContactStatusBadge status={contact.status} />
      </div>
      <Section title="Contato">
        <Rows
          rows={[
            { label: "E-mail", value: contact.email },
            { label: "Origem", value: CONTACT_SOURCE_LABEL[contact.source] },
          ]}
        />
      </Section>
      <Section title="Atendimento">
        <Rows
          rows={[
            { label: "Quem responde", value: <ConversationModeBadge mode={conversation.mode} /> },
            {
              label: "Situação",
              value:
                conversation.status === "QUEUED" || conversation.status === "CLOSED" ? (
                  <ConversationStatusBadge status={conversation.status} />
                ) : (
                  CONVERSATION_STATUS_LABEL[conversation.status]
                ),
            },
            { label: "Responsável", value: conversation.assignedUser?.name ?? (conversation.mode === "AI" ? "IA" : null) },
          ]}
        />
      </Section>
      <Section title="Observações">
        <p className="text-sm whitespace-pre-wrap">{contact.notes ?? <span className="text-muted-foreground">Sem observações.</span>}</p>
      </Section>
      <div className="px-5 pt-1">
        <Button asChild variant="outline" className="w-full">
          <Link href={`/dashboard/contacts/${contact.id}`} prefetch={false}>
            Abrir cadastro completo
          </Link>
        </Button>
      </div>
    </div>
  );
}
