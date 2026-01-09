"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendMagicLink() {
    setMsg(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // sends them back to the app after clicking email link
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });

      if (error) throw error;

      setMsg("✅ Check your email for the magic link.");
      setEmail("");
    } catch (e: any) {
      setMsg(`❌ ${e.message || "Something went wrong sending the link."}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brandRow}>
          <div style={styles.logo} />
          <div>
            <div style={styles.title}>Task App</div>
            <div style={styles.subtitle}>Sign in to continue</div>
          </div>
        </div>

        <label style={styles.label}>Email</label>
        <input
          style={styles.input}
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button
          style={{ ...styles.button, opacity: loading || !email ? 0.6 : 1 }}
          disabled={loading || !email}
          onClick={sendMagicLink}
        >
          {loading ? "Sending..." : "Send Magic Link"}
        </button>

        {msg && <div style={styles.message}>{msg}</div>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "linear-gradient(180deg, #0b1220, #0f172a)",
    padding: 24,
    color: "#e5e7eb",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  },
  brandRow: { display: "flex", gap: 12, alignItems: "center", marginBottom: 16 },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.2)",
  },
  title: { fontSize: 20, fontWeight: 700, letterSpacing: 0.2 },
  subtitle: { fontSize: 13, opacity: 0.8, marginTop: 2 },
  label: { display: "block", fontSize: 12, opacity: 0.85, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    outline: "none",
    marginBottom: 12,
  },
  button: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.12)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 600,
  },
  message: { marginTop: 12, fontSize: 13, opacity: 0.9 },
};
