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
      return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
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
          category_id,
          task_category:task_categories ( name ),
          task_assignments (
          id,
          task_id,
          assignee_id,
          status,
          completed_at,
          completion_note,
          created_at,
          is_owner,
          due_at
        )

        `
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      const tasksWithCategory = (tasks ?? []).map((t: any) => {
        const cat = Array.isArray(t.task_category) ? t.task_category[0] : t.task_category;
        return { ...t, category_name: cat?.name ?? null };
      });


      return NextResponse.json(
        { ok: true, tasks: tasksWithCategory },
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
      return NextResponse.json({ ok: true, tasks: [] }, { headers: { "Cache-Control": "no-store" } });
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
        category_id,
        task_category:task_categories ( name ),
        task_assignments (
          id,
          task_id,
          assignee_id,
          status,
          completed_at,
          completion_note,
          created_at,
          is_owner,
          due_at
        )
      `
      )
      .in("id", taskIds)
      .order("created_at", { ascending: false });

    if (tErr) throw tErr;

    const tasksWithCategory = (tasks ?? []).map((t: any) => {
      const cat = Array.isArray(t.task_category)
        ? t.task_category[0]
        : t.task_category;

      return {
        ...t,
        category_name: cat?.name ?? null,
      };
    });





    return NextResponse.json(
      { ok: true, tasks: tasksWithCategory },
      { headers: { "Cache-Control": "no-store" } }
    );

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// ---------------------------
// Teams Webhook (server-only)
// ---------------------------

async function postToTeams(webhookUrl: string, payload: any) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Teams webhook failed:", res.status, text);
    }
  } catch (err) {
    console.error("Teams webhook error:", err);
  }
}

function buildTeamsAssignmentCard(params: {
  subject: string;
  note?: string | null;
  // list of assignees for display
  assigned: { name: string; email?: string | null }[];
  // list of people we want to @mention (usually notify targets)
  mentions: { name: string; email: string }[];
}) {
  const { subject, note, assigned, mentions } = params;

  const cleanNote = (note ?? "").trim();

  // Build <at>...</at> strings
  const mentionText = mentions.length
    ? `Hi ${mentions.map(m => `<at>${m.email}</at>`).join(", ")}`
    : null;

  // Entities must line up with the <at> tags
  const entities = mentions.map(m => ({
    type: "mention",
    text: `<at>${m.email}</at>`,
    mentioned: {
      id: m.email,     // often works as UPN/email; if not, we’ll switch to AAD user id
      name: m.name
    }
  }));

  const body: any[] = [
    { type: "TextBlock", text: "📌 Task Assigned", weight: "Bolder", size: "Medium" },
  ];

  if (mentionText) {
    body.push({ type: "TextBlock", text: mentionText, wrap: true });
  }

  body.push({ type: "TextBlock", text: `**Subject:** ${subject}`, wrap: true });

  if (cleanNote) {
    body.push({ type: "TextBlock", text: `**Note:** ${cleanNote}`, wrap: true });
  }

  body.push({
    type: "TextBlock",
    text: `**Assigned to:** ${assigned.map(a => a.name).join(", ")}`,
    wrap: true,
  });

  const card: any = {
    type: "AdaptiveCard",
    version: "1.4",
    body,
  };

  if (entities.length) {
    card.msteams = { entities };
  }

  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
  };
}





