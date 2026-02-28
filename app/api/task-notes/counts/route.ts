export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/server/getSession";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type NotesSummary = {
  count: number;
  last_note: string | null;
  last_author_id: string | null;
  last_created_at: string | null;
};

async function resolveProfileUserId(sess: {
  userId?: string | null;
  accessCodeId?: string | null;
}) {
  let resolvedUserId: string | null = sess.userId ?? null;

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

export async function GET(req: Request) {
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

    // taskIds passed from client: /api/task-notes/counts?taskIds=id1,id2,id3
    const url = new URL(req.url);
    const raw = url.searchParams.get("taskIds") || "";
    const requestedTaskIds = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (requestedTaskIds.length === 0) {
      return NextResponse.json(
        { ok: true, byTaskId: {} },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Non-admin: only allow tasks assigned to me
    let allowedTaskIds = requestedTaskIds;

    if (!isAdmin) {
      const resolvedUserId = await resolveProfileUserId({
        userId: sess.userId ?? null,
        accessCodeId: sess.accessCodeId ?? null,
      });

      if (!resolvedUserId) {
        return NextResponse.json(
          { ok: false, error: "No profile userId resolved for this session." },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }

      const { data: rows, error: aErr } = await supabaseAdmin
        .from("task_assignments")
        .select("task_id")
        .eq("assignee_id", resolvedUserId)
        .in("task_id", requestedTaskIds);

      if (aErr) throw aErr;

      const allowed = new Set((rows ?? []).map((r: any) => String(r.task_id)));
      allowedTaskIds = requestedTaskIds.filter((id) => allowed.has(id));
    }

    if (allowedTaskIds.length === 0) {
      return NextResponse.json(
        { ok: true, byTaskId: {} },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Pull notes (desc) so first one per task is "latest"
    const { data: notes, error: nErr } = await supabaseAdmin
      .from("task_notes")
      .select("task_id, author_id, note, created_at")
      .in("task_id", allowedTaskIds)
      .order("created_at", { ascending: false });

    if (nErr) throw nErr;

    const byTaskId: Record<string, NotesSummary> = {};

    for (const tid of allowedTaskIds) {
      byTaskId[tid] = { count: 0, last_note: null, last_author_id: null, last_created_at: null };
    }

    for (const n of notes ?? []) {
      const taskId = String((n as any).task_id);
      if (!byTaskId[taskId]) continue;

      byTaskId[taskId].count += 1;

      // since we're ordered DESC, first time we see a task is the latest note
      if (!byTaskId[taskId].last_created_at) {
        byTaskId[taskId].last_note = (n as any).note ?? null;
        byTaskId[taskId].last_author_id = (n as any).author_id ?? null;
        byTaskId[taskId].last_created_at = (n as any).created_at ?? null;
      }
    }

    return NextResponse.json(
      { ok: true, byTaskId },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}