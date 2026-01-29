import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type SessionShape = {
  ok: boolean;
  role?: string;
  accessCodeId?: string;
  userId?: string; // ✅ ADD THIS LINE
};


export async function getSessionFromCookie(): Promise<SessionShape> {
  const cookieStore = await cookies();
  const token = cookieStore.get("taskapp_session")?.value;

  if (!token) return { ok: false };

  // 1) Try to fetch role + user_id (if your access_codes table has it)
  let data: any = null;
  let error: any = null;

  {
    const r = await supabaseAdmin
      .from("access_code_sessions")
      .select(
        `
        id,
        expires_at,
        access_code_id,
        access_code:access_codes (
          role,
          user_id
        )
      `
      )
      .eq("session_token", token)
      .maybeSingle();

    data = r.data;
    error = r.error;
  }

  // 2) If that failed (often because user_id column doesn't exist), fallback to role only
  if (error) {
    const r2 = await supabaseAdmin
      .from("access_code_sessions")
      .select(
        `
        id,
        expires_at,
        access_code_id,
        access_code:access_codes (
          role
        )
      `
      )
      .eq("session_token", token)
      .maybeSingle();

    data = r2.data;
    error = r2.error;
  }

  if (error || !data) return { ok: false };


  if (data.expires_at && new Date(data.expires_at) < new Date()) return { ok: false };

  const role =
    typeof (data as any).access_code?.role === "string"
      ? (data as any).access_code.role
      : "user";

  return {
    ok: true,
    role,
    accessCodeId: data.access_code_id,
    userId: (data as any).access_code?.user_id ?? undefined, // may be undefined if column doesn't exist
  };

}

export { supabaseAdmin };
