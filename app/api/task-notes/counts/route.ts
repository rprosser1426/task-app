export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/server/getSession";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CountsResponse = Record<string, number>;

export async function POST(req: Request) {
    try {
        const sess = await getSessionFromCookie();
        if (!sess.ok) {
            return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
        }

        // ✅ Parse and NARROW from unknown -> string[]
        const body: unknown = await req.json().catch(() => ({}));
        const taskIdsRaw =
            typeof body === "object" && body !== null && "taskIds" in body
                ? (body as any).taskIds
                : [];

        const taskIds: string[] = Array.isArray(taskIdsRaw)
            ? taskIdsRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
            : [];

        if (taskIds.length === 0) {
            return NextResponse.json(
                { ok: true, counts: {} satisfies CountsResponse },
                { headers: { "Cache-Control": "no-store" } }
            );
        }

        // ✅ Query counts (best: group + count)
        const { data, error } = await supabaseAdmin
            .from("task_notes")
            .select("task_id", { count: "exact" })
            .in("task_id", taskIds);

        if (error) throw error;

        // Build counts map safely
        const counts: CountsResponse = {};
        for (const id of taskIds) counts[id] = 0;

        for (const row of (data ?? []) as any[]) {
            const tid = String(row.task_id ?? "").trim();
            if (!tid) continue;
            // If you're not grouping server-side, this will just count rows; see note below
            counts[tid] = (counts[tid] ?? 0) + 1;
        }

        return NextResponse.json(
            { ok: true, counts },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        return NextResponse.json(
            { ok: false, error: e?.message || "Server error" },
            { status: 500, headers: { "Cache-Control": "no-store" } }
        );
    }
}