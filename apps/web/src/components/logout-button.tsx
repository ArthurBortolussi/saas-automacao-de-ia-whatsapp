"use client";

import { Button } from "@arthur-ai/ui/components/button";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { apiMutate } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Sair"
      title="Sair"
      disabled={pending}
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
