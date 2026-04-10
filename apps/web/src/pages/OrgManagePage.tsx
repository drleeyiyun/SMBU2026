import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";
import { useSession } from "../state/session";

type OrgJson = {
  id: string;
  nameFull: string;
  nameShort: string;
  logoUrl: string | null;
  orgType: string;
  lifecycleStatus: string;
  advisorUserId: string | null;
  createdAt: string;
};

type RevisionRow = {
  id: string;
  orgId: string;
  orgNameShort: string;
  status: string;
  payload: unknown;
  createdAt: string;
};

type LeadershipEvent = {
  id: string;
  changeKind: string;
  payload: unknown;
  createdAt: string;
};

const LIFECYCLE = ["pending", "active", "suspended"] as const;

const inputClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm w-full max-w-lg";
const btnPrimary =
  "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50";
const btnGhost =
  "rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50";
const btnDanger =
  "rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50";

export default function OrgManagePage() {
  const { t } = useTranslation("common");
  const { user, refreshMe } = useSession();
  const isLeague = user?.roles.includes("league_admin") ?? false;
  const isOfficerRole =
    user?.roles.includes("org_president") || user?.roles.includes("org_officer");
  const memberships = user?.memberships ?? [];
  const canOfficerSection = !!(isOfficerRole && memberships.length);
  const allowed = isLeague || canOfficerSection;

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [leagueOrgs, setLeagueOrgs] = useState<OrgJson[]>([]);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [lcTarget, setLcTarget] = useState<Record<string, string>>({});
  const [lcReason, setLcReason] = useState<Record<string, string>>({});
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [officerOrgId, setOfficerOrgId] = useState("");
  const [orgDetail, setOrgDetail] = useState<OrgJson | null>(null);
  const [revNameFull, setRevNameFull] = useState("");
  const [revNameShort, setRevNameShort] = useState("");
  const [revOrgType, setRevOrgType] = useState("");
  const [revLogoUrl, setRevLogoUrl] = useState("");
  const [advisorField, setAdvisorField] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberTitle, setMemberTitle] = useState("");
  const [events, setEvents] = useState<LeadershipEvent[]>([]);
  const [instrQuery, setInstrQuery] = useState("");
  const [instrHits, setInstrHits] = useState<Array<{ id: string; displayName: string }>>([]);

  useEffect(() => {
    if (memberships.length > 0 && !officerOrgId) {
      setOfficerOrgId(memberships[0]!.orgId);
    }
  }, [memberships, officerOrgId]);

  const loadLeague = useCallback(async () => {
    const qs = lifecycleFilter ? `?lifecycle=${encodeURIComponent(lifecycleFilter)}` : "";
    const res = await apiFetch(`/league/orgs${qs}`);
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ organizations: OrgJson[] }>(res);
    setLeagueOrgs(body.organizations);
    setError(null);
  }, [lifecycleFilter]);

  const loadRevisions = useCallback(async () => {
    const res = await apiFetch("/league/org-revisions");
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ revisions: RevisionRow[] }>(res);
    setRevisions(body.revisions);
  }, []);

  const loadOfficerOrg = useCallback(async (orgId: string) => {
    if (!orgId) return;
    const res = await apiFetch(`/orgs/${orgId}`);
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ organization: OrgJson }>(res);
    const o = body.organization;
    setOrgDetail(o);
    setRevNameFull(o.nameFull);
    setRevNameShort(o.nameShort);
    setRevOrgType(o.orgType);
    setRevLogoUrl(o.logoUrl ?? "");
    setAdvisorField(o.advisorUserId ?? "");
    const er = await apiFetch(`/orgs/${orgId}/leadership-events`);
    if (er.ok) {
      const eb = await readJson<{ events: LeadershipEvent[] }>(er);
      setEvents(eb.events);
    }
    setError(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (isLeague) {
          await loadLeague();
          await loadRevisions();
        }
        if (canOfficerSection && officerOrgId) {
          await loadOfficerOrg(officerOrgId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isLeague, canOfficerSection, officerOrgId, lifecycleFilter, loadLeague, loadRevisions, loadOfficerOrg]);

  const applyLifecycle = async (orgId: string) => {
    const org = leagueOrgs.find((x) => x.id === orgId);
    if (!org) return;
    const toStatus = lcTarget[orgId] ?? org.lifecycleStatus;
    if (toStatus === org.lifecycleStatus) return;
    setBusy(true);
    try {
      const reason = lcReason[orgId]?.trim();
      const res = await apiFetch(`/league/orgs/${orgId}/lifecycle`, {
        method: "PATCH",
        body: JSON.stringify({
          toStatus,
          ...(reason ? { reason } : {}),
        }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      await loadLeague();
      void refreshMe();
    } finally {
      setBusy(false);
    }
  };

  const approveRevision = async (revisionId: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/orgs/revisions/${revisionId}/decide`, {
        method: "POST",
        body: JSON.stringify({ action: "approve" }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      setRejectFor(null);
      setRejectReason("");
      await loadRevisions();
      await loadLeague();
      if (canOfficerSection && officerOrgId) await loadOfficerOrg(officerOrgId);
      void refreshMe();
    } finally {
      setBusy(false);
    }
  };

  const confirmRejectRevision = async (revisionId: string) => {
    if (!rejectReason.trim()) {
      setError(t("orgManage.rejectReasonRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/orgs/revisions/${revisionId}/decide`, {
        method: "POST",
        body: JSON.stringify({ action: "reject", reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      setRejectFor(null);
      setRejectReason("");
      await loadRevisions();
      await loadLeague();
      if (canOfficerSection && officerOrgId) await loadOfficerOrg(officerOrgId);
      void refreshMe();
    } finally {
      setBusy(false);
    }
  };

  const submitRevision = async () => {
    if (!officerOrgId || !orgDetail) return;
    const body: Record<string, unknown> = {};
    if (revNameFull !== orgDetail.nameFull) body.nameFull = revNameFull;
    if (revNameShort !== orgDetail.nameShort) body.nameShort = revNameShort;
    if (revOrgType !== orgDetail.orgType) body.orgType = revOrgType;
    const logoVal = revLogoUrl.trim() === "" ? null : revLogoUrl.trim();
    if (logoVal !== orgDetail.logoUrl) body.logoUrl = logoVal;
    if (Object.keys(body).length === 0) {
      setError(t("orgManage.noRevisionChanges"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/orgs/${officerOrgId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      await loadRevisions();
      await loadOfficerOrg(officerOrgId);
      if (isLeague) await loadLeague();
    } finally {
      setBusy(false);
    }
  };

  const saveAdvisor = async (advisorUserId: string | null) => {
    if (!officerOrgId) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/orgs/${officerOrgId}/advisor`, {
        method: "PATCH",
        body: JSON.stringify({ advisorUserId }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      await loadOfficerOrg(officerOrgId);
    } finally {
      setBusy(false);
    }
  };

  const searchInstructors = async () => {
    const q = instrQuery.trim();
    if (q.length < 2) {
      setError(t("orgManage.searchMin"));
      return;
    }
    const res = await apiFetch(`/directory/instructors?q=${encodeURIComponent(q)}&limit=20`);
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<{ users: Array<{ id: string; displayName: string }> }>(res);
    setInstrHits(body.users);
    setError(null);
  };

  const addMember = async () => {
    if (!officerOrgId || !memberUserId.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/orgs/${officerOrgId}/members`, {
        method: "POST",
        body: JSON.stringify({
          userId: memberUserId.trim(),
          title: memberTitle.trim() === "" ? null : memberTitle.trim(),
        }),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res));
        return;
      }
      setMemberUserId("");
      setMemberTitle("");
      await loadOfficerOrg(officerOrgId);
    } finally {
      setBusy(false);
    }
  };

  if (!user || loading) {
    return <p className="text-muted-foreground">{t("orgManage.loading")}</p>;
  }

  if (!allowed) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        {t("orgManage.forbidden")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">{t("orgManage.title")}</h1>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {isLeague ? (
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">{t("orgManage.leagueOrgs")}</h2>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground">
              {t("orgManage.lifecycleFilter")}
              <select
                className="ml-2 rounded border border-input bg-background px-2 py-1 text-sm"
                value={lifecycleFilter}
                onChange={(e) => setLifecycleFilter(e.target.value)}
              >
                <option value="">{t("orgManage.allLifecycles")}</option>
                {LIFECYCLE.map((s) => (
                  <option key={s} value={s}>
                    {t(`orgManage.lifecycle.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => void loadLeague()}
            >
              {t("orgManage.refresh")}
            </button>
          </div>
          {leagueOrgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("orgManage.noOrgs")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {leagueOrgs.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-background/50 p-4 text-sm shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight">{o.nameShort}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{o.nameFull}</div>
                    </div>
                    {o.logoUrl ? (
                      <img
                        src={o.logoUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-md border border-dashed border-border bg-muted/60" />
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">{t("orgManage.orgType")}</dt>
                    <dd className="font-medium">{o.orgType}</dd>
                    <dt className="text-muted-foreground">{t("orgManage.lifecycleLabel")}</dt>
                    <dd className="font-medium">{t(`orgManage.lifecycle.${o.lifecycleStatus}`)}</dd>
                    <dt className="text-muted-foreground">{t("orgManage.createdAtLabel")}</dt>
                    <dd className="font-medium">{formatDisplayDateTime(o.createdAt)}</dd>
                    <dt className="text-muted-foreground">{t("orgManage.advisorIdLabel")}</dt>
                    <dd className="truncate font-mono text-[11px]" title={o.advisorUserId ?? ""}>
                      {o.advisorUserId ? `${o.advisorUserId.slice(0, 8)}…` : "—"}
                    </dd>
                  </dl>
                  <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <select
                      className="rounded border border-input bg-background px-2 py-1 text-xs"
                      value={lcTarget[o.id] ?? o.lifecycleStatus}
                      onChange={(e) =>
                        setLcTarget((prev) => ({ ...prev, [o.id]: e.target.value }))
                      }
                    >
                      {LIFECYCLE.map((s) => (
                        <option key={s} value={s}>
                          {t(`orgManage.lifecycle.${s}`)}
                        </option>
                      ))}
                    </select>
                    <input
                      className="max-w-[160px] rounded border border-input bg-background px-2 py-1 text-xs"
                      placeholder={t("orgManage.reasonOptional")}
                      value={lcReason[o.id] ?? ""}
                      onChange={(e) =>
                        setLcReason((prev) => ({ ...prev, [o.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy || (lcTarget[o.id] ?? o.lifecycleStatus) === o.lifecycleStatus}
                      onClick={() => void applyLifecycle(o.id)}
                    >
                      {t("orgManage.applyLifecycle")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {isLeague ? (
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-medium">{t("orgManage.pendingRevisions")}</h2>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => void loadRevisions()}>
              {t("orgManage.refresh")}
            </button>
          </div>
          {revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("orgManage.noPendingRevisions")}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {revisions.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3">
                  <div className="font-medium">
                    {r.orgNameShort} · {formatDisplayDateTime(r.createdAt)}
                  </div>
                  <pre className="mt-2 max-h-28 overflow-auto rounded bg-muted/50 p-2 text-xs">
                    {JSON.stringify(r.payload, null, 2)}
                  </pre>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy}
                      onClick={() => void approveRevision(r.id)}
                    >
                      {t("orgManage.approve")}
                    </button>
                    <button
                      type="button"
                      className={btnDanger}
                      disabled={busy}
                      onClick={() => {
                        setRejectFor(r.id);
                        setRejectReason("");
                      }}
                    >
                      {t("orgManage.reject")}
                    </button>
                  </div>
                  {rejectFor === r.id ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <textarea
                        className={inputClass}
                        rows={2}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder={t("orgManage.rejectReasonPlaceholder")}
                      />
                      <button
                        type="button"
                        className={btnDanger}
                        disabled={busy}
                        onClick={() => void confirmRejectRevision(r.id)}
                      >
                        {t("orgManage.confirmReject")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {canOfficerSection ? (
        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium">{t("orgManage.officerSection")}</h2>
          <label className="mb-3 block text-sm">
            <span className="text-muted-foreground">{t("orgManage.selectOrg")}</span>
            <select
              className="mt-1 block rounded border border-input bg-background px-2 py-1.5 text-sm"
              value={officerOrgId}
              onChange={(e) => setOfficerOrgId(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.orgId} value={m.orgId}>
                  {m.nameShort}
                  {m.title ? ` (${m.title})` : ""}
                </option>
              ))}
            </select>
          </label>

          {orgDetail ? (
            <div className="flex flex-col gap-6 border-t border-border pt-4">
              <div>
                <h3 className="mb-2 font-medium">{t("orgManage.revisionDraft")}</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("orgManage.revisionHint")}
                </p>
                <div className="grid max-w-lg gap-2">
                  <input
                    className={inputClass}
                    value={revNameFull}
                    onChange={(e) => setRevNameFull(e.target.value)}
                    placeholder={t("orgManage.nameFull")}
                  />
                  <input
                    className={inputClass}
                    value={revNameShort}
                    onChange={(e) => setRevNameShort(e.target.value)}
                    placeholder={t("orgManage.nameShort")}
                  />
                  <input
                    className={inputClass}
                    value={revOrgType}
                    onChange={(e) => setRevOrgType(e.target.value)}
                    placeholder={t("orgManage.orgType")}
                  />
                  <input
                    className={inputClass}
                    value={revLogoUrl}
                    onChange={(e) => setRevLogoUrl(e.target.value)}
                    placeholder={t("orgManage.logoUrl")}
                  />
                  <button
                    type="button"
                    className={`${btnPrimary} w-fit`}
                    disabled={busy}
                    onClick={() => void submitRevision()}
                  >
                    {t("orgManage.submitRevision")}
                  </button>
                </div>
              </div>

              <div>
                <h3 className="mb-2 font-medium">{t("orgManage.advisor")}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={inputClass}
                    value={advisorField}
                    onChange={(e) => setAdvisorField(e.target.value)}
                    placeholder={t("orgManage.advisorUserId")}
                  />
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={busy}
                    onClick={() => {
                      const u = advisorField.trim();
                      void saveAdvisor(u === "" ? null : u);
                    }}
                  >
                    {t("orgManage.saveAdvisor")}
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={busy}
                    onClick={() => void saveAdvisor(null)}
                  >
                    {t("orgManage.clearAdvisor")}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <input
                    className="max-w-xs rounded border border-input bg-background px-2 py-1 text-sm"
                    value={instrQuery}
                    onChange={(e) => setInstrQuery(e.target.value)}
                    placeholder={t("orgManage.instructorSearch")}
                  />
                  <button type="button" className={btnGhost} disabled={busy} onClick={() => void searchInstructors()}>
                    {t("orgManage.search")}
                  </button>
                </div>
                {instrHits.length > 0 ? (
                  <ul className="mt-2 max-w-lg rounded border border-border text-xs">
                    {instrHits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          className="w-full px-2 py-1 text-left hover:bg-muted"
                          onClick={() => setAdvisorField(h.id)}
                        >
                          {h.displayName} · {h.id.slice(0, 8)}…
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div>
                <h3 className="mb-2 font-medium">{t("orgManage.addMember")}</h3>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={inputClass}
                    value={memberUserId}
                    onChange={(e) => setMemberUserId(e.target.value)}
                    placeholder={t("orgManage.memberUserId")}
                  />
                  <input
                    className={inputClass}
                    value={memberTitle}
                    onChange={(e) => setMemberTitle(e.target.value)}
                    placeholder={t("orgManage.memberTitle")}
                  />
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => void addMember()}>
                    {t("orgManage.addMemberBtn")}
                  </button>
                </div>
              </div>

              <div>
                <h3 className="mb-2 font-medium">{t("orgManage.leadershipLog")}</h3>
                {events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("orgManage.noEvents")}</p>
                ) : (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {events.map((ev) => (
                      <li key={ev.id} className="rounded bg-muted/40 px-2 py-1">
                        {ev.changeKind} · {formatDisplayDateTime(ev.createdAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
