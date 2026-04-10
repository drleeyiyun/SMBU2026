import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { apiBase, apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";

type NotificationRow = {
  id: string;
  type: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
};

function mergeById(prev: NotificationRow[], incoming: NotificationRow[]) {
  const map = new Map<string, NotificationRow>();
  for (const n of prev) {
    map.set(n.id, n);
  }
  for (const n of incoming) {
    map.set(n.id, n);
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function summarizeNotification(
  t: TFunction<"common">,
  n: NotificationRow,
): { title: string; badge: string; lines: { label: string; value: string }[] } {
  const { type, payload } = n;

  if (type === "archive_audit" && payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const scope = String(p.scope ?? "");
    let title = t("notifications.archiveBasic");
    if (scope === "profile_basic") title = t("notifications.archiveBasic");
    else if (scope === "profile") title = t("notifications.archiveContact");
    else if (scope === "award") title = t("notifications.archiveAward");

    const action =
      p.action === "approve"
        ? t("notifications.actionApprove")
        : p.action === "reject"
          ? t("notifications.actionReject")
          : String(p.action ?? "—");

    const lines: { label: string; value: string }[] = [
      { label: t("notifications.auditAction"), value: action },
    ];

    if (typeof p.reason === "string" && p.reason.trim()) {
      lines.push({ label: t("notifications.reason"), value: p.reason });
    }
    if (typeof p.decidedAt === "string") {
      lines.push({
        label: t("notifications.decidedAt"),
        value: formatDisplayDateTime(p.decidedAt),
      });
    }
    if (typeof p.awardId === "string") {
      lines.push({ label: t("notifications.awardId"), value: p.awardId });
    }

    return { title, badge: t("notifications.typeArchive"), lines };
  }

  if (type === "task_status" && payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const lines: { label: string; value: string }[] = [
      { label: t("notifications.taskId"), value: String(p.taskId ?? "—") },
      { label: t("notifications.fromStatus"), value: String(p.fromStatus ?? "—") },
      { label: t("notifications.toStatus"), value: String(p.toStatus ?? "—") },
    ];
    if (typeof p.at === "string") {
      lines.push({
        label: t("notifications.decidedAt"),
        value: formatDisplayDateTime(p.at),
      });
    }
    return {
      title: t("notifications.taskStatusChange"),
      badge: t("notifications.typeTask"),
      lines,
    };
  }

  return {
    title: type,
    badge: type,
    lines: [{ label: "payload", value: JSON.stringify(payload) }],
  };
}

export default function NotificationsPage() {
  const { t } = useTranslation("common");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"sse" | "poll">("sse");
  const [busyId, setBusyId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch("/notifications");
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ notifications: NotificationRow[] }>(res);
    setItems(body.notifications);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const base = apiBase();
    const url = `${base}/notifications/stream`;

    const startPoll = () => {
      if (pollRef.current != null) return;
      setMode("poll");
      pollRef.current = window.setInterval(() => {
        void load();
      }, 10_000);
    };

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("notification", (ev) => {
      try {
        const row = JSON.parse((ev as MessageEvent).data as string) as NotificationRow;
        setItems((prev) => mergeById(prev, [row]));
      } catch {
        /* ignore malformed */
      }
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      startPoll();
    };

    es.onopen = () => {
      setMode("sse");
    };

    return () => {
      es.close();
      esRef.current = null;
      if (pollRef.current != null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [load]);

  const markRead = async (id: string) => {
    setBusyId(id);
    try {
      const res = await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
      if (!res.ok) return;
      const body = await readJson<{ notification: NotificationRow }>(res);
      setItems((prev) => mergeById(prev, [body.notification]));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("notifications.title")}</h1>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
        <span className="truncate">GET /notifications</span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs whitespace-nowrap">
          {mode === "sse" ? t("notifications.liveSse") : t("notifications.livePoll")}
        </span>
      </div>

      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {error}
        </div>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        {items.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</li>
        ) : (
          items.map((n) => {
            const { title, badge, lines } = summarizeNotification(t, n);
            return (
              <li key={n.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {badge}
                      </span>
                      {n.readAt ? (
                        <span className="text-xs text-muted-foreground">
                          {t("notifications.read")} · {n.readAt}
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                          {t("notifications.unread")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium leading-snug">{title}</p>
                    <dl className="grid gap-1 text-xs sm:grid-cols-2">
                      {lines
                        .filter((line) => line.label && line.value)
                        .map((line, i) => (
                          <div key={`${n.id}-${i}`} className="flex gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                            <dt className="shrink-0 text-muted-foreground">{line.label}</dt>
                            <dd className="min-w-0 break-words font-medium">{line.value}</dd>
                          </div>
                        ))}
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      {formatDisplayDateTime(n.createdAt)}
                    </p>
                  </div>
                  {!n.readAt ? (
                    <button
                      type="button"
                      disabled={busyId === n.id}
                      onClick={() => void markRead(n.id)}
                      className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      {t("notifications.markRead")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
