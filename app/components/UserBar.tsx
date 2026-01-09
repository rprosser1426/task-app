"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type UserInfo = {
  email?: string | null;
};

export default function UserBar() {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser({ email: data.user?.email ?? null });
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(async () => {
      // refresh user info on any auth change
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser({ email: data.user?.email ?? null });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    // SessionGuard will redirect to /login when session becomes null
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 16 }}>
      <div>
        <div style={{ fontWeight: 700 }}>Task Board</div>
        <div style={{ fontSize: 14, opacity: 0.8 }}>{user?.email ? `Signed in as ${user.email}` : "Signed in"}</div>
      </div>

      <button onClick={signOut} style={{ padding: "8px 12px", cursor: "pointer" }}>
        Log out
      </button>
    </div>
  );
}
