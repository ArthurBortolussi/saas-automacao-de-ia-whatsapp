import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { BrandBackdrop } from "@/components/brand-backdrop";
import { Logo } from "@/components/logo";

const POINTS = [
  "Atendimento pelo WhatsApp com IA e equipe no mesmo lugar",
  "Fila, distribuição e transferências sem planilhas",
  "Relatórios claros para acompanhar a operação",
];

/** Telas de acesso: painel de marca à esquerda (desktop) e formulário em destaque. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex lg:flex-col">
        <BrandBackdrop />
        <Logo tone="dark" className="relative" />
        <div className="relative mt-auto max-w-md space-y-6">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance text-white">
            Atendimento inteligente para empresas que levam o cliente a sério.
          </h2>
          <ul className="space-y-3 text-sm">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-violet" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-sidebar-muted">© Vortrix AI</p>
      </section>
      <section className="flex items-center justify-center bg-background px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex justify-center lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
