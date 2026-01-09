"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
};

type AssignmentRow = {
  id: string;
  task_id: string;
  assignee_id: string;
  status: string | null;
  completed_at: string | null;
  completion_note: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  note: string | null;
  status: string | null;
  is_done: boolean;
  due_at: string;
  user_id: string;
  created_at: string | null;
  task_assignments: AssignmentRow[]; // ALWAYS normalized to array
};

function toISOFromDateInput(dateStr: string) {
  // Use noon local time to reduce timezone edge cases
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

function toDateInputFromISO(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDue(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TasksPage() {
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<ProfileRow[]>([]);

  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState<string>("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inline edit state
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDueDate, setEditDueDate] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");

  // Multi-assignment draft: taskId -> array of assigneeIds
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, string[]>>({});

  // Prevent overlapping saves per task
  const [savingAssignments, setSavingAssignments] = useState<Record<string, boolean>>({});

  // Collapse/Expand: only one open at a time (keeps UI tidy)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const openTasks = useMemo(
    () => tasks.filter((t) => (t.status ?? "open") !== "closed"),
    [tasks]
  );
  const closedTasks = useMemo(
    () => tasks.filter((t) => (t.status ?? "open") === "closed"),
    [tasks]
  );

  function displayUserName(uid: string) {
    const u = users.find((x) => x.id === uid);
    return u?.full_name || u?.email || uid;
  }

  function normalizeAssignments(raw: any): AssignmentRow[] {
    // Supabase/PostgREST may return [] OR null OR a single object
    if (Array.isArray(raw)) return raw as AssignmentRow[];
    if (!raw) return [];
    return [raw as AssignmentRow];
  }

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

      // Load my role
      const { data: myProfile, error: profErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profErr) throw profErr;

      const admin = (myProfile?.role ?? "").toLowerCase() === "admin";
      setIsAdmin(admin);

      // Load users (for assignment list)
      const { data: profileData, error: profilesErr } = await supabase
        .from("profiles")
        .select("id,email,full_name,role")
        .order("created_at", { ascending: true });

      if (profilesErr) throw profilesErr;
      setUsers((profileData ?? []) as ProfileRow[]);

      // Load tasks + assignments
      const { data: taskData, error: taskErr } = await supabase
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
          task_assignments (
            id,
            task_id,
            assignee_id,
            status,
            completed_at,
            completion_note,
            created_at
          )
        `
        )
        .order("created_at", { ascending: false });

      if (taskErr) throw taskErr;

      const normalizedTaskRows: TaskRow[] = (taskData ?? []).map((t: any) => ({
        ...t,
        note: t.note ?? null,
        task_assignments: normalizeAssignments(t.task_assignments),
      }));

      setTasks(normalizedTaskRows);

      // Pre-fill checkbox state with current assignees
      const draft: Record<string, string[]> = {};
      for (const t of normalizedTaskRows) {
        draft[t.id] = (t.task_assignments ?? []).map((a) => a.assignee_id);
      }
      setAssignmentDraft(draft);
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

      const payload: any = {
        title,
        user_id: user.id,
        status: "open",
        is_done: false,
        note: null,
      };

      if (newDueDate) payload.due_at = toISOFromDateInput(newDueDate);

      const { data: inserted, error: insertErr } = await supabase
        .from("tasks")
        .insert(payload)
        .select("id,title,note,status,is_done,due_at,user_id,created_at")
        .single();

      if (insertErr) throw insertErr;

      const insertedTask: TaskRow = {
        ...(inserted as any),
        note: (inserted as any)?.note ?? null,
        task_assignments: [],
      };

      setTasks((prev) => [insertedTask, ...prev]);
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

      // If we close it while expanded, collapse it
      setExpandedTaskId((prev) => (prev === taskId ? null : prev));
    } catch (e: any) {
      setErrorMsg(e.message || "Failed updating task.");
    }
  }

  function startEdit(t: TaskRow) {
    setEditTaskId(t.id);
    setEditTitle(t.title);
    setEditDueDate(t.due_at ? toDateInputFromISO(t.due_at) : "");
    setEditNote(t.note ?? "");
    // Ensure it is expanded while editing
    setExpandedTaskId(t.id);
  }

  function cancelEdit() {
    setEditTaskId(null);
    setEditTitle("");
    setEditDueDate("");
    setEditNote("");
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
      const note = editNote.trim() ? editNote.trim() : null;

      const { error } = await supabase
        .from("tasks")
        .update({ title, due_at, note })
        .eq("id", taskId);

      if (error) throw error;

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, title, due_at, note } : t))
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
      setAssignmentDraft((prev) => {
        const copy = { ...prev };
        delete copy[taskId];
        return copy;
      });

      if (editTaskId === taskId) cancelEdit();

      setExpandedTaskId((prev) => (prev === taskId ? null : prev));
    } catch (e: any) {
      setErrorMsg(e.message || "Failed deleting task.");
    }
  }

  // Multi-assignment sync: insert missing + delete removed
  async function syncAssignees(taskId: string, nextIds: string[]) {
    setErrorMsg(null);

    if (!isAdmin) {
      setErrorMsg("Only admin can assign tasks.");
      return;
    }

    if (savingAssignments[taskId]) return;
    setSavingAssignments((prev) => ({ ...prev, [taskId]: true }));

    try {
      const currentAssignments = tasks.find((t) => t.id === taskId)?.task_assignments ?? [];
      const currentIds = currentAssignments.map((a) => a.assignee_id);

      const toAdd = nextIds.filter((id) => !currentIds.includes(id));
      const toRemove = currentIds.filter((id) => !nextIds.includes(id));

      if (toAdd.length) {
        const { error: addErr } = await supabase
          .from("task_assignments")
          .insert(
            toAdd.map((uid) => ({
              task_id: taskId,
              assignee_id: uid,
              status: "open",
            }))
          );
        if (addErr) throw addErr;
      }

      if (toRemove.length) {
        const { error: delErr } = await supabase
          .from("task_assignments")
          .delete()
          .eq("task_id", taskId)
          .in("assignee_id", toRemove);
        if (delErr) throw delErr;
      }

      await loadSessionAndTasks();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed assigning task.");
    } finally {
      setSavingAssignments((prev) => ({ ...prev, [taskId]: false }));
    }
  }

  function toggleAssignee(taskId: string, assigneeId: string, checked: boolean) {
    const current = assignmentDraft[taskId] ?? [];
    const next = checked
      ? Array.from(new Set([...current, assigneeId]))
      : current.filter((id) => id !== assigneeId);

    setAssignmentDraft((prev) => ({ ...prev, [taskId]: next }));
    void syncAssignees(taskId, next);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const assignableUsers = users.filter((u) => u.id !== userId);

  function toggleExpanded(taskId: string) {
    // Don't toggle collapse while editing another task
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
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
            {/* OPEN */}
            <section style={styles.column}>
              <div style={styles.colTitle}>Open</div>

              {openTasks.length === 0 ? (
                <div style={styles.empty}>No open tasks yet.</div>
              ) : (
                openTasks.map((t) => {
                  const assignees = (t.task_assignments ?? []).map((a) => a.assignee_id);
                  const isSaving = !!savingAssignments[t.id];
                  const draftIds = assignmentDraft[t.id] ?? assignees;

                  const isExpanded = expandedTaskId === t.id;

                  return (
                    <div
                      key={t.id}
                      style={{
                        ...styles.taskCard,
                        ...(isExpanded ? styles.taskCardExpanded : null),
                      }}
                      onClick={() => toggleExpanded(t.id)}
                    >
                      {/* ALWAYS VISIBLE (compact) */}
                      <div style={styles.taskTopRow}>
                        <div style={styles.taskTitle}>{t.title}</div>
                        <div style={styles.chev}>{isExpanded ? "▲" : "▼"}</div>
                      </div>

                      <div style={styles.taskMeta}>
                        <span style={styles.pill}>OPEN</span>
                        <span style={styles.metaText}>
                          Due: <b>{t.due_at ? formatDue(t.due_at) : "—"}</b>
                        </span>
                        {isSaving && <span style={styles.savingPill}>Saving…</span>}
                      </div>

                      <div style={styles.assigneePillsWrap}>
                        {assignees.length === 0 ? (
                          <span style={{ ...styles.assigneePill, opacity: 0.75 }}>No one</span>
                        ) : (
                          assignees.map((uid) => (
                            <span key={uid} style={styles.assigneePill}>
                              {displayUserName(uid)}
                            </span>
                          ))
                        )}
                      </div>

                      {/* EXPANDED CONTENT */}
                      {isExpanded && (
                        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                          {editTaskId === t.id ? (
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

                              <textarea
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                placeholder="Add a note for this task…"
                                style={styles.textarea}
                              />

                              <div style={styles.taskActions}>
                                <button
                                  style={styles.smallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveEdit(t.id);
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  style={styles.smallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEdit();
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  style={styles.smallDanger}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteTask(t.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {t.note ? (
                                <div style={{ ...styles.metaText, whiteSpace: "pre-wrap" }}>
                                  <span style={{ opacity: 0.8 }}>Note: </span>
                                  <b>{t.note}</b>
                                </div>
                              ) : null}

                              {isAdmin && (
                                <div style={{ marginTop: 10 }}>
                                  <div style={styles.assignBox}>
                                    {assignableUsers.length === 0 ? (
                                      <div style={styles.metaText}>No other users available.</div>
                                    ) : (
                                      assignableUsers.map((u) => {
                                        const label = u.full_name || u.email || u.id;
                                        const checked = draftIds.includes(u.id);

                                        return (
                                          <label key={u.id} style={styles.checkboxRow}>
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              disabled={isSaving}
                                              onChange={(e) =>
                                                toggleAssignee(t.id, u.id, e.currentTarget.checked)
                                              }
                                            />
                                            <span style={{ marginLeft: 10 }}>{label}</span>
                                          </label>
                                        );
                                      })
                                    )}
                                  </div>
                                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                                    Check one or more people to assign this task.
                                  </div>
                                </div>
                              )}

                              <div style={styles.taskActions}>
                                <button
                                  style={styles.smallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(t);
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  style={styles.smallBtn}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTaskStatus(t.id, "closed");
                                  }}
                                >
                                  Complete
                                </button>
                                <button
                                  style={styles.smallDanger}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteTask(t.id);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </section>

            {/* CLOSED */}
            <section style={styles.column}>
              <div style={styles.colTitle}>Closed</div>

              {closedTasks.length === 0 ? (
                <div style={styles.empty}>No closed tasks.</div>
              ) : (
                closedTasks.map((t) => {
                  const assignees = (t.task_assignments ?? []).map((a) => a.assignee_id);
                  const isExpanded = expandedTaskId === t.id;

                  return (
                    <div
                      key={t.id}
                      style={{
                        ...styles.taskCard,
                        ...(isExpanded ? styles.taskCardExpanded : null),
                        opacity: 0.95,
                      }}
                      onClick={() => toggleExpanded(t.id)}
                    >
                      {/* ALWAYS VISIBLE (compact) */}
                      <div style={styles.taskTopRow}>
                        <div style={styles.taskTitle}>{t.title}</div>
                        <div style={styles.chev}>{isExpanded ? "▲" : "▼"}</div>
                      </div>

                      <div style={styles.taskMeta}>
                        <span style={{ ...styles.pill, opacity: 0.75 }}>CLOSED</span>
                        <span style={styles.metaText}>
                          Due: <b>{t.due_at ? formatDue(t.due_at) : "—"}</b>
                        </span>
                      </div>

                      <div style={styles.assigneePillsWrap}>
                        {assignees.length === 0 ? (
                          <span style={{ ...styles.assigneePill, opacity: 0.75 }}>No one</span>
                        ) : (
                          assignees.map((uid) => (
                            <span key={uid} style={styles.assigneePill}>
                              {displayUserName(uid)}
                            </span>
                          ))
                        )}
                      </div>

                      {/* EXPANDED CONTENT */}
                      {isExpanded && (
                        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                          {t.note ? (
                            <div style={{ ...styles.metaText, whiteSpace: "pre-wrap" }}>
                              <span style={{ opacity: 0.8 }}>Note: </span>
                              <b>{t.note}</b>
                            </div>
                          ) : null}

                          <div style={styles.taskActions}>
                            <button
                              style={styles.smallBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                setTaskStatus(t.id, "open");
                              }}
                            >
                              Reopen
                            </button>
                            <button
                              style={styles.smallDanger}
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTask(t.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </section>
          </div>
        )}

        <div style={styles.footerNote}>
          UserId: <span style={{ opacity: 0.85 }}>{userId || "—"}</span> • Admin:{" "}
          <span style={{ opacity: 0.85 }}>{String(isAdmin)}</span> • Users loaded:{" "}
          <span style={{ opacity: 0.85 }}>{users.length}</span>
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

  textarea: {
    width: "100%",
    minHeight: 90,
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    outline: "none",
    resize: "vertical",
    fontFamily: "inherit",
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
    cursor: "pointer",
  },

  taskCardExpanded: {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.28)",
  },

  taskTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  chev: {
    fontSize: 12,
    opacity: 0.75,
    userSelect: "none",
    paddingLeft: 10,
  },

  taskTitle: { fontSize: 14, fontWeight: 700 },

  taskMeta: {
    marginTop: 8,
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },

  pill: {
    fontSize: 11,
    fontWeight: 800,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    letterSpacing: 0.6,
  },

  savingPill: {
    fontSize: 11,
    fontWeight: 800,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(59,130,246,0.18)",
    border: "1px solid rgba(59,130,246,0.28)",
    letterSpacing: 0.3,
    opacity: 0.95,
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

  // Checkbox UI
  assignBox: {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
    padding: 10,
    display: "grid",
    gap: 8,
    maxHeight: 170,
    overflow: "auto",
  },

  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    opacity: 0.95,
    cursor: "pointer",
    userSelect: "none",
  },

  // Pills
  assigneePillsWrap: {
    marginTop: 8,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },

  assigneePill: {
    fontSize: 11,
    fontWeight: 800,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.14)",
    letterSpacing: 0.2,
    opacity: 0.95,
  },
};
