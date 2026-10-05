"use client";

import { Button } from "@arthur-ai/ui/components/button";
import { cn } from "@arthur-ai/ui/lib/utils";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { apiMutate } from "@/lib/api-client";

export function LogoutButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Sair"
      title="Sair"
      disabled={pending}
      className={cn(tone === "dark" && "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white")}
      onClick={() =>
        startTransition(async () => {
          await apiMutate("POST", "/auth/logout");
          router.replace("/login");
          router.refresh();
        })
      }
    >
      <LogOut />
    </Button>
  );
}
