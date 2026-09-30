import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/api-server";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Trocar senha" };

export default async function ChangePasswordPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  return <ChangePasswordForm required={me.user.mustChangePassword} />;
}
