import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { useSession } from "../state/session";

type PendingRow = {
  userId: string;
  displayName: string | null;
  basicAuditStatus: string;
  profileAuditStatus: string;
};

type AuditRow = {
  id: string;
  userId: string;
  payload: unknown;
  createdAt: string;
};

export default function LeagueArchivePage() {
  const { t } = useTranslation("common");
  const { user } = useSession();
  const allowed = user?.roles.includes("league_admin") ?? false;

  const [pending, setPending] = useState<PendingRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reasonByUser, setReasonByUser] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    const [pRes, aRes] = await Promise.all([
      apiFetch("/league/archive/pending"),
      apiFetch("/league/archive/audit-log?limit=30"),
    ]);
    if (!pRes.ok) {
      setError(await readErrorMessage(pRes));
      return;
    }
    if (!aRes.ok) {
      setError(await readErrorMessage(aRes));
      return;
    }
    const pBody = await readJson<{ items: PendingRow[] }>(pRes);
    const aBody = await readJson<{ items: AuditRow[] }>(aRes);
    setPending(pBody.items);
    setAudit(aBody.items);
  }, [allowed]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function decide(userId: string, action: "approve" | "reject") {
    setMsg(null);
    const reason = reasonByUser[userId]?.trim() ?? "";
    if (action === "reject" && !reason) {
      setMsg(t("leagueArchive.reason"));
      return;
    }
    const res = await apiFetch(`/archive/reviews/${userId}`, {
      method: "POST",
      body: JSON.stringify({ action, reason: action === "reject" ? reason : undefined }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setReasonByUser((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    await load();
  }

  if (!allowed) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-muted-foreground">
        {t("leagueArchive.forbidden")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-card p-4 text-red-700 dark:text-red-300">
        {t("leagueArchive.loadError")}: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">{t("leagueArchive.title")}</h1>
      {msg ? <p className="text-sm text-amber-800 dark:text-amber-200">{msg}</p> : null}

      <section>
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.pending")}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueArchive.noPending")}</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => (
              <li
                key={row.userId}
                className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm"
              >
                <p className="font-medium">{row.displayName ?? row.userId}</p>
                <p className="text-muted-foreground">
                  basic: {row.basicAuditStatus} · legacy: {row.profileAuditStatus}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2"
                    placeholder={t("leagueArchive.reason")}
                    value={reasonByUser[row.userId] ?? ""}
                    onChange={(e) =>
                      setReasonByUser((prev) => ({ ...prev, [row.userId]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void decide(row.userId, "approve")}
                    className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
                  >
                    {t("leagueArchive.approve")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(row.userId, "reject")}
                    className="rounded-md border border-destructive/50 px-3 py-2 font-medium text-destructive"
                  >
                    {t("leagueArchive.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.auditLog")}</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-2">Time</th>
                <th className="p-2">Student</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((r) => {
                const pl = r.payload as {
                  scope?: string;
                  action?: string;
                  reason?: string | null;
                };
                return (
                  <tr key={r.id} className="border-b border-border">
                    <td className="p-2 whitespace-nowrap text-muted-foreground">{r.createdAt}</td>
                    <td className="p-2 font-mono text-xs">{r.userId.slice(0, 8)}…</td>
                    <td className="p-2">{pl.scope ?? "—"}</td>
                    <td className="p-2">
                      {pl.action ?? "—"}
                      {pl.reason ? ` (${pl.reason})` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
