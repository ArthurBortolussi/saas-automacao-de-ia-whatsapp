import { parseCookieSecure, sessionCookieName } from "@arthur-ai/shared";
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = sessionCookieName(parseCookieSecure(process.env["SESSION_COOKIE_SECURE"], process.env.NODE_ENV));

/**
 * Checagem otimista: só evita renderizar áreas protegidas para quem nem tem cookie.
 * Não é autorização — a validação real da sessão acontece na API a cada request.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*", "/change-password"],
};
