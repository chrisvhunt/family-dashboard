import { useState, useEffect, useCallback, useMemo } from 'react';
import { googleBridge, BridgeTask, BridgeTaskList } from '../api/google-bridge';
import type { TaskmateUser } from '../types/taskmate';
import type { DashboardTodoItem } from './useDashboardTasks';

/** List ids from Google are prefixed so App can route check-offs to the bridge. */
export const GTASKS_PREFIX = 'gtasks:';

export function isGoogleTaskList(listId?: string): boolean {
  return !!listId && listId.startsWith(GTASKS_PREFIX);
}

const REFRESH_MS = 2 * 60 * 1000;

/**
 * Google Tasks via the Apps Script bridge, view only: open tasks plus anything
 * checked off today (shown struck through until tomorrow). Tasks are checked
 * off in the Google Tasks app, not on the dashboard.
 */
export function useGoogleTasks(enabled: boolean) {
  const [lists, setLists] = useState<BridgeTaskList[]>([]);
  const [tasks, setTasks] = useState<BridgeTask[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await googleBridge.tasks();
      setLists(data.lists);
      setTasks(data.tasks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Google Tasks');
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLists([]);
      setTasks([]);
      return;
    }
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  // Group by list only when there's more than one list with something in it.
  const groupByList = useMemo(() => new Set(tasks.map((t) => t.listId)).size > 1, [tasks]);

  const items: DashboardTodoItem[] = useMemo(
    () =>
      tasks.map((t) => ({
        uid: t.id,
        summary: t.title,
        status: t.status,
        listId: GTASKS_PREFIX + t.listId,
        userId: groupByList ? GTASKS_PREFIX + t.listId : undefined,
        due: t.due,
        readOnly: true,
      })),
    [tasks, groupByList],
  );

  /** Task lists shaped as "users" so the dashboard's grouped task view can label them. */
  const groups: TaskmateUser[] = useMemo(
    () =>
      groupByList
        ? lists
            .filter((l) => tasks.some((t) => t.listId === l.id))
            .map((l) => ({ childId: GTASKS_PREFIX + l.id, name: l.title, todoListId: GTASKS_PREFIX + l.id }))
        : [],
    [lists, tasks, groupByList],
  );

  return { items, groups, lists, error, refresh };
}
