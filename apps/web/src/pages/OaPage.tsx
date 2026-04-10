import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiBase, apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";
import { useSession } from "../state/session";

type TaskRow = {
  assignment: {
    id: string;
    taskId?: string;
    status: string;
    updatedAt: string;
  };
  task: {
    id: string;
    title: string;
    description: string | null;
    kind?: string;
    startsAt: string | null;
    endsAt: string | null;
    createdAt?: string;
  };
  involvedOrgIds: string[];
  primaryOrgNameShort?: string;
};

type OrgListItem = { id: string; nameShort: string };

type TimelineEvent =
  | {
      type: "status";
      id: string;
      at: string;
      fromStatus: string | null;
      toStatus: string;
      assignmentId: string | null;
      actorUserId: string | null;
    }
  | {
      type: "handoff";
      id: string;
      at: string;
      fromUserId: string | null;
      toUserId: string | null;
      note: string | null;
    };

const STATUS_ORDER = ["unread", "read", "in_progress", "done"] as const;

function nextStatus(current: string): string | null {
  const i = STATUS_ORDER.indexOf(current as (typeof STATUS_ORDER)[number]);
  if (i < 0 || i >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[i + 1]!;
}

export default function OaPage() {
  const { t } = useTranslation();
  const { user } = useSession();
  const isLeagueAdmin = user?.roles.includes("league_admin") ?? false;
  const [tab, setTab] = useState<"mine" | "overview">("mine");

  const [mine, setMine] = useState<TaskRow[]>([]);
  const [overview, setOverview] = useState<TaskRow[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number> | null>(null);
  const [byKind, setByKind] = useState<Record<string, number> | null>(null);
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [filterOrgId, setFilterOrgId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timelines, setTimelines] = useState<Record<string, TimelineEvent[]>>({});
  const [loadingTimeline, setLoadingTimeline] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMode, setLiveMode] = useState<"sse" | "poll">("sse");

  const debounceRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadMine = useCallback(async () => {
    const res = await apiFetch("/tasks/mine");
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ items: TaskRow[] }>(res);
    setMine(body.items);
    setError(null);
  }, []);

  const loadOverview = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterOrgId) params.set("orgId", filterOrgId);
    if (filterStatus) params.set("status", filterStatus);
    if (filterKind) params.set("kind", filterKind);
    if (filterQ.trim()) params.set("q", filterQ.trim());
    if (filterFrom) params.set("from", new Date(filterFrom).toISOString());
    if (filterTo) params.set("to", new Date(filterTo).toISOString());
    const qs = params.toString();
    const res = await apiFetch(`/league/tasks-overview${qs ? `?${qs}` : ""}`);
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{
      items: TaskRow[];
      byStatus: Record<string, number>;
      byKind: Record<string, number>;
    }>(res);
    setOverview(body.items);
    setByStatus(body.byStatus);
    setByKind(body.byKind ?? null);
    setError(null);
  }, [filterOrgId, filterStatus, filterKind, filterQ, filterFrom, filterTo]);

  const loadLeagueOrgs = useCallback(async () => {
    const res = await apiFetch("/league/orgs");
    if (!res.ok) return;
    const body = await readJson<{ organizations: OrgListItem[] }>(res);
    setOrgs(body.organizations);
  }, []);

  const scheduleReload = useCallback(() => {
    if (debounceRef.current != null) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void (async () => {
        if (tab === "mine") await loadMine();
        else if (isLeagueAdmin) await loadOverview();
      })();
    }, 300);
  }, [tab, isLeagueAdmin, loadMine, loadOverview]);

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

  useEffect(() => {
    if (isLeagueAdmin) void loadLeagueOrgs();
  }, [isLeagueAdmin, loadLeagueOrgs]);

  useEffect(() => {
    const base = apiBase();
    const url = `${base}/notifications/stream`;

    const startPoll = () => {
      if (pollRef.current != null) return;
      setLiveMode("poll");
      pollRef.current = window.setInterval(() => {
        scheduleReload();
      }, 10_000);
    };

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("org_task", () => {
      scheduleReload();
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      startPoll();
    };

    es.onopen = () => {
      setLiveMode("sse");
    };

    return () => {
      es.close();
      esRef.current = null;
      if (pollRef.current != null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [scheduleReload]);

  const loadTimeline = async (taskId: string) => {
    setLoadingTimeline(taskId);
    try {
      const res = await apiFetch(`/tasks/${taskId}/timeline`);
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      const body = await readJson<{ events: TimelineEvent[] }>(res);
      setTimelines((prev) => ({ ...prev, [taskId]: body.events }));
    } finally {
      setLoadingTimeline(null);
    }
  };

  const toggleExpand = (taskId: string) => {
    if (expandedId === taskId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(taskId);
    if (!timelines[taskId]) void loadTimeline(taskId);
  };

  const advanceAssignment = async (assignmentId: string, taskId: string, status: string) => {
    const next = nextStatus(status);
    if (!next) return;
    const res = await apiFetch(`/tasks/assignments/${assignmentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    scheduleReload();
    if (timelines[taskId]) void loadTimeline(taskId);
  };

  const items = tab === "mine" ? mine : overview;
  const statusLabel = (s: string) => t(`oa.status.${s}`, { defaultValue: s });

  const kindLabel = (k: string) => t(`oa.taskKind.${k}`, { defaultValue: k });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={
              tab === "mine"
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            }
          >
            {t("oa.tabs.mine")}
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
              {t("oa.tabs.league")}
            </button>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {liveMode === "sse" ? t("oa.liveSse") : t("oa.livePoll")}
        </span>
      </div>

      {tab === "overview" && isLeagueAdmin ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("oa.filters.org")}</span>
              <select
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={filterOrgId}
                onChange={(e) => setFilterOrgId(e.target.value)}
              >
                <option value="">{t("oa.filters.orgAll")}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nameShort}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("oa.filters.status")}</span>
              <select
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">{t("oa.filters.statusAll")}</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("oa.filters.kind")}</span>
              <select
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={filterKind}
                onChange={(e) => setFilterKind(e.target.value)}
              >
                <option value="">{t("oa.filters.kindAll")}</option>
                {(["single", "cross", "transfer"] as const).map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("oa.filters.query")}</span>
              <input
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("oa.filters.from")}</span>
              <input
                type="datetime-local"
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{t("oa.filters.to")}</span>
              <input
                type="datetime-local"
                className="rounded border border-input bg-background px-2 py-1.5 text-sm"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="self-start rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            onClick={() => void loadOverview()}
          >
            {t("oa.filters.apply")}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground">{t("oa.loading")}</p>
      ) : tab === "overview" && byStatus && byKind ? (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">{t("oa.stats.byStatus")}</p>
              <ul className="flex flex-wrap gap-3 text-sm">
                {Object.entries(byStatus).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{statusLabel(k)}</span>: {v}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t("oa.stats.byKind")}</p>
              <ul className="flex flex-wrap gap-3 text-sm">
                {Object.entries(byKind).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{kindLabel(k)}</span>: {v}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <TaskList
            items={items}
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
            timelines={timelines}
            loadingTimeline={loadingTimeline}
            onAdvance={advanceAssignment}
            t={t}
            statusLabel={statusLabel}
            kindLabel={kindLabel}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <TaskList
            items={items}
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
            timelines={timelines}
            loadingTimeline={loadingTimeline}
            onAdvance={advanceAssignment}
            t={t}
            statusLabel={statusLabel}
            kindLabel={kindLabel}
          />
        </div>
      )}
    </div>
  );
}

function TaskList(props: {
  items: TaskRow[];
  expandedId: string | null;
  onToggleExpand: (taskId: string) => void;
  timelines: Record<string, TimelineEvent[]>;
  loadingTimeline: string | null;
  onAdvance: (assignmentId: string, taskId: string, status: string) => void;
  t: (key: string, opts?: { defaultValue?: string }) => string;
  statusLabel: (s: string) => string;
  kindLabel: (k: string) => string;
}) {
  const {
    items,
    expandedId,
    onToggleExpand,
    timelines,
    loadingTimeline,
    onAdvance,
    t,
    statusLabel,
    kindLabel,
  } = props;

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("oa.empty")}</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((row) => (
        <li key={row.assignment.id} className="py-3 text-sm">
          <div className="font-medium">{row.task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5">{statusLabel(row.assignment.status)}</span>
            {row.task.kind ? (
              <span className="rounded bg-muted px-2 py-0.5">{kindLabel(row.task.kind)}</span>
            ) : null}
            {row.primaryOrgNameShort ? (
              <span>
                {t("oa.primaryOrg")}: {row.primaryOrgNameShort}
              </span>
            ) : null}
            {row.task.startsAt ? ` · ${formatDisplayDateTime(row.task.startsAt)}` : null}
          </div>
          {row.involvedOrgIds.length > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("oa.involved")}: {row.involvedOrgIds.length}
            </div>
          ) : null}
          {row.task.description ? (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{row.task.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
              onClick={() => onToggleExpand(row.task.id)}
            >
              {expandedId === row.task.id ? t("oa.collapse") : t("oa.expand")}
            </button>
            {nextStatus(row.assignment.status) ? (
              <button
                type="button"
                className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                onClick={() => onAdvance(row.assignment.id, row.task.id, row.assignment.status)}
              >
                {t("oa.advanceStatus")}
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">{t("oa.doneStatus")}</span>
            )}
          </div>
          {expandedId === row.task.id ? (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">{t("oa.timeline")}</p>
              {loadingTimeline === row.task.id ? (
                <p className="text-xs text-muted-foreground">{t("oa.loading")}</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {(timelines[row.task.id] ?? []).length === 0 ? (
                    <li className="text-muted-foreground">{t("oa.timelineEmpty")}</li>
                  ) : (
                    (timelines[row.task.id] ?? []).map((ev) => (
                      <li key={`${ev.type}-${ev.id}`} className="rounded bg-background/80 px-2 py-1">
                        {ev.type === "status" ? (
                          <>
                            <span className="font-medium">{t("oa.timelineStatus")}</span>:{" "}
                            {ev.fromStatus ? `${statusLabel(ev.fromStatus)} → ` : ""}
                            {statusLabel(ev.toStatus)} · {formatDisplayDateTime(ev.at)}
                          </>
                        ) : (
                          <>
                            <span className="font-medium">{t("oa.timelineHandoff")}</span>:{" "}
                            {ev.fromUserId ?? "—"} → {ev.toUserId ?? "—"} ·{" "}
                            {formatDisplayDateTime(ev.at)}
                            {ev.note ? ` · ${ev.note}` : ""}
                          </>
                        )}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
