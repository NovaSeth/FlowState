import { Progress, StatusCounts, TaskStatus, TASK_STATUSES } from "./types";

export function emptyStatusCounts(): StatusCounts {
  return { todo: 0, in_progress: 0, blocked: 0, done: 0, closed: 0 };
}

/** Builds a full set of status counts from GROUP BY rows (zeros for missing ones). */
export function statusCountsFromRows(
  rows: { status: string; n: number }[],
): StatusCounts {
  const counts = emptyStatusCounts();
  for (const row of rows) {
    if ((TASK_STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as TaskStatus] = Number(row.n);
    }
  }
  return counts;
}

/** Progress = done / total. "closed" is out of scope - it does NOT count toward
 *  total (closing a task reduces the task count), so it neither inflates nor
 *  deflates progress. percent is an integer 0-100 (0 when there are no tasks). */
export function progressFromCounts(counts: StatusCounts): Progress {
  const total =
    counts.todo + counts.in_progress + counts.blocked + counts.done;
  const done = counts.done;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, percent };
}
