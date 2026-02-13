"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";

const SHOW_CLOSED_KEY = "taskapp_showClosed"; // ✅ MUST be here

type DueFilter =
  | "__all__"
  | "today"
  | "late_today"
  | "late"
  | "no_due"
  | "not_due_yet";


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
  status: string | null; // "open" | "complete"
  completed_at: string | null;
  completion_note: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  note: string | null;
  status: string | null; // legacy / ignored for completion
  is_done: boolean; // legacy / ignored for completion
  due_at: string | null;
  category_id?: string | null;
  user_id: string;
  created_at: string | null;
  task_assignments: AssignmentRow[];
  category_name?: string | null;
};

type SessionShape = {
  ok: boolean;
  accessCodeId?: string;
  userId?: string;
  role?: string | null;
};

function toISOFromDateInput(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

function preserveDoneAssignments(prev: TaskRow[], next: TaskRow[]): TaskRow[] {
  if (!prev?.length) return next;

  const prevMap = new Map<string, Map<string, AssignmentRow>>();

  for (const t of prev) {
    const inner = new Map<string, AssignmentRow>();
    for (const a of t.task_assignments ?? []) {
      inner.set(a.assignee_id, a);
    }
    prevMap.set(t.id, inner);
  }

  return next.map((t) => {
    const prevAssignments = prevMap.get(t.id);
    if (!prevAssignments) return t;

    const mergedAssignments = (t.task_assignments ?? []).map((a) => {
      const pa = prevAssignments.get(a.assignee_id);
      if (!pa) return a;

      const prevWasDone = pa.status === "complete";
      const nextSaysDone = a.status === "complete";

      if (prevWasDone && !nextSaysDone) {
        return {
          ...a,
          status: "complete",
          completed_at: pa.completed_at ?? a.completed_at ?? new Date().toISOString(),
          completion_note: pa.completion_note ?? a.completion_note ?? null,
        };
      }

      return a;
    });

    return { ...t, task_assignments: mergedAssignments };
  });
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

// ✅ show task if due is null, today, or past; hide if due is future
function isDueVisible(due_at: string | null) {
  if (!due_at) return true;

  const due = new Date(due_at);
  const today = new Date();

  // compare by local calendar day (ignore time)
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  return due.getTime() <= today.getTime();
}

function dueBucket(due_at: string | null): DueFilter | "future" {
  if (!due_at) return "no_due";

  // ✅ Robust parsing:
  // If due_at is date-only (YYYY-MM-DD), treat it as LOCAL end-of-day
  // so it doesn’t become “late” immediately at midnight or shift by timezone.
  let due: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due_at)) {
    const [y, m, d] = due_at.split("-").map(Number);
    due = new Date(y, m - 1, d, 23, 59, 59, 999); // local end-of-day
  } else {
    due = new Date(due_at);
  }

  const now = new Date();

  // Compare by local calendar day (ignore time)
  const dueDay = new Date(due);
  const nowDay = new Date(now);
  dueDay.setHours(0, 0, 0, 0);
  nowDay.setHours(0, 0, 0, 0);

  if (dueDay.getTime() > nowDay.getTime()) return "future";

  // Same day: decide if it's still "today" or already "late_today"
  // Same day: ALWAYS treat as "today" (calendar-day meaning)
  if (dueDay.getTime() === nowDay.getTime()) {
    return "today";
  }


  // Past date
  return "late";
}


function matchesDueFilter(due_at: string | null, filter: DueFilter) {
  if (filter === "__all__") return true;

  const bucket = dueBucket(due_at);

  // ✅ Not Due Yet = future
  if (filter === "not_due_yet") return bucket === "future";

  // ✅ "Late Today" should show anything that's late (today OR past date)
  if (filter === "late_today") return bucket === "today" || bucket === "late";

  return bucket === filter;
}

function matchesCategory(t: TaskRow, categoryId: string) {
  if (categoryId === "__all__") return true;
  return (t.category_id ?? null) === categoryId;
}

