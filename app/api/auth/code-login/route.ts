export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

// ✅ Fail fast if env vars are missing (this is a VERY common 500 cause)
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}
if (!SERVICE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.code ?? "");
    const normalized = raw.trim().toUpperCase();

    console.log("CODE LOGIN → supabase url:", SUPABASE_URL);
    console.log("CODE  → service key present:", !!SERVICE_KEY);
    console.log("CODE LOGIN → raw:", raw);
    console.log("CODE LOGIN → normalized:", normalized);

    if (!normalized) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    // 1) Validate access code
    const { data: accessCode, error: codeErr } = await supabaseAdmin
      .from("access_codes")
      .select("id, is_active, expires_at, role")
      .ilike("code", normalized)
      .maybeSingle();

    console.log("CODE LOGIN → accessCode:", accessCode);
    console.log("CODE LOGIN → codeErr:", codeErr);

    if (codeErr) {
      return NextResponse.json(
        { error: "DB error looking up code", details: codeErr },
        { status: 500 }
      );
    }

    if (!accessCode) {
      return NextResponse.json(
        { error: "Invalid access code", debug: { normalized } },
        { status: 401 }
      );
    }

    if (!accessCode.is_active) {
      return NextResponse.json({ error: "Access code is inactive" }, { status: 401 });
    }

    if (accessCode.expires_at && new Date(accessCode.expires_at) < new Date()) {
      return NextResponse.json({ error: "Access code is expired" }, { status: 401 });
    }

    // 2) Create session token + DB session row
    const sessionToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const { error: sessErr } = await supabaseAdmin
      .from("access_code_sessions")
      .insert({
        access_code_id: accessCode.id,
        session_token: sessionToken,
        expires_at: expiresAt.toISOString(),
      });

    console.log("CODE LOGIN → session insert error:", sessErr);

    if (sessErr) {
      // ✅ This will tell us if the table is missing, column mismatch, FK issue, etc.
      return NextResponse.json(
        { error: "Failed to create session", details: sessErr },
        { status: 500 }
      );
    }

    // Optional audit
    const { error: auditErr } = await supabaseAdmin
      .from("access_codes")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", accessCode.id);

    console.log("CODE LOGIN → audit update error:", auditErr);

    // 3) Set httpOnly cookie
    const cookieStore = await cookies();
    cookieStore.set("taskapp_session", sessionToken, {
      httpOnly: true,
      secure: true,        // required for Teams iframe
      sameSite: "none",    // required for Teams iframe
      path: "/",
      expires: expiresAt,
    });


    console.log("CODE LOGIN → success, cookie set");

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("CODE LOGIN → fatal error:", err);

    // ✅ Return the message so you can see it in Network → Response
    return NextResponse.json(
      { error: "Server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
