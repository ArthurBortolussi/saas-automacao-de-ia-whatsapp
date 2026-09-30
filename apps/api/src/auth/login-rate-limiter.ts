import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";

export interface LoginRateLimitOptions {
  windowMs: number;
  maxAttemptsPerIp: number;
  maxFailuresPerEmail: number;
}

export const LOGIN_RATE_LIMIT_OPTIONS = Symbol("LOGIN_RATE_LIMIT_OPTIONS");
export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitOptions = {
  windowMs: 15 * 60_000,
  maxAttemptsPerIp: 30,
  maxFailuresPerEmail: 5,
};

// Limite de memória: sob ataque com muitas chaves distintas, descarta as mais antigas.
const MAX_KEYS = 50_000;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limit de login EM MEMÓRIA (janela fixa).
 * Limitações conhecidas desta fase: zera ao reiniciar a API e não é compartilhado entre
 * instâncias. Com mais de uma instância, precisa de um store compartilhado (ex.: Redis).
 */
@Injectable()
export class LoginRateLimiter implements OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(@Inject(LOGIN_RATE_LIMIT_OPTIONS) private readonly options: LoginRateLimitOptions) {
    this.sweeper = setInterval(() => {
      this.sweep();
    }, 60_000);
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  /** Segundos até liberar, ou null se o login pode prosseguir. */
  retryAfter(ip: string, email: string): number | null {
    const now = Date.now();
    const blocked = [
      this.blockedUntil(`ip:${ip}`, this.options.maxAttemptsPerIp, now),
      this.blockedUntil(`email:${email}`, this.options.maxFailuresPerEmail, now),
    ].filter((value): value is number => value !== null);
    return blocked.length ? Math.ceil((Math.max(...blocked) - now) / 1000) : null;
  }

  registerAttempt(ip: string): void {
    this.increment(`ip:${ip}`);
  }

  registerFailure(email: string): void {
    this.increment(`email:${email}`);
  }

  clearFailures(email: string): void {
    this.buckets.delete(`email:${email}`);
  }

  private blockedUntil(key: string, max: number, now: number): number | null {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) return null;
    return bucket.count >= max ? bucket.resetAt : null;
  }

  private increment(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) {
      bucket.count += 1;
      return;
    }
    if (this.buckets.size >= MAX_KEYS) {
      const oldest = this.buckets.keys().next();
      if (!oldest.done) this.buckets.delete(oldest.value);
    }
    this.buckets.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
