import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
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

type Category = "practice" | "volunteer" | "work_study" | "general";

type CoordinationItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  startsAt: string;
  endsAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

const inputClass = "rounded-md border border-border bg-background px-3 py-2 text-sm";
const btnPrimary =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
const btnDanger =
  "rounded-md border border-destructive/50 bg-background px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50";

const categories: Category[] = ["practice", "volunteer", "work_study", "general"];

function categoryLabelKey(c: Category): string {
  switch (c) {
    case "practice":
      return "timeline.categoryPractice";
    case "volunteer":
      return "timeline.categoryVolunteer";
    case "work_study":
      return "timeline.categoryWorkStudy";
    case "general":
    default:
      return "timeline.categoryGeneral";
  }
}

export default function LeagueCoordinationPage() {
  const { t } = useTranslation("common");
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<CoordinationItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("general");
  const [startsAtInput, setStartsAtInput] = useState(() => toDateTimeLocalValue(new Date()));
  const [endsAtInput, setEndsAtInput] = useState(() =>
    toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
  );

  const checkMe = useCallback(async () => {
    const res = await apiFetch("/me");
    if (!res.ok) {
      setAllowed(false);
      return;
    }
    const me = await readJson<{ roles: string[] }>(res);
    setAllowed(me.roles.includes("league_admin"));
  }, []);

  const loadItems = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/league/coordination-events");
      if (!res.ok) {
        setError(await readErrorMessage(res));
        setItems([]);
        return;
      }
      const body = await readJson<{ items: CoordinationItem[] }>(res);
      setItems(body.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkMe();
  }, [checkMe]);

  useEffect(() => {
    if (allowed !== true) return;
    void loadItems();
  }, [allowed, loadItems]);

  function resetForm() {
    const now = new Date();
    setTitle("");
    setDescription("");
    setCategory("general");
    setStartsAtInput(toDateTimeLocalValue(now));
    setEndsAtInput(toDateTimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000)));
    setEditingId(null);
  }

  function startEdit(row: CoordinationItem) {
    setEditingId(row.id);
    setTitle(row.title);
    setDescription(row.description ?? "");
    setCategory((categories.includes(row.category as Category) ? row.category : "general") as Category);
    setStartsAtInput(toDateTimeLocalValue(new Date(row.startsAt)));
    setEndsAtInput(toDateTimeLocalValue(new Date(row.endsAt)));
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
      const body: Record<string, unknown> = {
        title: title.trim(),
        category,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      };
      if (description.trim()) body.description = description.trim();
      const res = await apiFetch("/league/coordination-events", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      resetForm();
      await loadItems();
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
      const patch: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        category,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
      };
      const res = await apiFetch(`/league/coordination-events/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      resetForm();
      await loadItems();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("leagueCoordination.delete"))) return;
    setError(null);
    const res = await apiFetch(`/league/coordination-events/${id}`, { method: "DELETE" });
    if (res.status === 204) {
      if (editingId === id) resetForm();
      await loadItems();
      return;
    }
    if (!res.ok) {
      setError(await readErrorMessage(res));
    }
  }

  if (allowed === null) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="text-sm text-muted-foreground">{t("timeline.loading")}</p>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-sm">{t("leagueCoordination.forbidden")}</p>
        <Link
          to="/app/timeline"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("nav.timeline")}
        </Link>
      </div>
    );
  }

  const isEditing = editingId !== null;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("leagueCoordination.title")}</h2>
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
            <span className="text-muted-foreground">{t("leagueCoordination.titleLabel")}</span>
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("leagueCoordination.descriptionLabel")}</span>
            <textarea
              className={`${inputClass} min-h-[4rem]`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("leagueCoordination.category")}</span>
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {t(categoryLabelKey(c))}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("leagueCoordination.startsAt")}</span>
              <input
                type="datetime-local"
                className={inputClass}
                value={startsAtInput}
                onChange={(e) => setStartsAtInput(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("leagueCoordination.endsAt")}</span>
              <input
                type="datetime-local"
                className={inputClass}
                value={endsAtInput}
                onChange={(e) => setEndsAtInput(e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btnPrimary} disabled={saving}>
              {isEditing ? t("leagueCoordination.save") : t("leagueCoordination.create")}
            </button>
            {isEditing ? (
              <button
                type="button"
                className={btnGhost}
                onClick={() => resetForm()}
                disabled={saving}
              >
                {t("leagueCoordination.cancel", { defaultValue: "Cancel" })}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("timeline.loading")}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueCoordination.listEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-medium">{row.title}</div>
                  {row.description ? (
                    <div className="text-xs text-muted-foreground">{row.description}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    {t("leagueCoordination.category")}:{" "}
                    {t(
                      categoryLabelKey(
                        categories.includes(row.category as Category)
                          ? (row.category as Category)
                          : "general",
                      ),
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("leagueCoordination.startsAt")}: {formatDisplayDateTime(row.startsAt)} —{" "}
                    {t("leagueCoordination.endsAt")}: {formatDisplayDateTime(row.endsAt)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} onClick={() => startEdit(row)}>
                    {t("leagueCoordination.edit")}
                  </button>
                  <button type="button" className={btnDanger} onClick={() => void remove(row.id)}>
                    {t("leagueCoordination.delete")}
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
