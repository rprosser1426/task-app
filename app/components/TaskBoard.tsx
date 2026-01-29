"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AssignmentRow = {
  id: string;
  task_id: string;
  assignee_id: string;
  status: string | null;
  completed: boolean | null;
  completed_at: string | null;
  completion_note: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  created_at: string;
  due_at: string | null;
  notes: string | null;
  task_assignments?: AssignmentRow[];
};

type SessionResp =
  | { ok: true; accessCodeId: string; role?: string }
  | { ok: false };

export default function TaskBoard() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remaining = useMemo(
    () => tasks.filter((t) => !t.is_done).length,
    [tasks]
  );

  async function getSession(): Promise<SessionResp> {
    const res = await fetch("/api/auth/session");
    if (!res.ok) return { ok: false };
    return (await res.json().catch(() => ({ ok: false }))) as SessionResp;
  }

  const loadTasks = async () => {
    setError(null);
    setLoading(true);

    const session = await getSession();
    if (!session.ok) {
      setError("Not signed in. Please log in again.");
      setTasks([]);
      setLoading(false);
      return;
    }

    // ✅ Treat accessCodeId as the “user” for this code-based auth system
    const userId = session.accessCodeId;

    const { data, error } = await supabase
      .from("tasks")
      .select(
        `
        id,
        user_id,
        title,
        is_done,
        created_at,
        due_at,
        notes,
        task_assignments (
          id,
          task_id,
          assignee_id,
          status,
          completed,
          completed_at,
          completion_note,
          created_at
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) setError(error.message);
    else setTasks((data as TaskRow[]) ?? []);

    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
    // NOTE: removed supabase.auth.onAuthStateChange — no longer relevant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;

    setError(null);
    setSaving(true);

    const session = await getSession();
    if (!session.ok) {
      setSaving(false);
      setError("Not signed in. Please log in again.");
      return;
    }

    const userId = session.accessCodeId;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        title,
        is_done: false,
      })
      .select(
        `
        id,
        user_id,
        title,
        is_done,
        created_at,
        due_at,
        notes,
        task_assignments (
          id,
          task_id,
          assignee_id,
          status,
          completed,
          completed_at,
          completion_note,
          created_at
        )
      `
      )
      .single();

    if (error) {
      setError(error.message);
    } else if (data) {
      setTasks((prev) => [data as TaskRow, ...prev]);
      setNewTitle("");
    }

    setSaving(false);
  };

  const toggleDone = async (task: TaskRow) => {
    setError(null);

    // optimistic UI
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, is_done: !t.is_done } : t))
    );

    const { error } = await supabase
      .from("tasks")
      .update({ is_done: !task.is_done })
      .eq("id", task.id);

    if (error) {
      // revert if failed
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, is_done: task.is_done } : t))
      );
      setError(error.message);
    }
  };

  const deleteTask = async (taskId: string) => {
    setError(null);

    const before = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    const { error } = await supabase.from("tasks").delete().eq("id", taskId);

    if (error) {
      setTasks(before);
      setError(error.message);
    }
  };

  return (
    <section>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a new task…"
          style={{ flex: 1, padding: 10 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTask();
          }}
        />
        <button
          onClick={addTask}
          disabled={saving || !newTitle.trim()}
          style={{ padding: "10px 12px", cursor: "pointer" }}
        >
          {saving ? "Adding..." : "Add"}
        </button>
        <button
          onClick={loadTasks}
          disabled={loading}
          style={{ padding: "10px 12px", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 14, opacity: 0.8 }}>
        {loading ? "Loading tasks..." : `${remaining} remaining • ${tasks.length} total`}
      </div>

      {error && <div style={{ marginTop: 10, color: "crimson" }}>{error}</div>}

      <ul style={{ marginTop: 14, paddingLeft: 0, listStyle: "none" }}>
        {tasks.map((t) => (
          <li
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 8px",
              border: "1px solid #ddd",
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            <input type="checkbox" checked={t.is_done} onChange={() => toggleDone(t)} />

            <div style={{ flex: 1 }}>
              <div
                style={{
                  textDecoration: t.is_done ? "line-through" : "none",
                  opacity: t.is_done ? 0.6 : 1,
                  fontWeight: 600,
                }}
              >
                {t.title}
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Created: {new Date(t.created_at).toLocaleString()}
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Assigned: {t.task_assignments?.length ? "Yes" : "No"}
              </div>
            </div>

            <button
              onClick={() => deleteTask(t.id)}
              style={{ padding: "8px 10px", cursor: "pointer" }}
              title="Delete task"
            >
              Delete
            </button>
          </li>
        ))}

        {!loading && tasks.length === 0 && (
          <li style={{ marginTop: 12, opacity: 0.8 }}>No tasks yet. Add one above.</li>
        )}
      </ul>
    </section>
  );
}
