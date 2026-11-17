import { DashboardCardProps, TodoItem } from '../../types/dashboard-cards';
import { TaskChecklist } from '../TaskChecklist';
import { MEMBER_COLORS } from '../../types/family';
import type { TaskmateUser } from '../../types/taskmate';
import { useTranslation } from '../../i18n';

/** Sidebar "Tasks" section — HA todo items (optionally grouped by TaskMate user), or chores checklist fallback. */
export function TasksCard({ context }: DashboardCardProps) {
  const { t } = useTranslation();
  const { todoItems, onToggleTodo, taskmateUsers, filteredChores, completedChoreIds, onToggleChore, members } = context;

  return (
    <section className="dash-sidebar-section">
      <h3 className="dash-sidebar-heading">{t('dashboard.tasks')}</h3>
      {todoItems.length > 0 ? (
        <TaskGroups items={todoItems} users={taskmateUsers} onToggleTodo={onToggleTodo} />
      ) : (
        <TaskChecklist
          chores={filteredChores}
          completedIds={completedChoreIds}
          onToggle={onToggleChore}
          members={members}
        />
      )}
    </section>
  );
}

function TaskRow({
  item,
  onToggleTodo,
}: {
  item: TodoItem;
  onToggleTodo?: (uid: string, currentStatus: string, listId?: string) => void;
}) {
  const { t } = useTranslation();
  const done = item.status === 'completed';
  if (item.readOnly) {
    // View-only source (Google Tasks): a marker instead of a tappable checkbox.
    return (
      <li className={`task-checklist-item task-checklist-item--readonly${done ? ' task-checklist-item--done' : ''}`}>
        <span className={`task-readonly-mark${done ? ' task-readonly-mark--done' : ''}`} aria-hidden="true">
          {done ? '✓' : ''}
        </span>
        <span className={`task-checklist-label${done ? ' task-checklist-label--done' : ''}`}>{item.summary}</span>
        {!done && item.due && <DueBadge due={item.due} />}
      </li>
    );
  }
  return (
    <li className={`task-checklist-item${done ? ' task-checklist-item--done' : ''}`}>
      <button
        type="button"
        className={`task-checkbox${done ? ' task-checkbox--checked' : ''}`}
        disabled={done}
        onClick={() => onToggleTodo?.(item.uid, item.status, item.listId)}
        aria-label={done ? t('dashboard.completedItem', { name: item.summary }) : t('dashboard.completeItem', { name: item.summary })}
      >
        <span className="task-checkbox-box">
          {done && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </button>
      <span className={`task-checklist-label${done ? ' task-checklist-label--done' : ''}`}>{item.summary}</span>
      {!done && item.due && <DueBadge due={item.due} />}
    </li>
  );
}

/** Whole days from today to a yyyy-MM-dd due date (negative = overdue). */
export function daysUntil(due: string, now = new Date()): number {
  const [y, m, d] = due.split('-').map(Number);
  const dueDay = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((dueDay - today) / 86_400_000);
}

function DueBadge({ due }: { due: string }) {
  const days = daysUntil(due);
  if (Number.isNaN(days)) return null;
  let label: string;
  let tone: 'overdue' | 'today' | 'soon' | 'later';
  if (days < 0) {
    label = 'Overdue';
    tone = 'overdue';
  } else if (days === 0) {
    label = 'Today';
    tone = 'today';
  } else if (days === 1) {
    label = 'Tomorrow';
    tone = 'soon';
  } else if (days < 7) {
    const [y, m, d] = due.split('-').map(Number);
    label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
    tone = 'soon';
  } else {
    const [y, m, d] = due.split('-').map(Number);
    label = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    tone = 'later';
  }
  return <span className={`task-due task-due--${tone}`}>{label}</span>;
}

/** Open items first (overdue → today → soonest → no date), finished items last. */
function compareTasks(a: TodoItem, b: TodoItem): number {
  const doneA = a.status === 'completed' ? 1 : 0;
  const doneB = b.status === 'completed' ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  const dueA = a.due ?? '9999-99-99';
  const dueB = b.due ?? '9999-99-99';
  return dueA.localeCompare(dueB);
}

interface TaskGroup {
  key: string;
  label: string;
  color?: string;
  items: TodoItem[];
}

export function TaskGroups({
  items,
  users,
  onToggleTodo,
}: {
  items: TodoItem[];
  users: TaskmateUser[];
  onToggleTodo?: (uid: string, currentStatus: string, listId?: string) => void;
}) {
  const { t } = useTranslation();
  const sorted = [...items].sort(compareTasks);

  if (users.length === 0) {
    return (
      <ul className="task-checklist">
        {sorted.map((item) => (
          <TaskRow key={`${item.listId ?? 'local'}:${item.uid}`} item={item} onToggleTodo={onToggleTodo} />
        ))}
      </ul>
    );
  }

  const groups: TaskGroup[] = users.map(
    (u, i) => ({ key: u.childId, label: u.name, color: MEMBER_COLORS[i % MEMBER_COLORS.length], items: [] }),
  );
  const shared: TaskGroup = { key: '__shared', label: t('dashboard.shared'), items: [] };

  for (const item of sorted) {
    const bucket = item.userId ? groups.find((g) => g.key === item.userId) : undefined;
    (bucket ?? shared).items.push(item);
  }

  const visible = [
    ...groups.filter((g) => g.items.length > 0),
    ...(shared.items.length > 0 ? [shared] : []),
  ];

  return (
    <div className="task-groups">
      {visible.map((group) => (
        <div key={group.key} className="task-group">
          <div className="task-group-header">
            <span
              className="task-group-avatar"
              style={group.color ? { backgroundColor: group.color + '22', borderColor: group.color } : undefined}
            >
              {group.label.charAt(0).toUpperCase()}
            </span>
            <span className="task-group-name" style={group.color ? { color: group.color } : undefined}>
              {group.label}
            </span>
          </div>
          <ul className="task-checklist">
            {group.items.map((item) => (
              <TaskRow key={`${item.listId ?? 'local'}:${item.uid}`} item={item} onToggleTodo={onToggleTodo} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
