import { redirect } from "next/navigation";
import { getMe } from "@/lib/api-server";
import { homePathFor } from "@/lib/routes";

export default async function Home() {
  const me = await getMe();
  redirect(me ? homePathFor(me) : "/login");
}
