import { NextResponse } from "next/server";

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

export async function GET() {
  return NextResponse.json({ ok: true, message: "teams/tasks endpoint alive" }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get("x-api-key");
    if (!process.env.TEAMS_BOT_API_KEY || apiKey !== process.env.TEAMS_BOT_API_KEY) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as Partial<Body>;

    const title = String(body.title ?? "").trim();
    const notes = String(body.notes ?? "").trim();
    const due_at = String(body.due_at ?? "").trim();
    const assignee_emails = Array.isArray(body.assignee_emails) ? body.assignee_emails : [];
    const owner_emails = Array.isArray(body.owner_emails) ? body.owner_emails : [];
    const client_request_id = String(body.client_request_id ?? "").trim();

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

    // TODO: replace with real DB insert
    const created = { id: "TEMP-123", title };

    return NextResponse.json({ ok: true, task: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}