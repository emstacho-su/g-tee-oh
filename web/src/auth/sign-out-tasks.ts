/**
 * Work that must reach the server before the session goes (S41, R3.16, R3.17, PR #41 review round
 * 1, finding 2). A screen that holds something open on the server, such as a running quiz or
 * painting session, registers a task while it is mounted; useLogout runs every registered task
 * before it posts the logout, because after the logout the cookie and the csrf token are gone and
 * the server would refuse the call.
 *
 * Mechanism: tasks are kept per api client (a WeakMap, so each app and each test has its own list)
 * as an immutable set replaced on every change. runSignOutTasks waits for all of them, at most
 * SIGN_OUT_TASKS_WAIT_MS, so a hung request never keeps the player signed in. A task reports its
 * own failures; one that rejects anyway is logged here with its status and problem slug only.
 */
import { describeFailureForLog } from "../api/http-status.js";
import type { AppApi } from "../api/index.js";

export type SignOutTask = () => Promise<void>;

/** The longest a sign-out waits for its tasks before it logs out anyway. */
export const SIGN_OUT_TASKS_WAIT_MS = 3_000;

const tasksByApi = new WeakMap<AppApi, ReadonlySet<SignOutTask>>();

/** Registers a task to run before the next sign-out; the returned function unregisters it. */
export function registerSignOutTask(api: AppApi, task: SignOutTask): () => void {
  tasksByApi.set(api, new Set([...(tasksByApi.get(api) ?? []), task]));
  return () => {
    const remaining = [...(tasksByApi.get(api) ?? [])].filter((entry) => entry !== task);
    tasksByApi.set(api, new Set(remaining));
  };
}

/** Runs every registered task, waiting at most SIGN_OUT_TASKS_WAIT_MS for them to settle. */
export async function runSignOutTasks(api: AppApi): Promise<void> {
  const tasks = [...(tasksByApi.get(api) ?? [])];
  if (tasks.length === 0) return;
  const all = Promise.allSettled(tasks.map((task) => task())).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.error(`g-tee-oh: a task before sign-out failed (${describeFailureForLog(result.reason)})`);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_TASKS_WAIT_MS);
  });
  await Promise.race([all, timeout]).finally(() => clearTimeout(timer));
}
