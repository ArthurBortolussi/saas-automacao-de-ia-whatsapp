import type { SupportContacts } from "@arthur-ai/shared";
import { Lock, Mail, MessageCircle } from "lucide-react";
import { Logo } from "./logo";
import { LogoutButton } from "./logout-button";

/**
 * Fase 7: empresa suspensa. Substitui TODO o painel (sem menu nem rotas da empresa; a API também recusa tudo com
 * 403). Mostra só os contatos públicos do suporte — nenhum motivo, valor ou dado administrativo.
 */
export function SuspendedScreen({ companyName, support }: { companyName: string; support: SupportContacts }) {
  const hasContact = Boolean(support.emailUrl ?? support.whatsappUrl);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Logo />
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-card sm:p-8">
        <span aria-hidden className="mb-5 grid size-11 place-items-center rounded-xl bg-warning-soft text-warning">
          <Lock className="size-5" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">Acesso temporariamente suspenso</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          O acesso da empresa <span className="font-medium text-foreground">{companyName}</span> à Vortrix AI está temporariamente suspenso.
          Entre em contato com o suporte para mais informações.
        </p>
        <div className="mt-6">
          {hasContact ? (
            <ul className="space-y-2">
              {support.emailUrl && support.email ? (
                <li>
                  <a
                    href={support.emailUrl}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-brand/40 hover:bg-accent"
                  >
                    <Mail className="size-4 text-brand-strong" /> {support.email}
                  </a>
                </li>
              ) : null}
              {support.whatsappUrl && support.whatsapp ? (
                <li>
                  <a
                    href={support.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-brand/40 hover:bg-accent"
                  >
                    <MessageCircle className="size-4 text-brand-strong" /> WhatsApp do suporte (+{support.whatsapp})
                  </a>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
              Procure o responsável pela sua empresa para falar com o suporte da Vortrix AI.
            </p>
          )}
        </div>
        <div className="mt-6 flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
          <span>Sair desta conta</span>
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
