export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/server/getSession";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resolveProfileUserId(sess: { userId?: string | null; accessCodeId?: string | null }) {
  let resolvedUserId: string | null = sess.userId ?? null;

  // If this is an access-code login, map it to a profile (by email stored in access_codes.assigned_to)
  if (!resolvedUserId && sess.accessCodeId) {
    const { data: ac, error: acErr } = await supabaseAdmin
      .from("access_codes")
      .select("assigned_to")
      .eq("id", sess.accessCodeId)
      .maybeSingle();

    if (acErr) throw acErr;

    const email = (ac?.assigned_to || "").trim().toLowerCase();

    if (email) {
      const { data: profile, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (profErr) throw profErr;

      if (profile?.id) resolvedUserId = profile.id;
    }
  }

  return resolvedUserId;
}

export async function GET() {
  try {
    const sess = await getSessionFromCookie();

    if (!sess.ok) {
      return NextResponse.json(
        { ok: false },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const role = String(sess.role || "").toLowerCase();
    const isAdmin = role === "admin";

    const resolvedUserId = await resolveProfileUserId({
      userId: sess.userId ?? null,
      accessCodeId: sess.accessCodeId ?? null,
    });

    // ✅ Admin: return ALL tasks (with ALL assignments)
    if (isAdmin) {
      const { data: tasks, error } = await supabaseAdmin
        .from("tasks")
        .select(
          `
          id,
          title,
          note,
          status,
          is_done,
          due_at,
          user_id,
          created_at,
          task_assignments (
            id,
            task_id,
            assignee_id,
            status,
            completed_at,
            completion_note,
            created_at
          )
        `
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      return NextResponse.json(
        { ok: true, tasks: tasks ?? [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ✅ Non-admin: must have a resolved profile id
    if (!resolvedUserId) {
      return NextResponse.json(
        { ok: false, error: "No profile userId resolved for this session." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ✅ Step 1: find task_ids assigned to this user (by profile id)
    const { data: myAssignRows, error: aErr } = await supabaseAdmin
      .from("task_assignments")
      .select("task_id")
      .eq("assignee_id", resolvedUserId);

    if (aErr) throw aErr;

    const taskIds = Array.from(new Set((myAssignRows ?? []).map((r) => r.task_id))).filter(Boolean);

    if (taskIds.length === 0) {
      return NextResponse.json(
        { ok: true, tasks: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ✅ Step 2: fetch those tasks with ALL assignments (so you can see other users + status)
    const { data: tasks, error: tErr } = await supabaseAdmin
      .from("tasks")
      .select(
        `
        id,
        title,
        note,
        status,
        is_done,
        due_at,
        user_id,
        created_at,
        task_assignments (
          id,
          task_id,
          assignee_id,
          status,
          completed_at,
          completion_note,
          created_at
        )
      `
      )
      .in("id", taskIds)
      .order("created_at", { ascending: false });

    if (tErr) throw tErr;

    return NextResponse.json(
      { ok: true, tasks: tasks ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
