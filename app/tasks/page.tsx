// app/tasks/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import TaskClient from "./TasksClient";

export default function Page() {
  return <TaskClient />;
}
