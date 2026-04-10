import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateTimeLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(s: string): Date {
  return new Date(s);
}

type Plan = {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  priority: number;
  status: string;
  onTimeline: boolean;
  createdAt: string;
};

const inputClass = "rounded-md border border-border bg-background px-3 py-2 text-sm";
const btnPrimary =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
const btnDanger =
  "rounded-md border border-destructive/50 bg-background px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50";

export default function PlansPage() {
  const { t } = useTranslation("common");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [startsAtInput, setStartsAtInput] = useState(() => toDateTimeLocalValue(new Date()));
  const [endsAtInput, setEndsAtInput] = useState(() =>
    toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [priority, setPriority] = useState(1);
  const [status, setStatus] = useState("planned");
  const [onTimeline, setOnTimeline] = useState(true);
  const [listSort, setListSort] = useState<"time" | "priority">("time");

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const qs = listSort === "priority" ? "?sort=priority" : "";
      const res = await apiFetch(`/plans${qs}`);
      if (!res.ok) {
        setError(await readErrorMessage(res));
        setPlans([]);
        return;
      }
      const body = await readJson<{ plans: Plan[] }>(res);
      setPlans(body.plans);
    } finally {
      setLoading(false);
    }
  }, [listSort]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetFormDefaults() {
    const now = new Date();
    setTitle("");
    setStartsAtInput(toDateTimeLocalValue(now));
    setEndsAtInput(toDateTimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000)));
    setPriority(1);
    setStatus("planned");
    setOnTimeline(true);
    setEditingId(null);
  }

  function startEdit(p: Plan) {
    setEditingId(p.id);
    setTitle(p.title);
    setStartsAtInput(toDateTimeLocalValue(new Date(p.startsAt)));
    setEndsAtInput(toDateTimeLocalValue(new Date(p.endsAt)));
    setPriority(p.priority);
    setStatus(p.status);
    setOnTimeline(p.onTimeline);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    const starts = fromDateTimeLocal(startsAtInput);
    const ends = fromDateTimeLocal(endsAtInput);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || starts >= ends) {
      setError(t("timeline.errorInvalidRange"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/plans", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
          priority,
          status: status.trim() || "planned",
          onTimeline,
        }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      resetFormDefaults();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function submitUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const starts = fromDateTimeLocal(startsAtInput);
    const ends = fromDateTimeLocal(endsAtInput);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || starts >= ends) {
      setError(t("timeline.errorInvalidRange"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/plans/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
          priority,
          status: status.trim() || "planned",
          onTimeline,
        }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      resetFormDefaults();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("plans.delete"))) return;
    setError(null);
    const res = await apiFetch(`/plans/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    if (editingId === id) resetFormDefaults();
    await load();
  }

  const isEditing = editingId !== null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("plans.title")}</h2>
        {error ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <form
          onSubmit={isEditing ? submitUpdate : submitCreate}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("plans.titleLabel")}</span>
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("plans.startsAt")}</span>
              <input
                type="datetime-local"
                className={inputClass}
                value={startsAtInput}
                onChange={(e) => setStartsAtInput(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("plans.endsAt")}</span>
              <input
                type="datetime-local"
                className={inputClass}
                value={endsAtInput}
                onChange={(e) => setEndsAtInput(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("plans.priority")}</span>
              <input
                type="number"
                className={`${inputClass} w-28`}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                step={1}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("plans.status")}</span>
              <input
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onTimeline}
              onChange={(e) => setOnTimeline(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span>{t("plans.onTimeline")}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={saving}>
              {isEditing ? t("plans.save") : t("plans.create")}
            </button>
            {isEditing ? (
              <button
                type="button"
                className={btnGhost}
                onClick={() => resetFormDefaults()}
                disabled={saving}
              >
                {t("plans.cancel", { defaultValue: "Cancel" })}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">{t("plans.listTitle")}</h3>
          <div role="group" className="flex flex-wrap gap-2 text-sm">
            <button
              type="button"
              className={listSort === "time" ? btnPrimary : btnGhost}
              onClick={() => setListSort("time")}
            >
              {t("plans.sortByTime")}
            </button>
            <button
              type="button"
              className={listSort === "priority" ? btnPrimary : btnGhost}
              onClick={() => setListSort("priority")}
            >
              {t("plans.sortByPriority")}
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("timeline.loading")}</p>
        ) : plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("plans.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {plans.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("plans.startsAt")}: {formatDisplayDateTime(p.startsAt)} —{" "}
                    {t("plans.endsAt")}: {formatDisplayDateTime(p.endsAt)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("plans.priority")}: {p.priority} · {t("plans.status")}: {p.status} ·{" "}
                    {p.onTimeline ? t("plans.onTimeline") : "—"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} onClick={() => startEdit(p)}>
                    {t("plans.edit")}
                  </button>
                  <button type="button" className={btnDanger} onClick={() => void remove(p.id)}>
                    {t("plans.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
