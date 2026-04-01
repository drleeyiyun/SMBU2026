import { useCallback, useEffect, useState } from "react";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { useSession } from "../state/session";

type TaskRow = {
  assignment: {
    id: string;
    status: string;
    updatedAt: string;
  };
  task: {
    id: string;
    title: string;
    description: string | null;
    startsAt: string | null;
    endsAt: string | null;
  };
  involvedOrgIds: string[];
};

export default function OaPage() {
  const { user } = useSession();
  const isLeagueAdmin = user?.roles.includes("league_admin") ?? false;
  const [tab, setTab] = useState<"mine" | "overview">("mine");

  const [mine, setMine] = useState<TaskRow[]>([]);
  const [overview, setOverview] = useState<TaskRow[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMine = useCallback(async () => {
    const res = await apiFetch("/tasks/mine");
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ items: TaskRow[] }>(res);
    setMine(body.items);
  }, []);

  const loadOverview = useCallback(async () => {
    const res = await apiFetch("/league/tasks-overview");
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ items: TaskRow[]; byStatus: Record<string, number> }>(res);
    setOverview(body.items);
    setByStatus(body.byStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (tab === "mine") {
          await loadMine();
        } else if (isLeagueAdmin) {
          await loadOverview();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, isLeagueAdmin, loadMine, loadOverview]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={
            tab === "mine"
              ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          }
        >
          My tasks
        </button>
        {isLeagueAdmin ? (
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={
              tab === "overview"
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            }
          >
            League overview
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : tab === "overview" && byStatus ? (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-sm text-muted-foreground">
            GET /league/tasks-overview — counts by assignment status
          </p>
          <ul className="mb-4 flex flex-wrap gap-3 text-sm">
            {Object.entries(byStatus).map(([k, v]) => (
              <li key={k}>
                <span className="font-medium">{k}</span>: {v}
              </li>
            ))}
          </ul>
          <TaskList items={overview} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <p className="mb-3 text-sm text-muted-foreground">GET /tasks/mine</p>
          <TaskList items={mine} />
        </div>
      )}
    </div>
  );
}

function TaskList({ items }: { items: TaskRow[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((row) => (
        <li key={row.assignment.id} className="py-3 text-sm">
          <div className="font-medium">{row.task.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5">{row.assignment.status}</span>
            {row.task.startsAt ? ` · ${row.task.startsAt}` : null}
          </div>
          {row.task.description ? (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.task.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
