"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TaskRow = {
  id: string;
  title: string;
  status: string | null;
  is_done: boolean;
  due_at: string; // timestamp string
  user_id: string;
  created_at: string | null;
};

function toISOFromDateInput(dateStr: string) {
  // dateStr is "YYYY-MM-DD"
  // Use noon local time to reduce timezone/DST edge cases.
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

function toDateInputFromISO(iso: string) {
  // Convert ISO timestamp -> "YYYY-MM-DD" for <input type="date">
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDue(iso: string) {
  // Simple readable date
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TasksPage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState<string>(""); // "YYYY-MM-DD" or ""

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inline edit state
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDueDate, setEditDueDate] = useState<string>(""); // "YYYY-MM-DD"

  const openTasks = useMemo(
    () => tasks.filter((t) => (t.status ?? "open") !== "closed"),
    [tasks]
  );
  const closedTasks = useMemo(
    () => tasks.filter((t) => (t.status ?? "open") === "closed"),
    [tasks]
  );

  async function loadSessionAndTasks() {
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;

      const user = data.user;
      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);
      setUserEmail(user.email ?? "");

      const { data: taskData, error: taskErr } = await supabase
        .from("tasks")
        .select("id,title,status,is_done,due_at,user_id,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (taskErr) throw taskErr;

      setTasks((taskData ?? []) as TaskRow[]);
    } catch (e: any) {
      setErrorMsg(e.message || "Failed loading tasks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessionAndTasks();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadSessionAndTasks();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTask() {
    setErrorMsg(null);

    const title = newTitle.trim();
    if (!title) return;

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      const user = data.user;
      if (!user) {
        router.push("/login");
        return;
      }

      // Build insert payload.
      // If user doesn't pick a due date, we OMIT due_at so your DB default (now()) is used.
      const payload: any = {
        title,
        user_id: user.id,
        status: "open",
        is_done: false,
      };

      if (newDueDate) {
        payload.due_at = toISOFromDateInput(newDueDate);
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("tasks")
        .insert(payload)
        .select("id,title,status,is_done,due_at,user_id,created_at")
        .single();

      if (insertErr) throw insertErr;

      setTasks((prev) => [inserted as TaskRow, ...prev]);
      setNewTitle("");
      setNewDueDate("");
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to add task.");
    }
  }

  async function setTaskStatus(taskId: string, status: "open" | "closed") {
    setErrorMsg(null);
    try {
      const is_done = status === "closed";

      const { error } = await supabase
        .from("tasks")
        .update({ status, is_done })
        .eq("id", taskId);

      if (error) throw error;

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status, is_done } : t))
      );
    } catch (e: any) {
      setErrorMsg(e.message || "Failed updating task.");
    }
  }

  function startEdit(t: TaskRow) {
    setEditTaskId(t.id);
    setEditTitle(t.title);
    setEditDueDate(t.due_at ? toDateInputFromISO(t.due_at) : "");
  }

  function cancelEdit() {
    setEditTaskId(null);
    setEditTitle("");
    setEditDueDate("");
  }

  async function saveEdit(taskId: string) {
    setErrorMsg(null);

    const title = editTitle.trim();
    if (!title) {
      setErrorMsg("Title cannot be blank.");
      return;
    }
    if (!editDueDate) {
      setErrorMsg("Due date cannot be blank (your database requires it).");
      return;
    }

    try {
      const due_at = toISOFromDateInput(editDueDate);

      const { error } = await supabase
        .from("tasks")
        .update({ title, due_at })
        .eq("id", taskId);

      if (error) throw error;

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, title, due_at } : t))
      );

      cancelEdit();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed saving edit.");
    }
  }

  async function deleteTask(taskId: string) {
    setErrorMsg(null);
    try {
      const { error } = await supabase.from("tasks").delete().eq("id", taskId);
      if (error) throw error;

      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (editTaskId === taskId) cancelEdit();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed deleting task.");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.brand}>
            <div style={styles.logo} />
            <div>
              <div style={styles.hTitle}>Task Board</div>
              <div style={styles.hSub}>
                Signed in as <b>{userEmail || "—"}</b>
              </div>
            </div>
          </div>

          <button style={styles.ghostBtn} onClick={signOut}>
            Sign out
          </button>
        </header>

        <div style={styles.card}>
          <div style={styles.row}>
            <input
              style={styles.input}
              placeholder="Add a new task…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTask();
              }}
            />

            <input
              style={styles.dateInput}
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              title="Due date (optional — if blank, defaults to now)"
            />

            <button
              style={{ ...styles.primaryBtn, opacity: newTitle.trim() ? 1 : 0.6 }}
              disabled={!newTitle.trim()}
              onClick={addTask}
            >
              Add
            </button>
          </div>

          {errorMsg && <div style={styles.error}>{errorMsg}</div>}
        </div>

        {loading ? (
          <div style={styles.muted}>Loading…</div>
        ) : (
          <div style={styles.grid}>
            <section style={styles.column}>
              <div style={styles.colTitle}>Open</div>

              {openTasks.length === 0 ? (
                <div style={styles.empty}>No open tasks yet.</div>
              ) : (
                openTasks.map((t) => (
                  <div key={t.id} style={styles.taskCard}>
                    {editTaskId === t.id ? (
                      <>
                        <div style={{ display: "grid", gap: 10 }}>
                          <input
                            style={styles.input}
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                          />

                          <input
                            style={styles.dateInputWide}
                            type="date"
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                          />

                          <div style={styles.taskActions}>
                            <button style={styles.smallBtn} onClick={() => saveEdit(t.id)}>
                              Save
                            </button>
                            <button style={styles.smallBtn} onClick={cancelEdit}>
                              Cancel
                            </button>
                            <button style={styles.smallDanger} onClick={() => deleteTask(t.id)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={styles.taskTitle}>{t.title}</div>

                        <div style={styles.taskMeta}>
                          <span style={styles.pill}>OPEN</span>
                          <span style={styles.metaText}>
                            Due: <b>{t.due_at ? formatDue(t.due_at) : "—"}</b>
                          </span>
                        </div>

                        <div style={styles.taskActions}>
                          <button style={styles.smallBtn} onClick={() => startEdit(t)}>
                            Edit
                          </button>
                          <button style={styles.smallBtn} onClick={() => setTaskStatus(t.id, "closed")}>
                            Complete
                          </button>
                          <button style={styles.smallDanger} onClick={() => deleteTask(t.id)}>
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </section>

            <section style={styles.column}>
              <div style={styles.colTitle}>Closed</div>

              {closedTasks.length === 0 ? (
                <div style={styles.empty}>No closed tasks.</div>
              ) : (
                closedTasks.map((t) => (
                  <div key={t.id} style={styles.taskCard}>
                    <div style={styles.taskTitle}>{t.title}</div>

                    <div style={styles.taskMeta}>
                      <span style={{ ...styles.pill, opacity: 0.75 }}>CLOSED</span>
                      <span style={styles.metaText}>
                        Due: <b>{t.due_at ? formatDue(t.due_at) : "—"}</b>
                      </span>
                    </div>

                    <div style={styles.taskActions}>
                      <button style={styles.smallBtn} onClick={() => setTaskStatus(t.id, "open")}>
                        Reopen
                      </button>
                      <button style={styles.smallDanger} onClick={() => deleteTask(t.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        <div style={styles.footerNote}>
          UserId: <span style={{ opacity: 0.85 }}>{userId || "—"}</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0b1220, #0f172a)",
    color: "#e5e7eb",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  },
  shell: { maxWidth: 980, margin: "0 auto", padding: 24 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.2)",
  },
  hTitle: { fontSize: 20, fontWeight: 800 },
  hSub: { fontSize: 13, opacity: 0.85, marginTop: 2 },
  ghostBtn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 600,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    marginBottom: 18,
  },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  input: {
    flex: 1,
    minWidth: 220,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    outline: "none",
  },
  dateInput: {
    width: 170,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    outline: "none",
  },
  dateInputWide: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    outline: "none",
  },
  primaryBtn: {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.14)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
  },
  error: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    fontSize: 13,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  },
  column: {
    borderRadius: 16,
    padding: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  colTitle: { fontSize: 14, fontWeight: 800, opacity: 0.9, marginBottom: 10 },
  taskCard: {
    borderRadius: 14,
    padding: 12,
    background: "rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.10)",
    marginBottom: 10,
  },
  taskTitle: { fontSize: 14, fontWeight: 700 },
  taskMeta: { marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  pill: {
    fontSize: 11,
    fontWeight: 800,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    letterSpacing: 0.6,
  },
  metaText: { fontSize: 12, opacity: 0.9 },
  taskActions: { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" },
  smallBtn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.10)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  },
  smallDanger: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(239, 68, 68, 0.25)",
    background: "rgba(239, 68, 68, 0.15)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  },
  empty: {
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,255,255,0.04)",
    border: "1px dashed rgba(255,255,255,0.14)",
    opacity: 0.85,
    fontSize: 13,
  },
  muted: { opacity: 0.8, padding: 12 },
  footerNote: { marginTop: 16, fontSize: 12, opacity: 0.8 },
};
