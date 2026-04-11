import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AcademicDeptMajorSelects } from "../components/AcademicDeptMajorSelects";
import { StudentGradeSelect } from "../components/StudentGradeSelect";
import {
  defaultWeekAnchorYmd,
  expandWeeklyScheduleToItems,
  type PublishItem,
  type WeeklySlotInput,
} from "../lib/expand-weekly-schedule";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { useSession } from "../state/session";

type ScheduleRowForm = {
  title: string;
  instructor: string;
  location: string;
  startsLocal: string;
  endsLocal: string;
};

type WeeklyRowForm = WeeklySlotInput;

const MAX_PUBLISH_ITEMS = 8000;

function localDatetimeToIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function emptyRow(): ScheduleRowForm {
  return { title: "", instructor: "", location: "", startsLocal: "", endsLocal: "" };
}

function emptyWeeklyRow(): WeeklyRowForm {
  return { weekday: 1, startTime: "", endTime: "", title: "", instructor: "", location: "" };
}

const inputClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm w-full min-w-0";
const btnPrimary =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

const tabBtn = (active: boolean) =>
  [
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
  ].join(" ");

export default function ProgramScheduleAdminPage() {
  const { t } = useTranslation("common");
  const { user } = useSession();
  const allowed = user?.roles.includes("league_admin") ?? false;
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [department, setDepartment] = useState("");
  const [major, setMajor] = useState("");
  /** 空字符串 = 该系别专业下全部年级 */
  const [gradeFilter, setGradeFilter] = useState("");
  const [mode, setMode] = useState<"append" | "replace_cohort">("append");

  const [publishTab, setPublishTab] = useState<"single" | "weekly">("weekly");
  const [rows, setRows] = useState<ScheduleRowForm[]>([emptyRow()]);

  const [anchorYmd, setAnchorYmd] = useState(() => defaultWeekAnchorYmd());
  const [weekCount, setWeekCount] = useState(16);
  const [weeklyRows, setWeeklyRows] = useState<WeeklyRowForm[]>([emptyWeeklyRow()]);

  const weekdayOptions = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 7].map((v) => ({
        value: v,
        label: t(`programSchedule.weekday${v}` as "programSchedule.weekday1"),
      })),
    [t],
  );

  const postPublish = useCallback(
    async (items: PublishItem[]) => {
      const res = await apiFetch("/league/program-schedule/publish", {
        method: "POST",
        body: JSON.stringify({
          department: department.trim(),
          major: major.trim(),
          grade: gradeFilter.trim() === "" ? null : gradeFilter.trim(),
          mode,
          items,
        }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      const body = await readJson<{
        ok: boolean;
        recipientCount: number;
        insertedRows: number;
        warning?: string;
      }>(res);
      setMsg(
        body.warning
          ? `${t("programSchedule.publishOk", { count: body.recipientCount, rows: body.insertedRows })} — ${body.warning}`
          : t("programSchedule.publishOk", { count: body.recipientCount, rows: body.insertedRows }),
      );
    },
    [department, major, gradeFilter, mode, t],
  );

  const publishSingle = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const items: PublishItem[] = [];
      for (const r of rows) {
        const startsAt = localDatetimeToIso(r.startsLocal);
        const endsAt = localDatetimeToIso(r.endsLocal);
        if (!r.title.trim() || !startsAt || !endsAt) {
          setError(t("programSchedule.fillAllFields"));
          return;
        }
        const ins = r.instructor.trim();
        items.push({
          title: r.title.trim(),
          instructor: ins.length > 0 ? ins : null,
          location: r.location.trim() || null,
          startsAt,
          endsAt,
        });
      }
      if (items.length > MAX_PUBLISH_ITEMS) {
        setError(t("programSchedule.errTooManyItems", { max: MAX_PUBLISH_ITEMS }));
        return;
      }
      await postPublish(items);
    } finally {
      setBusy(false);
    }
  }, [postPublish, rows, t]);

  const publishWeekly = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const filled = weeklyRows.filter(
        (r) => r.title.trim() && r.startTime.trim() && r.endTime.trim(),
      );
      const expanded = expandWeeklyScheduleToItems(anchorYmd, weekCount, filled);
      if (!expanded.ok) {
        if (expanded.error === "invalidAnchorDate") setError(t("programSchedule.errInvalidAnchor"));
        else if (expanded.error === "timeOrder") setError(t("programSchedule.errTimeOrder"));
        else setError(t("programSchedule.errNoSlots"));
        return;
      }
      if (expanded.items.length > MAX_PUBLISH_ITEMS) {
        setError(t("programSchedule.errTooManyItems", { max: MAX_PUBLISH_ITEMS }));
        return;
      }
      await postPublish(expanded.items);
    } finally {
      setBusy(false);
    }
  }, [anchorYmd, postPublish, t, weekCount, weeklyRows]);

  if (!allowed) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-muted-foreground">
        {t("leagueArchive.forbidden")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t("programSchedule.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("programSchedule.intro")}</p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">{msg}</div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-medium">{t("programSchedule.targetCohort")}</h2>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <AcademicDeptMajorSelects
            department={department}
            major={major}
            onDepartmentChange={setDepartment}
            onMajorChange={setMajor}
          />
        </div>
        <div className="mt-3 max-w-md">
          <StudentGradeSelect
            value={gradeFilter}
            onChange={setGradeFilter}
            allowAll
            labelMode="programFilter"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("programSchedule.gradeFilterHint")}</p>
        </div>

        <fieldset className="mt-4 space-y-2 text-sm">
          <legend className="mb-2 font-medium">{t("programSchedule.modeLabel")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="schedMode"
              checked={mode === "append"}
              onChange={() => setMode("append")}
            />
            {t("programSchedule.modeAppend")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="schedMode"
              checked={mode === "replace_cohort"}
              onChange={() => setMode("replace_cohort")}
            />
            {t("programSchedule.modeReplace")}
          </label>
        </fieldset>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t("programSchedule.tablistLabel")}>
          <button type="button" role="tab" className={tabBtn(publishTab === "weekly")} onClick={() => setPublishTab("weekly")}>
            {t("programSchedule.tabWeekly")}
          </button>
          <button type="button" role="tab" className={tabBtn(publishTab === "single")} onClick={() => setPublishTab("single")}>
            {t("programSchedule.tabSingle")}
          </button>
        </div>

        {publishTab === "weekly" ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{t("programSchedule.weeklyIntro")}</p>
            <div className="mb-4 flex flex-wrap gap-4">
              <label className="flex min-w-[200px] flex-col gap-1 text-xs">
                {t("programSchedule.anchorWeek")}
                <input
                  className={inputClass}
                  type="date"
                  value={anchorYmd}
                  onChange={(e) => setAnchorYmd(e.target.value)}
                />
                <span className="text-muted-foreground">{t("programSchedule.anchorWeekHint")}</span>
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs">
                {t("programSchedule.weekCount")}
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={52}
                  value={weekCount}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setWeekCount(Number.isFinite(n) ? Math.min(52, Math.max(1, n)) : 1);
                  }}
                />
              </label>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t("programSchedule.weeklySlotsTitle")}</h2>
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() => setWeeklyRows((prev) => [...prev, emptyWeeklyRow()])}
              >
                {t("programSchedule.addWeeklyRow")}
              </button>
            </div>
            <div className="space-y-3">
              {weeklyRows.map((row, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-8"
                >
                  <label className="flex flex-col gap-1 text-xs">
                    {t("programSchedule.weekday")}
                    <select
                      className={inputClass}
                      value={row.weekday}
                      onChange={(e) =>
                        setWeeklyRows((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, weekday: Number(e.target.value) } : r,
                          ),
                        )
                      }
                    >
                      {weekdayOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    {t("programSchedule.timeStart")}
                    <input
                      className={inputClass}
                      type="time"
                      value={row.startTime}
                      onChange={(e) =>
                        setWeeklyRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, startTime: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    {t("programSchedule.timeEnd")}
                    <input
                      className={inputClass}
                      type="time"
                      value={row.endTime}
                      onChange={(e) =>
                        setWeeklyRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, endTime: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2 xl:col-span-2">
                    {t("programSchedule.courseTitle")}
                    <input
                      className={inputClass}
                      value={row.title}
                      onChange={(e) =>
                        setWeeklyRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2 xl:col-span-2">
                    {t("programSchedule.instructor")}
                    <input
                      className={inputClass}
                      value={row.instructor}
                      onChange={(e) =>
                        setWeeklyRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, instructor: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2 xl:col-span-2">
                    {t("programSchedule.location")}
                    <input
                      className={inputClass}
                      value={row.location}
                      onChange={(e) =>
                        setWeeklyRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, location: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  {weeklyRows.length > 1 ? (
                    <div className="sm:col-span-2 xl:col-span-8">
                      <button
                        type="button"
                        className="text-xs text-destructive underline"
                        onClick={() => setWeeklyRows((prev) => prev.filter((_, j) => j !== i))}
                      >
                        {t("programSchedule.removeRow")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <button
              type="button"
              className={`${btnPrimary} mt-4`}
              disabled={busy}
              onClick={() => void publishWeekly()}
            >
              {t("programSchedule.publishWeekly")}
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{t("programSchedule.singleIntro")}</p>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium">{t("programSchedule.slotsTitle")}</h2>
              <button
                type="button"
                className="text-xs text-primary underline"
                onClick={() => setRows((prev) => [...prev, emptyRow()])}
              >
                {t("programSchedule.addRow")}
              </button>
            </div>
            <div className="space-y-4">
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                    {t("programSchedule.courseTitle")}
                    <input
                      className={inputClass}
                      value={row.title}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                    {t("programSchedule.instructor")}
                    <input
                      className={inputClass}
                      value={row.instructor}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, instructor: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                    {t("programSchedule.location")}
                    <input
                      className={inputClass}
                      value={row.location}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, location: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    {t("programSchedule.starts")}
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={row.startsLocal}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, startsLocal: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    {t("programSchedule.ends")}
                    <input
                      className={inputClass}
                      type="datetime-local"
                      value={row.endsLocal}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, j) => (j === i ? { ...r, endsLocal: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                  {rows.length > 1 ? (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <button
                        type="button"
                        className="text-xs text-destructive underline"
                        onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      >
                        {t("programSchedule.removeRow")}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <button
              type="button"
              className={`${btnPrimary} mt-4`}
              disabled={busy}
              onClick={() => void publishSingle()}
            >
              {t("programSchedule.publish")}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
