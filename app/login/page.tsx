"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function loginWithCode() {
    setMsg(null);
    setLoading(true);

    try {
      const normalized = code.trim().toUpperCase();

      const res = await fetch("/api/auth/code-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error((data as any)?.error || "Invalid access code");
      }

      // success → session cookie is set server-side
      router.push("/tasks");
      router.refresh();
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
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
            <div style={styles.subtitle}>Enter your access code</div>
          </div>
        </div>

        <label style={styles.label}>Access Code</label>
        <input
          style={styles.input}
          placeholder="e.g. RICK-7392"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim() && !loading) loginWithCode();
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />

        <button
          style={{ ...styles.button, opacity: loading || !code.trim() ? 0.6 : 1 }}
          disabled={loading || !code.trim()}
          onClick={loginWithCode}
        >
          {loading ? "Signing in..." : "Access Tasks"}
        </button>

        {msg && <div style={styles.message}>{msg}</div>}
      </div>
    </div>
  );
}

// Put styles OUTSIDE the component so they're not recreated each render
const styles: Record<string, any> = {
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
