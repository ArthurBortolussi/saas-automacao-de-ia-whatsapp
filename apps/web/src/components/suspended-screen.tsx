import type { SupportContacts } from "@arthur-ai/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@arthur-ai/ui/components/card";
import { Mail, MessageCircle } from "lucide-react";
import { Logo } from "./logo";
import { LogoutButton } from "./logout-button";

/**
 * Fase 7: empresa suspensa. Substitui TODO o painel (sem menu nem rotas da empresa; a API também recusa tudo com
 * 403). Mostra só os contatos públicos do suporte — nenhum motivo, valor ou dado administrativo.
 */
export function SuspendedScreen({ companyName, support }: { companyName: string; support: SupportContacts }) {
  const hasContact = Boolean(support.emailUrl ?? support.whatsappUrl);
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <Logo />
          <CardTitle className="text-lg">Acesso temporariamente suspenso</CardTitle>
          <CardDescription>
            O acesso da empresa <span className="font-medium text-foreground">{companyName}</span> ao Arthur AI está temporariamente suspenso.
            Entre em contato com o suporte para mais informações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasContact ? (
            <ul className="space-y-2 text-sm">
              {support.emailUrl && support.email ? (
                <li>
                  <a href={support.emailUrl} className="inline-flex items-center gap-2 underline-offset-4 hover:underline">
                    <Mail className="size-4" /> {support.email}
                  </a>
                </li>
              ) : null}
              {support.whatsappUrl && support.whatsapp ? (
                <li>
                  <a href={support.whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 underline-offset-4 hover:underline">
                    <MessageCircle className="size-4" /> WhatsApp do suporte (+{support.whatsapp})
                  </a>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Procure o responsável pela sua empresa para falar com o suporte do Arthur AI.</p>
          )}
          <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
            <span>Sair desta conta</span>
            <LogoutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
