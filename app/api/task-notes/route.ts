export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookie } from "@/lib/server/getSession";

type TaskNoteRow = {
  id: string;
  task_id: string;
  author_id: string;
  note: string;
  created_at: string;
};

// Fail fast if env vars missing
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function resolveRequester() {
  const sess = await getSessionFromCookie();

  if (!sess.ok) {
    return { ok: false as const, error: "Not authenticated" };
  }

  let resolvedUserId: string | null = sess.userId ?? null;

  // Match /api/auth/session behavior: map access-code -> profile id via email on access_codes.assigned_to
  if (!resolvedUserId && sess.accessCodeId) {
    const { data: ac, error: acErr } = await supabaseAdmin
      .from("access_codes")
      .select("assigned_to")
      .eq("id", sess.accessCodeId)
      .maybeSingle();

    if (acErr) return { ok: false as const, error: acErr.message };

    const email = (ac?.assigned_to || "").trim().toLowerCase();

    if (email) {
      const { data: profile, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (profErr) return { ok: false as const, error: profErr.message };
      if (profile?.id) resolvedUserId = profile.id;
    }
  }

  if (!resolvedUserId) {
    return { ok: false as const, error: "Could not resolve user id" };
  }

  const role = sess.role ? String(sess.role) : null;
  const isAdmin = role?.toLowerCase() === "admin";

  return {
    ok: true as const,
    userId: String(resolvedUserId),
    role,
    isAdmin,
    accessCodeId: sess.accessCodeId ?? null,
  };
}

async function canReadTask(taskId: string) {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

async function canWriteNotes(taskId: string, requesterId: string, requesterIsAdmin: boolean) {
  if (requesterIsAdmin) return true;

  // Owner check (your TasksClient indicates tasks.user_id exists and is used as owner id)
  const { data: task, error: taskErr } = await supabaseAdmin
    .from("tasks")
    .select("id, user_id")
    .eq("id", taskId)
    .maybeSingle();

  if (taskErr) throw taskErr;
  if (!task) return false;

  if (String(task.user_id) === String(requesterId)) return true;

  // Assigned check (you confirmed task_assignments.assignee_id is uuid)
  const { data: assigned, error: assignErr } = await supabaseAdmin
    .from("task_assignments")
    .select("task_id")
    .eq("task_id", taskId)
    .eq("assignee_id", requesterId)
    .limit(1);

  if (assignErr) throw assignErr;
  return (assigned?.length ?? 0) > 0;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId");
    const order = (searchParams.get("order") || "asc").toLowerCase() === "desc" ? "desc" : "asc";

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "Missing taskId" }, { status: 400 });
    }

    const requester = await resolveRequester();
    if (!requester.ok) {
      return NextResponse.json({ ok: false, error: requester.error }, { status: 401 });
    }

    const readable = await canReadTask(taskId);
    if (!readable) {
      return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("task_notes")
      .select("id, task_id, author_id, note, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: order === "asc" });

    if (error) throw error;

    return NextResponse.json(
      { ok: true, notes: (data || []) as TaskNoteRow[] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const taskId = body?.taskId;
    const note = body?.note;

    if (!taskId || typeof taskId !== "string") {
      return NextResponse.json({ ok: false, error: "Missing taskId" }, { status: 400 });
    }
    if (!note || typeof note !== "string" || !note.trim()) {
      return NextResponse.json({ ok: false, error: "Note cannot be empty" }, { status: 400 });
    }

    const requester = await resolveRequester();
    if (!requester.ok) {
      return NextResponse.json({ ok: false, error: requester.error }, { status: 401 });
    }

    const readable = await canReadTask(taskId);
    if (!readable) {
      return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
    }

    const writable = await canWriteNotes(taskId, requester.userId, requester.isAdmin);
    if (!writable) {
      return NextResponse.json({ ok: false, error: "Not allowed to add notes" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("task_notes")
      .insert({
        task_id: taskId,
        author_id: requester.userId, // ✅ resolved profile UUID
        note: note.trim(),
      })
      .select("id, task_id, author_id, note, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json(
      { ok: true, note: data as TaskNoteRow },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}