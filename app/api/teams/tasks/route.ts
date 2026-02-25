import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  title: string;
  notes?: string;
  due_at?: string;
  assignee_emails: string[];
  owner_emails: string[];
  client_request_id?: string;
  source?: string;
  submitted_by_name?: string;
  submitted_by_id?: string;
  conversation_id?: string;
};

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normEmail(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "teams/tasks endpoint alive" }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    // ---- auth ----
    const apiKey = req.headers.get("x-api-key");
    if (!process.env.TEAMS_BOT_API_KEY || apiKey !== process.env.TEAMS_BOT_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<Body>;

    const title = String(body.title ?? "").trim();
    const notes = String(body.notes ?? "").trim() || null;
    const due_at = String(body.due_at ?? "").trim() || null;

    const assignee_emails = Array.isArray(body.assignee_emails) ? body.assignee_emails.map(normEmail).filter(Boolean) : [];
    const owner_emails = Array.isArray(body.owner_emails) ? body.owner_emails.map(normEmail).filter(Boolean) : [];

    const client_request_id = String(body.client_request_id ?? "").trim() || null;

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!assignee_emails.length) return NextResponse.json({ error: "Assignee(s) required" }, { status: 400 });
    if (!owner_emails.length) return NextResponse.json({ error: "Owner(s) required" }, { status: 400 });

    const writeEnabled = process.env.TEAMS_DB_WRITE_ENABLED === "true";
    if (!writeEnabled) {
      return NextResponse.json(
        { ok: true, task: { id: "DRY-RUN", title }, dry_run: true, client_request_id },
        { status: 201 }
      );
    }

    // ---- resolve profiles by email ----
    const uniqueEmails = Array.from(new Set([...assignee_emails, ...owner_emails]));

    const { data: profs, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id,email,full_name")
      .in("email", uniqueEmails);

    if (profErr) {
      return NextResponse.json({ error: "Profile lookup failed", detail: profErr.message }, { status: 400 });
    }

    const byEmail = new Map<string, { id: string; email: string | null; full_name: string | null }>();
    for (const p of profs ?? []) {
      if (p?.email) byEmail.set(String(p.email).toLowerCase(), p);
    }

    const assigneeIds = assignee_emails.map((e) => byEmail.get(e)?.id).filter(Boolean) as string[];
    const ownerIds = owner_emails.map((e) => byEmail.get(e)?.id).filter(Boolean) as string[];

    if (!assigneeIds.length) {
      return NextResponse.json(
        { error: "No assignees resolved to profiles", detail: { assignee_emails } },
        { status: 400 }
      );
    }
    if (!ownerIds.length) {
      return NextResponse.json(
        { error: "No owners resolved to profiles", detail: { owner_emails } },
        { status: 400 }
      );
    }

    // Choose a single “created_by/user_id” that satisfies your schema.
    // Using first owner id is a sensible default.
    const createdBy = process.env.TEAMS_SYSTEM_ACCESS_CODE_ID || "";
    if (!createdBy) {
      return NextResponse.json(
        { error: "Server not configured", detail: "Missing TEAMS_SYSTEM_ACCESS_CODE_ID" },
        { status: 500 }
      );
    }

    // ---- insert task ----
    const { data: createdTask, error: taskErr } = await supabaseAdmin
      .from("tasks")
      .insert({
        title,
        note: notes,
        due_at, // can be null if you want
        user_id: createdBy,
        created_by: createdBy,
        // If you have a column for idempotency, uncomment and create it:
        // external_request_id: client_request_id,
      })
      .select("id,title")
      .maybeSingle();

    if (taskErr) {
      return NextResponse.json({ error: "Task insert failed", detail: taskErr.message }, { status: 400 });
    }

    const taskId = createdTask?.id;
    if (!taskId) {
      return NextResponse.json({ error: "Task created but no id returned" }, { status: 500 });
    }

    // ---- insert assignments ----
    const ownerSet = new Set(ownerIds);

    const assignmentRows = Array.from(new Set(assigneeIds)).map((assignee_id) => ({
      task_id: taskId,
      assignee_id,
      status: "open",
      completed_at: null,
      completion_note: null,
      is_owner: ownerSet.has(assignee_id),
      due_at: null,
    }));

    const { error: aErr } = await supabaseAdmin.from("task_assignments").insert(assignmentRows);

    if (aErr) {
      // best-effort cleanup to avoid orphan tasks
      await supabaseAdmin.from("tasks").delete().eq("id", taskId);
      return NextResponse.json({ error: "Assignment insert failed", detail: aErr.message }, { status: 400 });
    }

    return NextResponse.json(
      { ok: true, task: { id: taskId, title }, dry_run: false, client_request_id },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Server error", detail: err?.message ?? String(err) }, { status: 500 });
  }
}