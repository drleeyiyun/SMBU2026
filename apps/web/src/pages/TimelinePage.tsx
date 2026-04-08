import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiBase, apiFetch, readErrorMessage, readJson } from "../lib/api";

const STALE_MS = 48 * 3600 * 1000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateTimeLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfLocalDayExclusive(d: Date): Date {
  const s = startOfLocalDay(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
}

/** Monday 00:00 local of the week containing `d`. */
function mondayOfWeek(d: Date): Date {
  const s = startOfLocalDay(d);
  const day = s.getDay();
  const diffFromMon = (day + 6) % 7;
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() - diffFromMon);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function deriveRange(viewMode: "day" | "week" | "month", anchorDate: Date): { from: Date; to: Date } {
  if (viewMode === "day") {
    const from = startOfLocalDay(anchorDate);
    const to = endOfLocalDayExclusive(anchorDate);
    return { from, to };
  }
  if (viewMode === "month") {
    const from = startOfMonth(anchorDate);
    const to = startOfNextMonth(anchorDate);
    return { from, to };
  }
  const from = mondayOfWeek(anchorDate);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  return { from, to };
}

function localDateKeyFromYmd(y: number, monthIndex: number, day: number): string {
  return `${y}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function daysInMonth(y: number, monthIndex: number): number {
  return new Date(y, monthIndex + 1, 0).getDate();
}

/** Monday = 0 … Sunday = 6 */
function mondayFirstOffsetFromMonthStart(firstOfMonth: Date): number {
  return (firstOfMonth.getDay() + 6) % 7;
}

function isTodayLocalYmd(y: number, monthIndex: number, day: number): boolean {
  const now = new Date();
  return now.getFullYear() === y && now.getMonth() === monthIndex && now.getDate() === day;
}

function defaultQuickAddRange(anchorDate: Date): { start: Date; end: Date } {
  const now = Date.now();
  const day0 = startOfLocalDay(anchorDate);
  let start = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate(), 13, 0, 0, 0);
  if (start.getTime() <= now) {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    start = d;
  }
  const dayEnd = endOfLocalDayExclusive(anchorDate).getTime();
  if (start.getTime() >= dayEnd) {
    start = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate(), 13, 0, 0, 0);
    if (start.getTime() >= dayEnd) {
      start = new Date(day0.getTime() + 3600 * 1000);
    }
  }
  let end = new Date(start.getTime() + 3600 * 1000);
  if (end.getTime() > dayEnd) {
    end = new Date(dayEnd);
    start = new Date(Math.max(startOfLocalDay(anchorDate).getTime(), end.getTime() - 3600 * 1000));
  }
  return { start, end };
}

type TimelineItem = {
  sourceType: string;
  sourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meta?: unknown;
};

type ScheduleRow = {
  fetchedAt: string;
};

function leagueCategoryKey(cat: string): string {
  switch (cat) {
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

function getMetaLocation(meta: unknown): string | null {
  if (meta == null || typeof meta !== "object") return null;
  const loc = (meta as { location?: unknown }).location;
  return typeof loc === "string" ? loc : null;
}

function getMetaCategory(meta: unknown): string | null {
  if (meta == null || typeof meta !== "object") return null;
  const c = (meta as { category?: unknown }).category;
  return typeof c === "string" ? c : null;
}

function itemMatchesFilter(item: TimelineItem, filterText: string): boolean {
  const q = filterText.trim().toLowerCase();
  if (q.length === 0) return true;
  if (item.title.toLowerCase().includes(q)) return true;
  const loc = getMetaLocation(item.meta);
  if (loc != null && loc.toLowerCase().includes(q)) return true;
  return false;
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const sourceTypeStyles: Record<string, string> = {
  schedule: "border-l-4 border-l-sky-500 bg-sky-500/5",
  plan: "border-l-4 border-l-emerald-500 bg-emerald-500/5",
  org_task: "border-l-4 border-l-amber-500 bg-amber-500/5",
  league_coordination: "border-l-4 border-l-violet-500 bg-violet-500/5",
};

const legendColors: Record<string, string> = {
  schedule: "bg-sky-500",
  plan: "bg-emerald-500",
  org_task: "bg-amber-500",
  league_coordination: "bg-violet-500",
};

function sourceTypeLabelKey(sourceType: string): string {
  switch (sourceType) {
    case "schedule":
      return "timeline.sourceSchedule";
    case "plan":
      return "timeline.sourcePlan";
    case "org_task":
      return "timeline.sourceOrgTask";
    case "league_coordination":
      return "timeline.sourceLeague";
    default:
      return "timeline.sourceOrgTask";
  }
}

const inputClass = "rounded-md border border-border bg-background px-3 py-2 text-sm";
const btnGhost = "rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
const btnPrimary =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const btnToggleOn = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground";
const btnToggleOff = "rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted";

export default function TimelinePage() {
  const { t, i18n } = useTranslation("common");
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [filterText, setFilterText] = useState("");
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [staleSchedule, setStaleSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [planTitle, setPlanTitle] = useState("");
  const [planStartsInput, setPlanStartsInput] = useState("");
  const [planEndsInput, setPlanEndsInput] = useState("");
  const [planSaving, setPlanSaving] = useState(false);

  const { from, to } = useMemo(() => deriveRange(viewMode, anchorDate), [viewMode, anchorDate]);

  const loadRef = useRef<() => Promise<void>>(async () => {});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const fromIso = from.toISOString();
      const toIso = to.toISOString();
      const q = new URLSearchParams({ from: fromIso, to: toIso });

      const [timelineRes, scheduleRes] = await Promise.all([
        apiFetch(`/timeline?${q}`),
        apiFetch(`/schedule?${q}`),
      ]);

      if (!timelineRes.ok) {
        setError(await readErrorMessage(timelineRes));
        setItems([]);
        setStaleSchedule(false);
        return;
      }

      const body = await readJson<{ items: TimelineItem[] }>(timelineRes);
      setItems(body.items);

      let stale = false;
      if (scheduleRes.ok) {
        const schedBody = await readJson<{ items: ScheduleRow[] }>(scheduleRes);
        const rows = schedBody.items;
        if (rows.length > 0) {
          let maxFetched = 0;
          for (const r of rows) {
            const ts = new Date(r.fetchedAt).getTime();
            if (!Number.isNaN(ts) && ts > maxFetched) maxFetched = ts;
          }
          if (maxFetched > 0 && Date.now() - maxFetched > STALE_MS) {
            stale = true;
          }
        }
      }
      setStaleSchedule(stale);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  loadRef.current = load;

  const scheduleDebouncedLoad = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void loadRef.current();
    }, 300);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const { start, end } = defaultQuickAddRange(anchorDate);
    setPlanStartsInput(toDateTimeLocalValue(start));
    setPlanEndsInput(toDateTimeLocalValue(end));
  }, [anchorDate]);

  useEffect(() => {
    const base = apiBase();
    const url = `${base}/notifications/stream`;
    let pollId: number | null = null;

    const startPoll = () => {
      if (pollId != null) return;
      pollId = window.setInterval(() => {
        void loadRef.current();
      }, 10_000);
    };

    const es = new EventSource(url);

    const onTimeline = (ev: MessageEvent) => {
      try {
        JSON.parse(ev.data as string);
      } catch {
        return;
      }
      scheduleDebouncedLoad();
    };

    es.addEventListener("timeline", onTimeline);

    es.onerror = () => {
      es.close();
      startPoll();
    };

    return () => {
      es.removeEventListener("timeline", onTimeline);
      es.close();
      if (pollId != null) {
        clearInterval(pollId);
        pollId = null;
      }
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [scheduleDebouncedLoad]);

  const filteredItems = useMemo(
    () => items.filter((it) => itemMatchesFilter(it, filterText)),
    [items, filterText],
  );

  const weekGroups = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const it of filteredItems) {
      const key = localDayKey(it.startsAt);
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    const keys = [...map.keys()].sort();
    return keys.map((k) => ({ dayKey: k, items: map.get(k)! }));
  }, [filteredItems]);

  const monthDayDensity = useMemo(() => {
    const map = new Map<string, number>();
    if (viewMode !== "month") return map;
    const y = anchorDate.getFullYear();
    const m = anchorDate.getMonth();
    const dim = daysInMonth(y, m);
    for (let day = 1; day <= dim; day++) {
      const dayStart = new Date(y, m, day);
      const dayEnd = endOfLocalDayExclusive(dayStart);
      let c = 0;
      for (const it of filteredItems) {
        const itemStart = new Date(it.startsAt);
        const itemEnd = new Date(it.endsAt);
        if (itemStart < dayEnd && itemEnd > dayStart) {
          c++;
        }
      }
      map.set(localDateKeyFromYmd(y, m, day), c);
    }
    return map;
  }, [filteredItems, viewMode, anchorDate]);

  const monthGridCells = useMemo((): ({ kind: "blank" } | { kind: "day"; day: number })[] => {
    if (viewMode !== "month") return [];
    const y = anchorDate.getFullYear();
    const m = anchorDate.getMonth();
    const first = new Date(y, m, 1);
    const dim = daysInMonth(y, m);
    const lead = mondayFirstOffsetFromMonthStart(first);
    const cells: ({ kind: "blank" } | { kind: "day"; day: number })[] = [];
    for (let i = 0; i < lead; i++) {
      cells.push({ kind: "blank" });
    }
    for (let day = 1; day <= dim; day++) {
      cells.push({ kind: "day", day });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ kind: "blank" });
    }
    return cells;
  }, [viewMode, anchorDate]);

  const weekdayLabelsMonFirst = useMemo(() => {
    // 2024-01-01 is Monday (local)
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 1 + i).toLocaleDateString(i18n.language, { weekday: "short" }),
    );
  }, [i18n.language]);

  function shiftAnchor(deltaDays: number) {
    setAnchorDate((prev) => {
      const s = startOfLocalDay(prev);
      return new Date(s.getFullYear(), s.getMonth(), s.getDate() + deltaDays);
    });
  }

  function shiftAnchorMonth(deltaMonths: number) {
    setAnchorDate((prev) => {
      const s = startOfLocalDay(prev);
      return new Date(s.getFullYear(), s.getMonth() + deltaMonths, s.getDate());
    });
  }

  function shiftPreviousPeriod() {
    if (viewMode === "month") {
      shiftAnchorMonth(-1);
      return;
    }
    shiftAnchor(viewMode === "day" ? -1 : -7);
  }

  function shiftNextPeriod() {
    if (viewMode === "month") {
      shiftAnchorMonth(1);
      return;
    }
    shiftAnchor(viewMode === "day" ? 1 : 7);
  }

  function goToday() {
    setAnchorDate(new Date());
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
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function submitQuickPlan(e: FormEvent) {
    e.preventDefault();
    setSyncMsg(null);
    const title = planTitle.trim();
    const starts = new Date(planStartsInput);
    const ends = new Date(planEndsInput);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || starts >= ends) {
      setError(t("timeline.errorInvalidRange"));
      return;
    }
    if (!title) {
      return;
    }
    setError(null);
    setPlanSaving(true);
    try {
      const res = await apiFetch("/plans", {
        method: "POST",
        body: JSON.stringify({
          title,
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
        }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      setPlanTitle("");
      await load();
    } finally {
      setPlanSaving(false);
    }
  }

  function formatDayHeader(dayKey: string): string {
    const [y, m, d] = dayKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(i18n.language, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  const legendEntries: { type: string; labelKey: string }[] = [
    { type: "schedule", labelKey: "timeline.sourceSchedule" },
    { type: "plan", labelKey: "timeline.sourcePlan" },
    { type: "org_task", labelKey: "timeline.sourceOrgTask" },
    { type: "league_coordination", labelKey: "timeline.sourceLeague" },
  ];

  function renderItemRow(item: TimelineItem) {
    const style = sourceTypeStyles[item.sourceType] ?? "border-l-4 border-l-muted bg-muted/20";
    const cat = item.sourceType === "league_coordination" ? getMetaCategory(item.meta) : null;
    const loc = getMetaLocation(item.meta);
    const badgeText =
      item.sourceType === "league_coordination" && cat != null
        ? t(leagueCategoryKey(cat))
        : t(sourceTypeLabelKey(item.sourceType));

    return (
      <li
        key={`${item.sourceType}-${item.sourceId}`}
        className={`flex flex-col gap-1 rounded-r-md py-3 pl-3 pr-2 text-sm ${style}`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="rounded bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground shadow-sm">
            {badgeText}
          </span>
          <span className="font-medium">{item.title}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {item.startsAt} → {item.endsAt}
        </div>
        {loc != null && loc.length > 0 ? (
          <div className="text-xs text-muted-foreground">{loc}</div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">{t("timeline.title")}</h1>
        <div role="group" aria-label={t("timeline.title")} className="flex flex-wrap gap-2">
          <button type="button" className={viewMode === "day" ? btnToggleOn : btnToggleOff} onClick={() => setViewMode("day")}>
            {t("timeline.day")}
          </button>
          <button type="button" className={viewMode === "week" ? btnToggleOn : btnToggleOff} onClick={() => setViewMode("week")}>
            {t("timeline.week")}
          </button>
          <button type="button" className={viewMode === "month" ? btnToggleOn : btnToggleOff} onClick={() => setViewMode("month")}>
            {t("timeline.month")}
          </button>
        </div>
      </div>

      {staleSchedule ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t("timeline.staleWarning")}
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("timeline.range")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("timeline.focusDate")}</span>
            <input
              type="date"
              value={toDateInputValue(anchorDate)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                const [y, m, d] = v.split("-").map(Number);
                setAnchorDate(new Date(y, m - 1, d));
              }}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={shiftPreviousPeriod} aria-label={t("timeline.previousPeriod")}>
              {t("timeline.previousPeriod")}
            </button>
            <button type="button" className={btnGhost} onClick={goToday}>
              {t("timeline.today")}
            </button>
            <button type="button" className={btnGhost} onClick={shiftNextPeriod} aria-label={t("timeline.nextPeriod")}>
              {t("timeline.nextPeriod")}
            </button>
          </div>
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm sm:max-w-md">
            <span className="text-muted-foreground">{t("timeline.filterPlaceholder")}</span>
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t("timeline.filterPlaceholder")}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            disabled={syncing}
            onClick={() => void runSync()}
            className={btnPrimary}
          >
            {t("timeline.syncSchedule")}
          </button>
        </div>
        {syncMsg ? <p className="mt-2 text-sm text-destructive">{syncMsg}</p> : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("timeline.quickAddPlan")}</h2>
        <form className="flex flex-col gap-3" onSubmit={(e) => void submitQuickPlan(e)}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t("plans.titleLabel")}</span>
            <input
              value={planTitle}
              onChange={(e) => setPlanTitle(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("plans.startsAt")}</span>
              <input
                type="datetime-local"
                value={planStartsInput}
                onChange={(e) => setPlanStartsInput(e.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t("plans.endsAt")}</span>
              <input
                type="datetime-local"
                value={planEndsInput}
                onChange={(e) => setPlanEndsInput(e.target.value)}
                className={inputClass}
                required
              />
            </label>
          </div>
          <button type="submit" disabled={planSaving} className={btnPrimary + " w-fit"}>
            {t("plans.create")}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("timeline.legend")}</h2>
        <ul className="flex flex-wrap gap-4 text-sm">
          {legendEntries.map(({ type, labelKey }) => (
            <li key={type} className="flex items-center gap-2">
              <span className={`h-3 w-8 rounded-sm ${legendColors[type] ?? "bg-muted"}`} />
              <span>{t(labelKey)}</span>
            </li>
          ))}
        </ul>
      </section>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("timeline.mergedEvents")}</h2>
        {loading ? (
          <p className="text-muted-foreground">{t("timeline.loading")}</p>
        ) : viewMode === "month" ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm font-semibold text-foreground">
              {anchorDate.toLocaleDateString(i18n.language, { month: "long", year: "numeric" })}
            </p>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
              {weekdayLabelsMonFirst.map((label, wi) => (
                <div key={wi} className="py-1">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGridCells.map((cell, idx) => {
                if (cell.kind === "blank") {
                  return <div key={`b-${idx}`} className="min-h-[3.5rem]" />;
                }
                const y = anchorDate.getFullYear();
                const m = anchorDate.getMonth();
                const dayKey = localDateKeyFromYmd(y, m, cell.day);
                const density = monthDayDensity.get(dayKey) ?? 0;
                const today = isTodayLocalYmd(y, m, cell.day);
                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => {
                      setAnchorDate(new Date(y, m, cell.day));
                      setViewMode("day");
                    }}
                    className={`flex min-h-[3.5rem] flex-col items-center justify-start rounded-md border p-1 text-sm transition-colors hover:bg-muted/60 ${
                      today ? "border-primary bg-primary/10" : "border-border/60 bg-background"
                    }`}
                  >
                    <span className="font-medium tabular-nums">{cell.day}</span>
                    {density > 0 ? (
                      <span className="mt-1 flex min-h-[0.875rem] items-center justify-center gap-0.5">
                        {density <= 3
                          ? Array.from({ length: density }, (_, di) => (
                              <span key={di} className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                            ))
                          : (
                              <span className="text-xs font-medium tabular-nums text-primary">{density}</span>
                            )}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <p className="text-muted-foreground">{t("timeline.empty")}</p>
        ) : viewMode === "week" ? (
          <div className="flex flex-col gap-6">
            {weekGroups.map(({ dayKey, items: dayItems }) => (
              <div key={dayKey}>
                <h3 className="mb-2 border-b border-border pb-1 text-sm font-semibold text-muted-foreground">
                  {formatDayHeader(dayKey)}
                </h3>
                <ul className="flex flex-col gap-2">{dayItems.map((it) => renderItemRow(it))}</ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">{filteredItems.map((it) => renderItemRow(it))}</ul>
        )}
      </section>
    </div>
  );
}