function matchesSearch(t: TaskRow, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;

  const hay = [
    t.title ?? "",
    t.note ?? "",
    (t as any).category_name ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return hay.includes(needle);
}



export default function TasksClient() {
  console.log("TasksClient rendered ✅");
  const router = useRouter();

  // ✅ Custom confirm modal state (Yes/No)
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    message: string;
    onYes?: () => void;
  }>({ open: false, message: "" });

  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<ProfileRow[]>([]);


  const [userId, setUserId] = useState<string>("");
  const [accessCodeId, setAccessCodeId] = useState<string>("");

  const signedInId = userId || accessCodeId;
  const userEmail =
    users.find((u) => u.id === signedInId)?.email ?? "";

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [newCategoryId, setNewCategoryId] = useState<string>("");

  const [newAssigneeIds, setNewAssigneeIds] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const [adding, setAdding] = useState(false);
  const addLockRef = useRef(false);

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

  // Collapse/Expand: only one open at a time
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Admin/team view: expand/collapse users
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [actingAssigneeId, setActingAssigneeId] = useState<string | null>(null);

  const [showClosed, setShowClosed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false; // 👈 DEFAULT HIDDEN
    const raw = window.localStorage.getItem(SHOW_CLOSED_KEY);

    // If nothing saved yet → default to hidden
    return raw === "true";
  });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);


  const [adminUserFilterId, setAdminUserFilterId] = useState<string>("__all__");

  const [dueFilter, setDueFilter] = useState<DueFilter>("__all__");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [searchText, setSearchText] = useState<string>("");




  function toggleExpandedUser(uid: string) {
    setExpandedUserId((prev) => {
      const next = prev === uid ? null : uid;
      setActingAssigneeId(next && next !== "__unassigned__" ? next : null);
      return next;
    });
    setExpandedTaskId(null);
  }

  function displayUserName(uid: string) {
    const u = users.find((x) => x.id === uid);
    return u?.full_name || u?.email || uid;
  }

  function normalizeAssignments(raw: any): AssignmentRow[] {
    if (Array.isArray(raw)) return raw as AssignmentRow[];
    if (!raw) return [];
    return [raw as AssignmentRow];
  }

  // ---- Assignment helpers (per-user completion) ----
  function assignmentForTask(task: TaskRow, assigneeId: string) {
    return task.task_assignments?.find((a) => a.assignee_id === assigneeId) ?? null;
  }

  function isAssignmentDone(task: TaskRow, assigneeId: string) {
    return assignmentForTask(task, assigneeId)?.status === "complete";
  }

  function myAssignmentForTask(task: TaskRow) {
    const candidates = [userId, accessCodeId].filter(Boolean);
    if (candidates.length === 0) return null;
    return (task.task_assignments ?? []).find((a) => candidates.includes(a.assignee_id)) ?? null;
  }

  function targetAssigneeIdForTaskActions() {
    if (isAdmin) return actingAssigneeId;
    return userId || accessCodeId || null;
  }

  function assignmentForAssignee(task: TaskRow, assigneeId: string | null) {
    if (!assigneeId) return null;
    return assignmentForTask(task, assigneeId);
  }

  function isAssignmentDoneForAssignee(task: TaskRow, assigneeId: string | null) {
    return assignmentForAssignee(task, assigneeId)?.status === "complete";
  }

  const openTasks = useMemo(() => {
    if (!userId && !accessCodeId) return [];

    return tasks.filter((t) => {
      // 👇 NEW: hide other tasks when one is expanded
      if (expandedTaskId && t.id !== expandedTaskId) return false;
      // ✅ Category filter (user screen)
      if (categoryFilter !== "__all__" && t.category_id !== categoryFilter) return false;

      if (!matchesSearch(t, searchText)) return false;

      // ✅ Category filter
      if (categoryFilter !== "__all__" && t.category_id !== categoryFilter) {
        return false;
      }


      // ✅ Only hide future-dated tasks when a specific due filter is selected.
      // If "All (visible)" is selected, show everything (including future).
      if (dueFilter !== "__all__" && dueFilter !== "not_due_yet" && !isDueVisible(t.due_at)) return false;

      if (dueFilter === "today") {
        console.log("DUE DEBUG", t.id, t.title, t.due_at, "bucket=", dueBucket(t.due_at));
      }


      if (!matchesDueFilter(t.due_at, dueFilter)) return false;


      const mine = myAssignmentForTask(t);
      if (!mine) return false;

      return mine.status !== "complete";
    });
  }, [tasks, userId, accessCodeId, expandedTaskId, dueFilter, categoryFilter, searchText]);



  const adminFilterOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [
      { id: "__all__", label: "All team members" },
      { id: "__unassigned__", label: "Unassigned" },
    ];

    for (const u of users) {
      opts.push({
        id: u.id,
        label: u.full_name || u.email || u.id,
      });
    }

    const seen = new Set<string>();
    return opts.filter((o) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  }, [users]);

  const closedTasks = useMemo(() => {
    if (!userId && !accessCodeId) return [];
    return tasks.filter((t) => {
      if (!isDueVisible(t.due_at)) return false;
      if (!matchesDueFilter(t.due_at, dueFilter)) return false;
      // ✅ Category filter (user screen)
      if (categoryFilter !== "__all__" && t.category_id !== categoryFilter) return false;

      if (!matchesSearch(t, searchText)) return false;

      const mine = myAssignmentForTask(t);
      if (!mine) return false;
      return mine.status === "complete";
    });
  }, [tasks, userId, accessCodeId, dueFilter, categoryFilter, searchText]);


  const unassignedTasks = useMemo(() => {
    return tasks
      .filter((t) => {
        if ((t.task_assignments ?? []).length !== 0) return false;

        if (categoryFilter !== "__all__" && (t as any).category_id !== categoryFilter) return false;

        if (!matchesSearch(t, searchText)) return false;

        // ✅ apply the same due filter rules as the user screen
        if (dueFilter !== "__all__" && dueFilter !== "not_due_yet" && !isDueVisible(t.due_at)) return false;
        if (!matchesDueFilter(t.due_at, dueFilter)) return false;

        return true;
      })

      .sort((a, b) => {
        const aa = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bb - aa;
      });
  }, [tasks, dueFilter, categoryFilter, searchText]);


  const tasksByAssignee = useMemo(() => {
    const map = new Map<string, TaskRow[]>();

    for (const t of tasks) {
      // ✅ apply the same due filter rules as the user screen
      if (dueFilter !== "__all__" && dueFilter !== "not_due_yet" && !isDueVisible(t.due_at)) continue;
      if (!matchesDueFilter(t.due_at, dueFilter)) continue;
      if (categoryFilter !== "__all__" && (t as any).category_id !== categoryFilter) continue;
      if (!matchesSearch(t, searchText)) continue;


      if (dueFilter !== "__all__" && dueFilter !== "not_due_yet" && !isDueVisible(t.due_at)) continue;


      const assigneeIds = (t.task_assignments ?? []).map((a) => a.assignee_id);
      if (assigneeIds.length === 0) continue;

      for (const uid of assigneeIds) {
        if (!map.has(uid)) map.set(uid, []);
        map.get(uid)!.push(t);
      }
    }

    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const aa = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bb - aa;
      });
      map.set(k, Array.from(new Map(arr.map((t) => [t.id, t])).values()));
    }

    return map;
  }, [tasks, dueFilter, categoryFilter,searchText]);


  async function loadSessionAndTasks() {
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      void (async () => {
        try {
          const r = await fetch("/api/task-categories", { method: "GET", credentials: "include" });
          const j = await r.json().catch(() => ({ ok: false }));
          if (r.ok && j?.ok) setCategories(j.categories ?? []);
        } catch { }
      })();


      const sess: SessionShape = await res.json().catch(() => ({ ok: false }));

      if (!res.ok || !sess?.ok || !sess.accessCodeId) {
        setLoading(false);
        router.push("/login");
        return;
      }

      setAccessCodeId(sess.accessCodeId || "");
      setUserId(sess.userId ?? sess.accessCodeId ?? "");

      const admin = String(sess.role || "").toLowerCase() === "admin";
      setIsAdmin(admin);

      const tasksRes = await fetch("/api/tasks", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const tasksJson = await tasksRes.json().catch(() => ({ ok: false }));
      if (!tasksRes.ok || !tasksJson?.ok) {
        throw new Error(tasksJson?.error || "Failed to load tasks from /api/tasks");
      }

      const rawTasks = Array.isArray(tasksJson.tasks) ? tasksJson.tasks : [];
      console.log("FIRST TASK keys:", Object.keys(rawTasks?.[0] ?? {}));

      const catDebug = {
        category_id: rawTasks?.[0]?.category_id ?? null,
        task_category: rawTasks?.[0]?.task_category ?? null,
        category_name: rawTasks?.[0]?.category_name ?? null,
      };

      console.log("FIRST TASK category fields (raw):", catDebug);
      console.log("FIRST TASK category fields (json):", JSON.stringify(catDebug));




      const normalizedTaskRows: TaskRow[] = rawTasks.map((t: any) => ({
        ...t,
        note: t.note ?? null,
        due_at: t.due_at ?? null,
        task_assignments: normalizeAssignments(t.task_assignments),
      }));

      setTasks((prev) => {
        const merged = preserveDoneAssignments(prev, normalizedTaskRows);

        const draft: Record<string, string[]> = {};
        for (const t of merged) {
          draft[t.id] = (t.task_assignments ?? []).map((a) => a.assignee_id);
        }
        setAssignmentDraft(draft);

        return merged;
      });

      const r = await fetch("/api/users", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const j = await r.json().catch(() => ({ ok: false }));
      const loadedUsers = Array.isArray(j.users) ? (j.users as ProfileRow[]) : [];
      const signedInId = sess.userId ?? sess.accessCodeId ?? "";
      const email = loadedUsers.find((u) => u.id === signedInId)?.email ?? "";

      if (r.ok && j?.ok) setUsers(loadedUsers);
      else setUsers([]);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed loading tasks.");
      setTasks([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SHOW_CLOSED_KEY, String(showClosed));
  }, [showClosed]);

  useEffect(() => {
    loadSessionAndTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTask() {
    setErrorMsg(null);

    const title = newTitle.trim();
    if (!title) return;

    // ✅ Require at least one assignee
    if (newAssigneeIds.length === 0) {
      setErrorMsg("Please assign this task to at least one person.");
      return;
    }


    if (addLockRef.current) return;
    addLockRef.current = true;
    setAdding(true);

    try {
      const due_at = newDueDate ? toISOFromDateInput(newDueDate) : new Date().toISOString();
      const note = newNote.trim() ? newNote.trim() : null;

      const res = await fetch("/api/tasks", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title,
          due_at,
          note,
          assignee_ids: Array.from(new Set(newAssigneeIds)),
          category_id: newCategoryId || null,
        }),
      });

      const j = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Failed to add task via /api/tasks");
      }

      setNewTitle("");
      setNewNote("");
      setNewDueDate("");
      setNewAssigneeIds([]);
      setAssignOpen(false);
      setNoteOpen(false);

      await loadSessionAndTasks();
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to add task.");
    } finally {
      setAdding(false);
      addLockRef.current = false;
    }
  }

  async function setAssignmentStatusForUser(taskId: string, assigneeId: string, nextStatus: "open" | "complete") {
    setErrorMsg(null);

    const action = nextStatus === "complete" ? "complete" : "reopen";
    console.log("PATCH /api/task-assignments payload:", { action, taskId, assigneeId });

    try {
      const res = await fetch("/api/task-assignments", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action, taskId, assigneeId }),
      });

      const raw = await res.text();

      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch { }

      if (!res.ok || !j?.ok) {
        const msg = j?.error || j?.message || raw || `Failed to update assignment (${res.status})`;
        throw new Error(msg);
      }

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;

          const updated = (t.task_assignments ?? []).map((a) => {
            if (a.assignee_id !== assigneeId) return a;
            return {
              ...a,
              status: nextStatus,
              completed_at: nextStatus === "complete" ? new Date().toISOString() : null,
            };
          });

          return { ...t, task_assignments: updated };
        })
      );
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to update assignment.");
    }
  }

  function startEdit(t: TaskRow) {
    setEditTaskId(t.id);
    setEditTitle(t.title);
    setEditDueDate(t.due_at ? toDateInputFromISO(t.due_at) : "");
    setEditNote(t.note ?? "");
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

      const res = await fetch("/api/tasks", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ taskId, title, due_at, note }),
      });

      const raw = await res.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch { }

      if (!res.ok) {
        const msg = (j && (j.error || j.message)) || raw || `Failed saving edit (HTTP ${res.status})`;
        throw new Error(msg);
      }

      if (!j?.ok) {
        const msg = (j && (j.error || j.message)) || raw || "Failed saving edit.";
        throw new Error(msg);
      }

      await loadSessionAndTasks();
      cancelEdit();
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed saving edit.");
    }
  }

  async function deleteTask(taskId: string) {
    setErrorMsg(null);

    setConfirmState({
      open: true,
      message: "Are you sure you want to delete this task?",
      onYes: async () => {
        setErrorMsg(null);

        try {
          const res = await fetch(`/api/tasks?id=${encodeURIComponent(taskId)}`, {
            method: "DELETE",
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          });

          const j = await res.json().catch(() => ({ ok: false }));
          if (!res.ok || !j?.ok) {
            throw new Error(j?.error || "Failed deleting task via /api/tasks");
          }

          setTasks((prev) => prev.filter((t) => t.id !== taskId));
          setAssignmentDraft((prev) => {
            const copy = { ...prev };
            delete copy[taskId];
            return copy;
          });

          if (editTaskId === taskId) cancelEdit();
          setExpandedTaskId((prev) => (prev === taskId ? null : prev));
        } catch (e: any) {
          setErrorMsg(e?.message || "Failed deleting task.");
        }
      },
    });
  }


  async function syncAssignees(taskId: string, nextIds: string[]) {
    setErrorMsg(null);

    if (savingAssignments[taskId]) return;
    setSavingAssignments((prev) => ({ ...prev, [taskId]: true }));

    try {
      const res = await fetch("/api/task-assignments", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "sync",
          taskId,
          nextIds: Array.from(new Set(nextIds)),
        }),
      });

      const j = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || "Failed updating assignments");
      }

      await loadSessionAndTasks();
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed assigning task.");
    } finally {
      setSavingAssignments((prev) => ({ ...prev, [taskId]: false }));
    }
  }

  function toggleAssignee(taskId: string, assigneeId: string, checked: boolean) {
    const current = assignmentDraft[taskId] ?? [];
    const next = checked ? Array.from(new Set([...current, assigneeId])) : current.filter((id) => id !== assigneeId);

    setAssignmentDraft((prev) => ({ ...prev, [taskId]: next }));
    void syncAssignees(taskId, next);
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      router.push("/login");
    }
  }

  function labelForUser(u: ProfileRow) {
    const meId = userId || accessCodeId;
    return (u.full_name || u.email || u.id) + (meId && u.id === meId ? " (me)" : "");
  }

  const assignableUsers = useMemo(() => {
    const meId = userId || accessCodeId;
    if (!meId) return users;

    const me = users.find((u) => u.id === meId) || null;
    const list = me ? [me, ...users.filter((u) => u.id !== meId)] : users;

    const seen = new Set<string>();
    const deduped: ProfileRow[] = [];
    for (const u of list) {
      const key = (u.email || u.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(u);
    }
    return deduped;
  }, [users, userId, accessCodeId]);

  const newAssigneeSummary = useMemo(() => {
    if (!newAssigneeIds.length) return "Assign to…";

    const names = assignableUsers
      .filter((u) => newAssigneeIds.includes(u.id))
      .map((u) => u.full_name || u.email || u.id);

    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [newAssigneeIds, assignableUsers]);

  const newNoteSummary = useMemo(() => {
    const v = newNote.trim();
    if (!v) return "Note… (optional)";
    return v.length <= 28 ? v : `${v.slice(0, 28)}…`;
  }, [newNote]);

  useEffect(() => {
    if (!assignOpen) return;

    function onDocClick() {
      setAssignOpen(false);
    }

    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [assignOpen]);


  // NOTE dropdown should stay open until the user clicks "Done"
  // (No outside-click auto-close)


  function openCountForUser(uid: string, list: TaskRow[]) {
    return list.filter((t) => !isAssignmentDone(t, uid)).length;
  }

  function closedCountForUser(uid: string, list: TaskRow[]) {
    return list.filter((t) => isAssignmentDone(t, uid)).length;
  }

  function renderTaskCard(t: TaskRow) {


    const assignees = (t.task_assignments ?? []).map((a) => a.assignee_id);
    const isSaving = !!savingAssignments[t.id];
    const draftIds = assignmentDraft[t.id] ?? assignees;
    const isExpanded = expandedTaskId === t.id;

    const targetAssigneeId = targetAssigneeIdForTaskActions();
    const targetA = assignmentForAssignee(t, targetAssigneeId);
    const canComplete = !!targetAssigneeId && !!targetA;
    const isDoneForTarget = isAssignmentDoneForAssignee(t, targetAssigneeId);

    const myA = myAssignmentForTask(t);
    const myDone = myA?.status === "complete";
    const pillText = (isAdmin ? isDoneForTarget : myDone) ? "DONE" : "OPEN";


    return (
      <div
        key={t.id}
        style={{
          ...styles.taskCard,
          ...(hoveredTaskId === t.id ? styles.taskCardHover : null),
          ...(isExpanded ? styles.taskCardExpanded : null),
          opacity: (isAdmin ? isDoneForTarget : myDone) ? 0.92 : 1,
        }}
        onMouseEnter={() => setHoveredTaskId(t.id)}
        onMouseLeave={() => setHoveredTaskId(null)}
        onClick={() =>
          setExpandedTaskId((prev) => (prev === t.id ? null : t.id))
        }
      >

        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            borderTopLeftRadius: 14,
            borderBottomLeftRadius: 14,
            background: (isAdmin ? isDoneForTarget : myDone)
              ? "rgba(255,255,255,0.14)"
              : "rgba(59,130,246,0.35)",
          }}
        />
        <div style={styles.taskTopRow}>
          <div style={styles.taskTitle}>
            {t.title}
          </div>


          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                ...styles.pill,
                ...(pillText === "OPEN" ? styles.pillOpen : styles.pillDone),
                opacity: (isAdmin ? isDoneForTarget : myDone) ? 0.75 : 1,
              }}
            >
              {pillText}
            </span>

            {t.due_at && (
              <span style={{ ...styles.metaText, opacity: 0.9 }}>
                Due <b>{formatDue(t.due_at)}</b>
              </span>
            )}

            <div style={styles.chev}>{isExpanded ? "▲" : "▼"}</div>
          </div>

        </div>


        {t.category_name ? (
          <div style={{ ...styles.metaText, marginTop: 6, opacity: 0.9 }}>
            <span style={{ opacity: 0.8 }}>Category: </span>
            <b>{t.category_name}</b>
          </div>
        ) : null}


        {t.note && !isExpanded ? (
          <div
            style={{
              ...styles.metaText,
              marginTop: 6,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: 0.9,
            }}
            title={t.note}
          >
            {t.note}
          </div>
        ) : null}

        {isAdmin && !isExpanded ? (
          <div style={styles.assigneePillsWrap}>
            {assignees.length === 0 ? (
              <span style={{ ...styles.assigneePill, opacity: 0.75 }}>No one</span>
            ) : (
              assignees.map((uid) => {
                const done = isAssignmentDone(t, uid);
                return (
                  <span
                    key={uid}
                    style={{
                      ...styles.assigneePill,
                      ...(done ? styles.assigneePillDone : styles.assigneePillOpen),
                    }}
                    title={done ? "Done" : "Open"}
                  >
                    {displayUserName(uid)}
                  </span>
                );
              })
            )}
          </div>
        ) : null}

        {isExpanded && (
          <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
            {editTaskId === t.id ? (
              <div style={{ display: "grid", gap: 10 }}>
                <input style={styles.input} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />

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
                      void saveEdit(t.id);
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
                      void deleteTask(t.id);
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

                {/* Assignment editor */}
                <div style={{ marginTop: 10 }}>
                  <div style={styles.assignBox}>
                    {assignableUsers.length === 0 ? (
                      <div style={styles.metaText}>No users available.</div>
                    ) : (
                      assignableUsers.map((u) => {
                        const label = labelForUser(u);
                        const checked = draftIds.includes(u.id);

                        const a = assignmentForAssignee(t, u.id);
                        const statusText = !a ? "—" : a.status === "complete" ? "DONE" : "OPEN";

                        return (
                          <label key={u.id} style={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isSaving}
                              onChange={(e) => {
                                const nextChecked = e.currentTarget.checked;
                                const name = labelForUser(u);

                                // Admin: no confirm
                                if (isAdmin) {
                                  toggleAssignee(t.id, u.id, nextChecked);
                                  return;
                                }

                                // User: confirm with custom modal
                                setConfirmState({
                                  open: true,
                                  message: nextChecked
                                    ? `Are you sure you want to assign this task to ${name}?`
                                    : `Are you sure you want to unassign this task from ${name}?`,
                                  onYes: () => toggleAssignee(t.id, u.id, nextChecked),
                                });
                              }}
                            />

                            <span style={{ marginLeft: 10, flex: 1 }}>{label}</span>

                            {!isAdmin && (
                              <span
                                style={{
                                  fontSize: 12,
                                  padding: "3px 10px",
                                  borderRadius: 999,
                                  fontWeight: 600,
                                  background:
                                    statusText === "DONE"
                                      ? "rgba(34,197,94,0.25)"
                                      : statusText === "OPEN"
                                        ? "rgba(239,68,68,0.25)"
                                        : "rgba(255,255,255,0.12)",
                                  color:
                                    statusText === "DONE"
                                      ? "rgb(187,247,208)"
                                      : statusText === "OPEN"
                                        ? "rgb(254,202,202)"
                                        : "rgba(255,255,255,0.7)",
                                  borderWidth: 1, borderStyle: "solid", borderColor: "rgba(255,255,255,0.18)",

                                  minWidth: 60,
                                  textAlign: "center",
                                }}
                                title={statusText}
                              >
                                {statusText}
                              </span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                    Check one or more people to assign this task.
                  </div>
                </div>

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
                    style={{
                      ...styles.smallBtn,
                      opacity: canComplete ? 1 : 0.55,
                      cursor: canComplete ? "pointer" : "not-allowed",
                    }}
                    disabled={!canComplete}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!targetAssigneeId) return;
                      void setAssignmentStatusForUser(t.id, targetAssigneeId, isDoneForTarget ? "open" : "complete");
                    }}
                    title={
                      isAdmin ? (targetAssigneeId ? "" : "Expand a user bucket first") : "You are not assigned to this task"
                    }
                  >
                    {isDoneForTarget ? "Reopen" : "Complete"}
                  </button>

                  <button
                    style={styles.smallDanger}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteTask(t.id);
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
  }

  return (
    <div style={styles.page}>
      {/* ✅ Confirm modal (Yes/No) */}
      {confirmState.open && (
        <div style={styles.modalOverlay} onClick={() => setConfirmState({ open: false, message: "" })}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Confirm</div>
            <div style={styles.modalMsg}>{confirmState.message}</div>

            <div style={styles.modalActions}>
              <button style={styles.modalNo} onClick={() => setConfirmState({ open: false, message: "" })}>
                No
              </button>
              <button
                style={styles.modalYes}
                onClick={() => {
                  const fn = confirmState.onYes;
                  setConfirmState({ open: false, message: "" });
                  fn?.();
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

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

          <div style={styles.filterSection}>
            <div style={styles.sectionHeader}>
              <div style={styles.sectionLabel}>Filters</div>

              <button
                type="button"
                style={styles.sectionToggle}
                onClick={() => setFiltersOpen((v) => !v)}
                title={filtersOpen ? "Collapse filters" : "Expand filters"}
              >
                {filtersOpen ? "▲" : "▼"}
              </button>
            </div>

            {filtersOpen && (
              <div style={styles.row}>

                <button
                  style={styles.smallBtn}
                  onClick={() => setShowClosed((prev) => !prev)}
                >
                  {showClosed ? "Hide Closed" : "Show Closed"}
                </button>

                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search tasks…"
                  style={{ ...styles.input, maxWidth: 260, minWidth: 220 }}
                />


                <select
                  value={dueFilter}
                  onChange={(e) => setDueFilter(e.target.value as DueFilter)}
                  style={{
                    ...styles.input,
                    maxWidth: 200,
                    padding: "6px 10px",
                    backgroundColor: styles.page?.backgroundColor ?? "#111827",
                    color: "#e5e7eb",
                    border: "1px solid rgba(255,255,255,0.15)",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                  }}
                >
                  <option value="__all__">All (visible)</option>
                  <option value="today">Due Today</option>
                  <option value="not_due_yet">Not Due Yet</option>
                  <option value="late_today">Late & Today</option>
                  <option value="late">Late</option>
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{
                    ...styles.input,
                    maxWidth: 200,
                    padding: "6px 10px",
                    backgroundColor: styles.page?.backgroundColor ?? "#111827",
                    color: "#e5e7eb",
                    border: "1px solid rgba(255,255,255,0.15)",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                  }}
                >
                  <option value="__all__">All categories</option>

                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

              </div>


            )}
          </div>

          <div style={styles.rowDivider} />

          <div style={styles.addTaskSection}>
            <div style={styles.sectionHeader}>
              <div style={styles.sectionLabel}>Add New Task</div>

              <button
                type="button"
                style={styles.sectionToggle}
                onClick={() => setAddOpen((v) => !v)}
                title={addOpen ? "Collapse add task" : "Expand add task"}
              >
                {addOpen ? "▲" : "▼"}
              </button>
            </div>

            {addOpen && (
              <div style={styles.row}>
                <input
                  style={styles.input}
                  placeholder="Add a new task…"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!adding) addTask();
                    }
                  }}
                />

                <select
                  value={newCategoryId}
                  onChange={(e) => setNewCategoryId(e.target.value)}
                  style={{
                    ...styles.input,
                    maxWidth: 180,
                    padding: "6px 10px",
                    backgroundColor: "rgba(10, 15, 30, 0.85)", // 👈 blue/transparent
                    color: "#e5e7eb",
                    border: "1px solid rgba(255,255,255,0.15)",
                    appearance: "none",
                    WebkitAppearance: "none",
                    MozAppearance: "none",
                  }}

                  title="Category (optional)"
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>


                <div style={{ position: "relative", width: 300 }}>
                  <button
                    type="button"
                    style={styles.selectBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNoteOpen((v) => !v);
                    }}
                    title="Add a note (optional)"
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {newNoteSummary}
                    </span>
                    <span style={{ opacity: 0.8 }}>{noteOpen ? "▲" : "▼"}</span>
                  </button>

                  {noteOpen && (
                    <div style={styles.selectPopover} onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Type your task note…"
                        style={{ ...styles.textarea, minHeight: 140 }}
                        autoFocus
                      />

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                        <button type="button" style={styles.smallBtn} onClick={() => setNoteOpen(false)}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <input
                  style={styles.dateInput}
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  title="Due date (optional — if blank, defaults to now)"
                />

                <div style={{ position: "relative", width: 260 }}>
                  <button
                    type="button"
                    style={styles.selectBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAssignOpen((v) => !v);
                    }}
                    title="Assign to…"
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {newAssigneeSummary}
                    </span>
                    <span style={{ opacity: 0.8 }}>{assignOpen ? "▲" : "▼"}</span>
                  </button>

                  {assignOpen && (
                    <div
                      style={styles.selectPopover}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {assignableUsers.length === 0 ? (
                        <div style={styles.metaText}>No users available.</div>
                      ) : (
                        assignableUsers.map((u) => {
                          const checked = newAssigneeIds.includes(u.id);
                          const label = labelForUser(u);

                          return (
                            <label key={u.id} style={styles.checkboxRow}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.currentTarget.checked
                                    ? Array.from(new Set([...newAssigneeIds, u.id]))
                                    : newAssigneeIds.filter((id) => id !== u.id);
                                  setNewAssigneeIds(next);
                                }}
                              />
                              <span style={{ marginLeft: 10 }}>{label}</span>
                            </label>
                          );
                        })
                      )}

                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                        Assign at least one person.
                      </div>

                    </div>
                  )}
                </div>

                <button
                  style={{ ...styles.primaryBtn, opacity: newTitle.trim() && !adding ? 1 : 0.6 }}
                  disabled={!newTitle.trim() || adding}
                  onClick={addTask}
                >
                  {adding ? "Adding…" : "Add"}
                </button>
              </div>
            )}

          </div>

          {errorMsg && <div style={styles.error}>{errorMsg}</div>}
        </div>

        {loading ? (
          <div style={styles.muted}>Loading…</div>
        ) : isAdmin ? (
          <div style={styles.column}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={styles.colTitle}>Team</div>

              <select
                value={adminUserFilterId}
                onChange={(e) => {
                  const next = e.target.value;
                  setAdminUserFilterId(next);

                  setExpandedUserId(null);
                  setActingAssigneeId(null);
                  setExpandedTaskId(null);
                }}
                style={styles.selectNative}
                title="Filter to one team member"
              >
                {adminFilterOptions.map((opt) => (
                  <option key={opt.id} value={opt.id} style={styles.selectOption}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {users.length === 0 ? (
              <div style={styles.empty}>No users found.</div>
            ) : (
              <>
                {(adminUserFilterId === "__all__" || adminUserFilterId === "__unassigned__") && (
                  <>
                    {/* UNASSIGNED */}
                    <div
                      style={{
                        ...styles.taskCard,
                        ...(expandedUserId === "__unassigned__" ? styles.taskCardExpanded : null),
                        cursor: "pointer",
                      }}
                      onClick={() => toggleExpandedUser("__unassigned__")}
                    >
                      <div style={styles.taskTopRow}>
                        <div style={{ display: "grid", gap: 2 }}>
                          <div style={styles.taskTitle}>Unassigned</div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>
                            Total: <b>{unassignedTasks.length}</b>
                          </div>
                        </div>
                        <div style={styles.chev}>{expandedUserId === "__unassigned__" ? "▲" : "▼"}</div>
                      </div>

                      {expandedUserId === "__unassigned__" && (
                        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                          {unassignedTasks.length === 0 ? (
                            <div style={styles.empty}>No unassigned tasks.</div>
                          ) : (
                            <>{unassignedTasks.map(renderTaskCard)}</>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* USERS */}
                {users
                  .filter((u) => adminUserFilterId === "__all__" || adminUserFilterId === u.id)
                  .map((u) => {
                    const uid = u.id;
                    const userTasks = tasksByAssignee.get(uid) ?? [];
                    const openCount = openCountForUser(uid, userTasks);
                    const doneCount = closedCountForUser(uid, userTasks);
                    const isUserExpanded = expandedUserId === uid;
                    const onlyExpanded = (t: TaskRow) => !expandedTaskId || t.id === expandedTaskId;


                    return (
                      <div
                        key={uid}
                        style={{
                          ...styles.taskCard,
                          ...(isUserExpanded ? styles.taskCardExpanded : null),
                          cursor: "pointer",
                        }}
                        onClick={() => toggleExpandedUser(uid)}
                      >
                        <div style={styles.taskTopRow}>
                          <div style={{ display: "grid", gap: 2 }}>
                            <div style={styles.taskTitle}>{u.full_name || u.email || uid}</div>
                            <div style={{ fontSize: 12, opacity: 0.85 }}>
                              Open: <b>{openCount}</b> • Done: <b>{doneCount}</b>
                            </div>
                          </div>
                          <div style={styles.chev}>{isUserExpanded ? "▲" : "▼"}</div>
                        </div>

                        {isUserExpanded && (
                          <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                            {userTasks.length === 0 ? (
                              <div style={styles.empty}>No tasks for this user.</div>
                            ) : (
                              <>
                                {userTasks
                                  .filter(onlyExpanded)
                                  .filter((t) => !isAssignmentDone(t, uid))
                                  .map(renderTaskCard)}

                                {showClosed &&
                                  userTasks
                                    .filter(onlyExpanded)
                                    .filter((t) => isAssignmentDone(t, uid))
                                    .map(renderTaskCard)}

                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              ...styles.grid,
              gridTemplateColumns: showClosed ? "1fr 1fr" : "1fr",
            }}
          >
            <section style={styles.column}>
              <div style={styles.colTitle}>Open</div>
              {openTasks.length === 0 ? <div style={styles.empty}>No open tasks yet.</div> : <>{openTasks.map(renderTaskCard)}</>}
            </section>

            {showClosed && (
              <section style={styles.column}>
                <div style={styles.colTitle}>Done</div>
                {closedTasks.length === 0 ? <div style={styles.empty}>No done tasks yet.</div> : <>{closedTasks.map(renderTaskCard)}</>}
              </section>
            )}
          </div>
        )}

        <div style={styles.footerNote}>
          UserId: <span style={{ opacity: 0.85 }}>{userId || "—"}</span> • AccessCodeId:{" "}
          <span style={{ opacity: 0.85 }}>{accessCodeId || "—"}</span> • Admin:{" "}
          <span style={{ opacity: 0.85 }}>{String(isAdmin)}</span> • Users loaded:{" "}
          <span style={{ opacity: 0.85 }}>{users.length}</span>
        </div>
      </div>
    </div >
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
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" },
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
    border: "1px solid rgba(255,255,255,0.35)",
    background: "rgba(255,255,255,0.10)",
    color: "#ffffff",
    outline: "none",
    fontWeight: 600,
    colorScheme: "dark",
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
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  column: {
    borderRadius: 16,
    padding: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  colTitle: { fontSize: 14, fontWeight: 800, opacity: 0.9, marginBottom: 10 },

  taskCard: {
    position: "relative",
    borderRadius: 14,
    padding: "12px 12px 12px 16px",
    background: "rgba(0,0,0,0.22)",

    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(255,255,255,0.16)",

    boxShadow: "0 8px 18px rgba(0,0,0,0.35)",
    marginBottom: 14,
    cursor: "pointer",
  },


  taskCardHover: {
    background: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.35)",
  },
  taskCardExpanded: {
    borderWidth: 1, borderStyle: "solid", borderColor: "rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.06)",
    boxShadow: "0 12px 26px rgba(0,0,0,0.45)",
  },
  taskTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  chev: { fontSize: 12, opacity: 0.75, userSelect: "none", paddingLeft: 10 },
  taskTitle: { fontSize: 14, fontWeight: 700 },
  taskMeta: { marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  pill: {
    fontSize: 11,
    fontWeight: 800,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",

    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(255,255,255,0.14)",

    letterSpacing: 0.6,
  },

  pillOpen: {
    background: "rgba(239,68,68,0.30)",
    borderColor: "rgba(239,68,68,0.65)",
    color: "rgb(254,202,202)",
  },

  pillDone: {
    background: "rgba(34,197,94,0.22)",
    borderColor: "rgba(34,197,94,0.55)",
    color: "rgb(187,247,208)",
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
  assigneePillsWrap: { marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  assigneePill: {
    fontSize: 11,
    fontWeight: 800,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",

    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(255,255,255,0.14)",

    letterSpacing: 0.2,
    opacity: 0.95,
  },

  assigneePillOpen: {
    background: "rgba(239,68,68,0.30)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(239,68,68,0.65)",
  },


  assigneePillDone: {
    background: "rgba(34,197,94,0.22)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "rgba(34,197,94,0.55)",
  },


  selectBtn: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.25)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 650,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    textAlign: "left",
  },
  selectNative: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    backgroundColor: "rgba(10, 15, 30, 0.98)",
    color: "#e5e7eb",
    outline: "none",
    fontWeight: 650,
    cursor: "pointer",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  },
  selectOption: {
    backgroundColor: "rgba(10, 15, 30, 0.98)",
    color: "#e5e7eb",
  },
  selectPopover: {
    position: "absolute",
    top: "calc(100% + 8px)",
    left: 0,
    right: 0,
    zIndex: 50,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(10, 15, 30, 0.98)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
    padding: 10,
    display: "grid",
    gap: 8,
    maxHeight: 220,
    overflow: "auto",
    backdropFilter: "blur(8px)",
  },

  // ✅ Confirm modal styles
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "grid",
    placeItems: "center",
    zIndex: 9999,
    padding: 16,
  },
  modalCard: {
    width: "min(520px, 100%)",
    borderRadius: 16,
    padding: 16,
    background: "rgba(10, 15, 30, 0.98)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 18px 50px rgba(0,0,0,0.60)",
  },

  rowDivider: {
    height: 4,
    width: "100%",
    margin: "22px 0",
    borderRadius: 999,
    background: "linear-gradient(to right, rgba(255,255,255,0.05), rgba(255,255,255,0.35), rgba(255,255,255,0.05))",
  },


  addTaskSection: {
    padding: 12,
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.045)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
  },

  filterSection: {
    padding: "8px 12px",
    backgroundColor: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    marginBottom: 8,
  },


  sectionLabel: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.65)",
    marginBottom: 6,
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10, // ✅ creates space so the toggle isn't jammed into the row below
  },

  sectionToggle: {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#e5e7eb",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
    lineHeight: 1,
    userSelect: "none",
  },



  modalTitle: { fontSize: 14, fontWeight: 900, letterSpacing: 0.2 },
  modalMsg: { marginTop: 10, fontSize: 13, opacity: 0.9, lineHeight: 1.35 },
  modalActions: { marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 10 },
  modalNo: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 800,
  },
  modalYes: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(34,197,94,0.25)",
    background: "rgba(34,197,94,0.16)",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
  },
};
