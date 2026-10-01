"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Refresca el tablero para ver a los agentes trabajar, salvo mientras escribes en un formulario.
export function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden && !document.activeElement?.closest("form")) router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}