export async function POST(req: Request) {
  try {
    const sess = await getSessionFromCookie();

    if (!sess.ok) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await req.json().catch(() => ({}));

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const due_at = typeof body.due_at === "string" ? body.due_at : null;
    const note = body.note === null ? null : typeof body.note === "string" ? body.note.trim() : null;
    const category_id = typeof body.category_id === "string" && body.category_id.trim() ? body.category_id : null;


    const rawAssignees: unknown[] = Array.isArray(body.assignee_ids)
      ? body.assignee_ids
      : [];

    const assignee_ids: string[] = Array.from(
      new Set(
        rawAssignees
          .map((x) => String(x ?? "").trim())
          .filter((s) => s.length > 0)
      )
    );

    // ✅ NEW: owner_ids from client (optional). If none provided, default owner = first assignee.
    // Single owner preferred.
    const rawOwners: unknown[] = Array.isArray(body.owner_ids) ? body.owner_ids : [];

    const owner_ids: string[] = Array.from(
      new Set(
        rawOwners
          .map((x) => String(x ?? "").trim())
          .filter((s) => s.length > 0)
      )
    );

    // Choose ONE owner:
    // 1) first owner_id that is also in assignee_ids
    // 2) otherwise first assignee
    const owner_id: string | null =
      (owner_ids.find((id) => assignee_ids.includes(id)) ?? null) ||
      (assignee_ids[0] ?? null);



    if (!title) {
      return NextResponse.json(
        { ok: false, error: "Title cannot be blank" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!due_at) {
      return NextResponse.json(
        { ok: false, error: "Due date cannot be blank" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

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

    const { data: createdTask, error: taskErr } = await supabaseAdmin
      .from("tasks")
      .insert({
        title,
        due_at,
        note,
        category_id: category_id ?? null, // ✅ add this
        user_id: sess.accessCodeId,   // ✅ satisfies tasks_user_id_fkey
        created_by: sess.accessCodeId // ✅ satisfies tasks_created_by_fkey
      })
      .select("id")
      .maybeSingle();



    if (taskErr) {
      return NextResponse.json(
        { ok: false, error: taskErr.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const taskId = createdTask?.id;
    if (!taskId) {
      return NextResponse.json(
        { ok: false, error: "Task created but no id returned." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (assignee_ids.length > 0) {
      // ✅ Always pick an owner when at least 1 assignee exists
      const final_owner_id = owner_id ?? assignee_ids[0];

      const rows = assignee_ids.map((assignee_id: string) => ({
        task_id: taskId,
        assignee_id,
        status: "open",
        completed_at: null,
        completion_note: null,
        is_owner: assignee_id === final_owner_id,
        due_at: null,
      }));


      const { error: aErr } = await supabaseAdmin.from("task_assignments").insert(rows);

      if (aErr) {
        // best-effort cleanup so you don't get orphan tasks
        await supabaseAdmin.from("tasks").delete().eq("id", taskId);
        return NextResponse.json(
          { ok: false, error: aErr.message },
          { status: 400, headers: { "Cache-Control": "no-store" } }
        );
      }
      // ✅ Teams notification ONLY if assigning to someone other than yourself
      const webhookUrl = process.env.TEAMS_WEBHOOK_URL;

      if (webhookUrl) {
        const notifyUserIds = assignee_ids.filter((id) => id !== resolvedUserId);

        if (notifyUserIds.length > 0) {
          const { data: assignedProfiles, error: profErr } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, email")
            .in("id", notifyUserIds);

          if (!profErr) {
            const assigned = (assignedProfiles ?? []).map((p: any) => ({
              name: p.full_name || p.email || p.id,
              email: p.email || null,
            }));

            // Mention ONLY the users we are notifying (non-self), and only if they have email
            const mentions = (assignedProfiles ?? [])
              .filter((p: any) => notifyUserIds.includes(p.id))
              .map((p: any) => ({
                name: p.full_name || p.email || p.id,
                email: p.email,
              }))
              .filter((m: any) => !!m.email);

            void postToTeams(
              webhookUrl,
              buildTeamsAssignmentCard({
                subject: title,
                note: note,
                assigned,
                mentions,
              })
            );


          }
        }
      }


    }

    return NextResponse.json({ ok: true, id: taskId }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "POST /api/tasks failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const sess = await getSessionFromCookie();

    if (!sess.ok) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing id" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    // delete assignments first (safe even if you have cascade)
    const { error: aErr } = await supabaseAdmin.from("task_assignments").delete().eq("task_id", id);
    if (aErr) {
      return NextResponse.json(
        { ok: false, error: aErr.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );


    }

    const { error: tErr } = await supabaseAdmin.from("tasks").delete().eq("id", id);
    if (tErr) {
      return NextResponse.json(
        { ok: false, error: tErr.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "DELETE /api/tasks failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const sess = await getSessionFromCookie();

    if (!sess.ok) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await req.json().catch(() => ({}));

    const taskId = String(body.taskId || "");
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const due_at = typeof body.due_at === "string" ? body.due_at : null;
    const note = body.note === null ? null : typeof body.note === "string" ? body.note.trim() : null;

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "Missing taskId" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!title) {
      return NextResponse.json(
        { ok: false, error: "Title cannot be blank" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const updatePayload: any = { title, note };

    // only update global due date if explicitly sent
    if (due_at) updatePayload.due_at = due_at;

    const { error } = await supabaseAdmin
      .from("tasks")
      .update(updatePayload)
      .eq("id", taskId);



    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "PATCH /api/tasks failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
