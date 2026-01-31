import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookie } from "@/lib/server/getSession"; // or your session helper

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const sess = await getSessionFromCookie();
    if (!sess?.ok) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("task_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, categories: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Failed loading categories" }, { status: 500 });
  }
}
