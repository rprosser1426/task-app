"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Signing you in...");

  useEffect(() => {
    const run = async () => {
      try {
        // 1) PKCE flow: /auth/callback?code=...
        const searchParams = new URLSearchParams(window.location.search);
        const code = searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg(`Login failed: ${error.message}`);
            return;
          }
          router.replace("/");
          return;
        }

        // 2) Implicit flow: /auth/callback#access_token=...&refresh_token=...
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;

        const hashParams = new URLSearchParams(hash);
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });

          if (error) {
            setMsg(`Login failed: ${error.message}`);
            return;
          }

          // Clean the URL (removes tokens from the address bar)
          window.history.replaceState({}, document.title, "/auth/callback");
          router.replace("/");
          return;
        }

        setMsg("Missing code in callback URL. Please request a new Magic Link.");
      } catch (e: any) {
        setMsg(`Unexpected error: ${e?.message ?? String(e)}`);
      }
    };

    run();
  }, [router]);

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Signing in</h1>
      <p style={{ marginTop: 12 }}>{msg}</p>
    </div>
  );
}
