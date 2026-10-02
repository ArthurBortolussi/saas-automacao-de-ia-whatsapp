import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

const WINDOW_MS = 10 * 60_000;
const MAX_EXPORTS_PER_WINDOW = 20;
const MAX_KEYS = 10_000;

/**
 * Limite de exportações por usuário (janela fixa, EM MEMÓRIA, como o rate limit de login): gerar PDF/Excel custa
 * mais que a consulta da tela. Zera ao reiniciar a API e não é compartilhado entre instâncias.
 */
@Injectable()
export class ExportRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  consume(userId: string, now = Date.now()): void {
    const bucket = this.buckets.get(userId);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= MAX_KEYS) this.sweep(now);
      this.buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    if (bucket.count >= MAX_EXPORTS_PER_WINDOW) {
      throw new HttpException("Muitas exportações em pouco tempo. Aguarde alguns minutos e tente novamente.", HttpStatus.TOO_MANY_REQUESTS);
    }
    bucket.count += 1;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
    if (this.buckets.size >= MAX_KEYS) this.buckets.clear();
  }
}
