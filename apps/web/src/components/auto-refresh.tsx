"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Atualiza os dados da página (Server Components) a cada `intervalMs`, só com a aba visível.
 * Polling simples: mensagens novas e status de entrega aparecem sem recarregar a página.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, intervalMs);
    // Ao voltar para a aba, atualiza na hora em vez de esperar o próximo ciclo.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);
  return null;
}
