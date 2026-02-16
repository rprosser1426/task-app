export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/server/getSession";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function noStore(json: any, status = 200) {
    return NextResponse.json(json, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

export async function PATCH(req: Request) {
    try {
        const sess = await getSessionFromCookie();
        if (!sess.ok) return noStore({ ok: false }, 401);

        const body = await req.json().catch(() => null);
        console.log("PATCH /api/task-assignments body:", body);

        const action = body?.action as string | undefined;

        if (!action) return noStore({ ok: false, error: "Missing action" }, 400);

        // COMPLETE / REOPEN a single assignee’s assignment for a task
        if (action === "complete" || action === "reopen") {
            const taskId = body?.taskId as string | undefined;
            const assigneeId = body?.assigneeId as string | undefined;

            if (!taskId || !assigneeId) {
                return noStore({ ok: false, error: "Missing taskId or assigneeId" }, 400);
            }

            const nextStatus = action === "complete" ? "complete" : "open";
            const nextCompletedAt = nextStatus === "complete" ? new Date().toISOString() : null;



            // 1) Find the one assignment row (by id) for this task+assignee
            // If duplicates exist, we’ll detect it and tell you clearly.
            const { data: rows, error: selErr } = await supabaseAdmin
                .from("task_assignments")
                .select("id")
                .eq("task_id", taskId)
                .eq("assignee_id", assigneeId);

            if (selErr) {
                console.error("task_assignments select error:", selErr);
                return noStore({ ok: false, error: selErr.message }, 500);
            }

            if (!rows || rows.length === 0) {
                return noStore(
                    {
                        ok: false,
                        error:
                            "No assignment row found for that task+assignee. (Likely assigneeId mismatch: profile.id vs access_code.id).",
                    },
                    400
                );
            }

            if (rows.length > 1) {
                // This is the big one: duplicates will cause “complete” to behave unpredictably.
                return noStore(
                    {
                        ok: false,
                        error:
                            "Multiple assignment rows exist for the same task+assignee. Add a unique constraint on (task_id, assignee_id) and delete duplicates.",
                        duplicate_assignment_ids: rows.map((r) => r.id),
                    },
                    409
                );
            }

            const assignmentId = rows[0].id;

            // 2) Update by id (guaranteed single row)
            // 2) Update by id (guaranteed single row) + return what we wrote
            const { data: updated, error: upErr } = await supabaseAdmin
                .from("task_assignments")
                .update({
                    status: nextStatus,
                    completed_at: nextCompletedAt,
                })
                .eq("id", assignmentId)
                .select("id, status, completed_at")
                .single();

            if (upErr) {
                console.error("task_assignments update error:", upErr);
                return noStore({ ok: false, error: upErr.message }, 500);
            }

            return noStore({ ok: true, updated });



        }

        // SET OWNER flag for a single assignee's assignment row
        if (action === "set_owner") {
            const taskId = body?.taskId as string | undefined;
            const assigneeId = body?.assigneeId as string | undefined;
            const is_owner = body?.is_owner as boolean | undefined;

            if (!taskId || !assigneeId || typeof is_owner !== "boolean") {
                return noStore({ ok: false, error: "Missing taskId, assigneeId, or is_owner" }, 400);
            }

            // Update the single row for this task+assignee
            const { data: updated, error: upErr } = await supabaseAdmin
                .from("task_assignments")
                .update({ is_owner })
                .eq("task_id", taskId)
                .eq("assignee_id", assigneeId)
                .select("task_id, assignee_id, is_owner")
                .single();

            if (upErr) {
                console.error("task_assignments set_owner update error:", upErr);
                return noStore({ ok: false, error: upErr.message }, 500);
            }

            return noStore({ ok: true, updated });
        }


        // SYNC assignments for a task (set assignees list)
        if (action === "sync") {
            const taskId = body?.taskId as string | undefined;
            const nextIds = (body?.nextIds as string[] | undefined) ?? [];

            if (!taskId) return noStore({ ok: false, error: "Missing taskId" }, 400);

            const { data: existing, error: exErr } = await supabaseAdmin
                .from("task_assignments")
                .select("assignee_id")
                .eq("task_id", taskId);

            if (exErr) return noStore({ ok: false, error: exErr.message }, 500);

            const existingIds = new Set((existing ?? []).map((r) => r.assignee_id));
            const desiredIds = new Set(nextIds);

            const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));
            const toAdd = [...desiredIds].filter((id) => !existingIds.has(id));

            if (toRemove.length) {
                const { error: delErr } = await supabaseAdmin
                    .from("task_assignments")
                    .delete()
                    .eq("task_id", taskId)
                    .in("assignee_id", toRemove);

                if (delErr) return noStore({ ok: false, error: delErr.message }, 500);
            }

            if (toAdd.length) {
                const rows = toAdd.map((assignee_id) => ({
                    task_id: taskId,
                    assignee_id,
                    status: "open",
                    completed_at: null,
                }));

                const { error: upErr } = await supabaseAdmin
                    .from("task_assignments")
                    .upsert(rows, { onConflict: "task_id,assignee_id" });

                if (upErr) return noStore({ ok: false, error: upErr.message }, 500);
            }

            return noStore({ ok: true });
        }

        return noStore({ ok: false, error: `Unknown action: ${action}` }, 400);
    } catch (e: any) {
        console.error("PATCH /api/task-assignments fatal:", e);
        return noStore({ ok: false, error: e?.message || "Server error" }, 500);
    }
}
