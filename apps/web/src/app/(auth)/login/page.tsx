import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/api-server";
import { homePathFor } from "@/lib/routes";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  const me = await getMe();
  if (me) redirect(homePathFor(me));
  return <LoginForm />;
}
