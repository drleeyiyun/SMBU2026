import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";

type RosterUserRow = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: string;
};

const inputClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm w-full max-w-md";
const btnPrimary =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";

export default function RosterAdminPage() {
  const { t } = useTranslation("common");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<RosterUserRow[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const [role, setRole] = useState<"student" | "instructor">("instructor");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [volunteerNumber, setVolunteerNumber] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [grade, setGrade] = useState("");
  const [department, setDepartment] = useState("");
  const [major, setMajor] = useState("");
  const [className, setClassName] = useState("");
  const [nationality, setNationality] = useState("中国");

  const loadList = useCallback(async () => {
    const res = await apiFetch("/league/roster/users?limit=80");
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ users: RosterUserRow[] }>(res);
    setList(body.users);
    setError(null);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        role,
      };
      if (role === "student") {
        body.volunteerNumber = volunteerNumber.trim();
        body.studentNo = studentNo.trim() === "" ? null : studentNo.trim();
        body.grade = grade.trim() || undefined;
        body.department = department.trim() || undefined;
        body.major = major.trim() || undefined;
        body.className = className.trim() || undefined;
        body.nationality = nationality.trim() || undefined;
      }
      const res = await apiFetch("/league/roster/users", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      setSuccess(t("rosterAdmin.createOk"));
      setEmail("");
      setDisplayName("");
      setPassword("");
      setVolunteerNumber("");
      setStudentNo("");
      setGrade("");
      setDepartment("");
      setMajor("");
      setClassName("");
      setNationality("中国");
      await loadList();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t("rosterAdmin.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("rosterAdmin.intro")}</p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {success}
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-medium">{t("rosterAdmin.formTitle")}</h2>
        <div className="grid max-w-lg gap-3">
          <label className="text-xs text-muted-foreground">
            {t("rosterAdmin.role")}
            <select
              className={`${inputClass} mt-1`}
              value={role}
              onChange={(e) => setRole(e.target.value as "student" | "instructor")}
            >
              <option value="instructor">{t("rosterAdmin.roleInstructor")}</option>
              <option value="student">{t("rosterAdmin.roleStudent")}</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {t("rosterAdmin.email")}
            <input
              className={`${inputClass} mt-1`}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("rosterAdmin.displayName")}
            <input className={`${inputClass} mt-1`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("rosterAdmin.password")}
            <input
              className={`${inputClass} mt-1`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {role === "student" ? (
            <>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.volunteerNumber")}
                <input
                  className={`${inputClass} mt-1`}
                  value={volunteerNumber}
                  onChange={(e) => setVolunteerNumber(e.target.value)}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.studentNo")}
                <input className={`${inputClass} mt-1`} value={studentNo} onChange={(e) => setStudentNo(e.target.value)} />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.nationality")}
                <input className={`${inputClass} mt-1`} value={nationality} onChange={(e) => setNationality(e.target.value)} />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.grade")}
                <input className={`${inputClass} mt-1`} value={grade} onChange={(e) => setGrade(e.target.value)} />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.department")}
                <input className={`${inputClass} mt-1`} value={department} onChange={(e) => setDepartment(e.target.value)} />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.major")}
                <input className={`${inputClass} mt-1`} value={major} onChange={(e) => setMajor(e.target.value)} />
              </label>
              <label className="text-xs text-muted-foreground">
                {t("rosterAdmin.className")}
                <input className={`${inputClass} mt-1`} value={className} onChange={(e) => setClassName(e.target.value)} />
              </label>
            </>
          ) : null}

          <button type="button" className={`${btnPrimary} w-fit`} disabled={busy} onClick={() => void submit()}>
            {t("rosterAdmin.submit")}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t("rosterAdmin.recentTitle")}</h2>
          <button type="button" className="text-xs text-primary underline" onClick={() => void loadList()}>
            {t("rosterAdmin.refresh")}
          </button>
        </div>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("rosterAdmin.listEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {list.map((u) => (
              <li key={u.id} className="py-2">
                <div className="font-medium">{u.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {u.email} · {u.roles.join(", ")} · {formatDisplayDateTime(u.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
