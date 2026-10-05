import { Button } from "@arthur-ai/ui/components/button";
import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4">
      <Logo />
      <div className="space-y-3 text-center">
        <p className="text-sm font-medium text-brand-strong">Erro 404</p>
        <h1 className="text-xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço não existe ou você não tem acesso a ele.</p>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/">Voltar ao início</Link>
        </Button>
      </div>
    </main>
  );
}
