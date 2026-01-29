"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SessionGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!mounted) return;

        if (!res.ok) {
          router.replace("/login");
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (!data?.ok) {
          router.replace("/login");
          return;
        }

        setReady(true);
      } catch {
        router.replace("/login");
      }
    };

    check();
    return () => {
      mounted = false;
    };
  }, [router]);

  if (!ready) return <div style={{ padding: 16 }}>Loading...</div>;

  return <>{children}</>;
}
