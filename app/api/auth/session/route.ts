export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/server/getSession";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const sess = await getSessionFromCookie();

    if (!sess.ok) {
      return NextResponse.json(
        { ok: false },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    let resolvedUserId: string | null = sess.userId ?? null;

    // If this is an access-code login, map it to a profile (by email stored in access_codes.assigned_to)
    if (!resolvedUserId && sess.accessCodeId) {
      const { data: ac, error: acErr } = await supabaseAdmin
        .from("access_codes")
        .select("assigned_to")
        .eq("id", sess.accessCodeId)
        .maybeSingle();

      if (acErr) {
        return NextResponse.json(
          { ok: false, error: acErr.message },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }

      const email = (ac?.assigned_to || "").trim().toLowerCase();

      if (email) {
        const { data: profile, error: profErr } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (profErr) {
          return NextResponse.json(
            { ok: false, error: profErr.message },
            { status: 500, headers: { "Cache-Control": "no-store" } }
          );
        }

        if (profile?.id) {
          resolvedUserId = profile.id;
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        role: sess.role,
        accessCodeId: sess.accessCodeId,
        userId: resolvedUserId, // ✅ RETURN THE RESOLVED PROFILE ID
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
