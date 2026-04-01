import { useCallback, useEffect, useState } from "react";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateTimeLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

const initialRange = defaultRange();

type TimelineItem = {
  sourceType: string;
  sourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meta?: unknown;
};

export default function TimelinePage() {
  const [{ from, to }, setRange] = useState(() => initialRange);
  const [fromInput, setFromInput] = useState(() => toDateTimeLocalValue(initialRange.from));
  const [toInput, setToInput] = useState(() => toDateTimeLocalValue(initialRange.to));
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const fromIso = from.toISOString();
      const toIso = to.toISOString();
      const q = new URLSearchParams({ from: fromIso, to: toIso });
      const res = await apiFetch(`/timeline?${q}`);
      if (!res.ok) {
        setError(await readErrorMessage(res));
        setItems([]);
        return;
      }
      const body = await readJson<{ items: TimelineItem[] }>(res);
      setItems(body.items);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyRange() {
    const f = new Date(fromInput);
    const t = new Date(toInput);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f >= t) {
      setError("Invalid range: from must be before to.");
      return;
    }
    setError(null);
    setRange({ from: f, to: t });
  }

  async function runSync() {
    setSyncMsg(null);
    setSyncing(true);
    try {
      const res = await apiFetch("/schedule/sync", {
        method: "POST",
        body: JSON.stringify({
          from: from.toISOString(),
          to: to.toISOString(),
        }),
      });
      if (!res.ok) {
        setSyncMsg(await readErrorMessage(res));
        return;
      }
      const body = await readJson<{ count: number; fetchedAt: string }>(res);
      setSyncMsg(`Synced ${body.count} items (${body.fetchedAt}).`);
      await load();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Range</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">From</span>
            <input
              type="datetime-local"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">To</span>
            <input
              type="datetime-local"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={applyRange}
            className="rounded-md bg-muted px-4 py-2 text-sm font-medium"
          >
            Apply
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void runSync()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            POST /schedule/sync
          </button>
        </div>
        {syncMsg ? <p className="mt-2 text-sm text-muted-foreground">{syncMsg}</p> : null}
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Merged timeline</h2>
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground">No items in range.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={`${item.sourceType}-${item.sourceId}`} className="flex flex-wrap items-baseline gap-2 py-3 text-sm">
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium uppercase">
                  {item.sourceType}
                </span>
                <span className="font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {item.startsAt} → {item.endsAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
