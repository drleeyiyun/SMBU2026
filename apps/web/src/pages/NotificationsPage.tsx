import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, apiFetch, readJson } from "../lib/api";

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

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"sse" | "poll">("sse");
  const pollRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch("/notifications");
    if (!res.ok) {
      setError(`Failed to load (${res.status})`);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
        <span>GET /notifications</span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">
          live: {mode === "sse" ? "EventSource /notifications/stream" : "poll 10s"}
        </span>
      </div>

      {error ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {error}
        </div>
      ) : null}

      <ul className="rounded-lg border border-border bg-card divide-y divide-border shadow-sm">
        {items.length === 0 ? (
          <li className="p-4 text-sm text-muted-foreground">No notifications.</li>
        ) : (
          items.map((n) => (
            <li key={n.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">{n.type}</span>
                {n.readAt ? (
                  <span className="text-xs text-muted-foreground">read {n.readAt}</span>
                ) : (
                  <span className="text-xs text-amber-700 dark:text-amber-300">unread</span>
                )}
              </div>
              <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-xs">
                {JSON.stringify(n.payload, null, 2)}
              </pre>
              <p className="mt-1 text-xs text-muted-foreground">{n.createdAt}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
