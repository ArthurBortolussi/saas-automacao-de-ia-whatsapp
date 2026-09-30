import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// .env único na raiz do monorepo; variáveis já presentes no ambiente têm precedência.
const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Falha rápido: sem API_URL válida o app não tem como autenticar ninguém.
const apiUrl = process.env["API_URL"];
if (!apiUrl || !URL.canParse(apiUrl)) {
  throw new Error("API_URL ausente ou inválida (ex.: http://localhost:4000). Veja .env.example.");
}
const isProduction = process.env["NODE_ENV"] === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // CSP parcial: bloqueia embed, <base> e <object>. script-src com nonce fica para quando houver necessidade.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@arthur-ai/ui"],
  // O navegador fala só com o Next; /api/* é repassado à API, então o cookie de sessão é first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${new URL(apiUrl).origin}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
