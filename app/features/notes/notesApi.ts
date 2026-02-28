import { TaskNote } from "./types";

async function handle<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Request failed");
  }
  return json;
}

export async function fetchTaskNotes(taskId: string): Promise<TaskNote[]> {
  const res = await fetch(`/api/task-notes?taskId=${taskId}`, {
    credentials: "include",
  });

  const data = await handle<{ ok: true; notes: TaskNote[] }>(res);
  return data.notes;
}

export async function createTaskNote(
  taskId: string,
  note: string
): Promise<TaskNote> {
  const res = await fetch(`/api/task-notes`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, note }),
  });

  const data = await handle<{ ok: true; note: TaskNote }>(res);
  return data.note;
}