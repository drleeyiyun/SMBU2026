import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";
import { useSession } from "../state/session";

const BASIC_KEYS = ["name", "phone", "wechat", "email", "github", "weibo"] as const;
const LOCALES = ["zh", "en", "ru"] as const;

type BasicTri = { zh?: string; en?: string; ru?: string };
type BasicI18n = Partial<Record<(typeof BASIC_KEYS)[number], BasicTri>>;

type RosterRow = {
  userId: string;
  displayName: string | null;
  email: string;
  studentNo: string | null;
  department: string | null;
  major: string | null;
  grade: string | null;
  basicAuditStatus: string;
  identityAuditStatus: string;
  profileAuditStatus: string;
};

type PendingRow = {
  userId: string;
  displayName: string | null;
  email: string;
  studentNo: string | null;
  studentNoDraft: string | null;
  department: string | null;
  major: string | null;
  grade: string | null;
  basicAuditStatus: string;
  basicI18nPublished: BasicI18n;
  basicI18nDraft: BasicI18n | null;
};

type IdentitySnap = {
  nationality: string;
  idNumber: string;
  grade: string;
  department: string;
  major: string;
  className: string;
  idPhotoUrl: string | null;
  portraitUrl: string | null;
  volunteerNumber: string;
};

type PendingIdentityRow = {
  userId: string;
  displayName: string | null;
  email: string;
  studentNo: string | null;
  identityPublished: IdentitySnap;
  identityDraft: IdentitySnap | null;
};

type PendingAwardRow = {
  id: string;
  userId: string;
  title: string;
  proofUrl: string | null;
  createdAt: string;
  studentDisplayName: string | null;
  studentNo: string | null;
};

type PendingVolunteerClaimRow = {
  userId: string;
  coordinationEventId: string;
  eventTitle: string;
  claimedHours: number | null;
  /** 通过后计入时长（申报优先） */
  resolvedHours: number;
  /** 活动基础时长，与统筹「基础义工时」或起止推算一致 */
  referenceBaseHours: number;
  createdAt: string;
  studentDisplayName: string | null;
  studentNo: string | null;
  volunteerNumber: string;
};

type AuditRow = {
  id: string;
  userId: string;
  studentDisplayName: string | null;
  payload: unknown;
  createdAt: string;
};

type DetailUser = { id: string; email: string; displayName: string | null };

type AwardDetail = {
  id: string;
  title: string;
  proofUrl: string | null;
  status: string;
  reason: string | null;
  decidedAt: string | null;
  createdAt: string;
};

type AbilityCategory = "technical" | "planning" | "management" | "sports";

type ArchiveDetail = {
  user: DetailUser;
  profile: {
    userId: string;
    studentNo: string | null;
    studentNoDraft: string | null;
    volunteerNumber: string | null;
    nationality: string | null;
    idNumber: string | null;
    grade: string | null;
    department: string | null;
    major: string | null;
    className: string | null;
    idPhotoUrl: string | null;
    portraitUrl: string | null;
    phone: string | null;
    wechat: string | null;
    github: string | null;
    weibo: string | null;
    basicAuditStatus: string;
    basicAuditReason: string | null;
    basicI18nPublished: BasicI18n;
    basicI18nDraft: BasicI18n | null;
    identityDraft: IdentitySnap | null;
    identityAuditStatus: string;
    identityAuditReason: string | null;
  };
  identityComplete: boolean;
  abilityTags: { id: string; category: string; label: string }[];
  abilityTagsByCategory: Record<AbilityCategory, { id: string; label: string }[]>;
  awards: AwardDetail[];
  myAwards: AwardDetail[];
  publicAwards: AwardDetail[];
  volunteerSummary: {
    totalHours: number;
    records: {
      id: string;
      title: string;
      hours: number;
      source: string;
      externalRef: string | null;
      occurredAt: string;
    }[];
    claims: {
      coordinationEventId: string;
      eventTitle: string;
      claimedHours: number | null;
      resolvedHours: number;
      auditStatus: string;
      rejectReason: string | null;
      createdAt: string;
    }[];
  };
};

function basicDiffRows(published: BasicI18n, draft: BasicI18n | null): { field: string; loc: string; before: string; after: string }[] {
  if (!draft) return [];
  const out: { field: string; loc: string; before: string; after: string }[] = [];
  for (const field of BASIC_KEYS) {
    for (const loc of LOCALES) {
      const b = published[field]?.[loc] ?? "";
      const a = draft[field]?.[loc] ?? "";
      if (b !== a) {
        out.push({ field, loc, before: b || "—", after: a || "—" });
      }
    }
  }
  return out;
}

const IDENTITY_DIFF_KEYS = [
  "nationality",
  "idNumber",
  "grade",
  "department",
  "major",
  "className",
  "idPhotoUrl",
  "portraitUrl",
  "volunteerNumber",
] as const;

function identityDiffRows(
  before: IdentitySnap,
  after: IdentitySnap | null,
): { key: (typeof IDENTITY_DIFF_KEYS)[number]; before: string; after: string }[] {
  if (!after) return [];
  const out: { key: (typeof IDENTITY_DIFF_KEYS)[number]; before: string; after: string }[] = [];
  for (const k of IDENTITY_DIFF_KEYS) {
    const b = before[k] == null || before[k] === "" ? "—" : String(before[k]);
    const a = after[k] == null || after[k] === "" ? "—" : String(after[k]);
    if (b !== a) out.push({ key: k, before: b, after: a });
  }
  return out;
}

export default function LeagueArchivePage() {
  const { t } = useTranslation("common");
  const { user } = useSession();
  const allowed = user?.roles.includes("league_admin") ?? false;

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterQ, setRosterQ] = useState("");
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [pendingIdentity, setPendingIdentity] = useState<PendingIdentityRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reasonByUser, setReasonByUser] = useState<Record<string, string>>({});
  const [reasonIdentityByUser, setReasonIdentityByUser] = useState<Record<string, string>>({});
  const [reasonByAward, setReasonByAward] = useState<Record<string, string>>({});
  const [pendingAwards, setPendingAwards] = useState<PendingAwardRow[]>([]);
  const [pendingVolunteerClaims, setPendingVolunteerClaims] = useState<PendingVolunteerClaimRow[]>([]);
  const [reasonByVolunteerClaim, setReasonByVolunteerClaim] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const rosterQRef = useRef(rosterQ);
  rosterQRef.current = rosterQ;

  const fieldLabel = useCallback(
    (k: string) => t(`leagueArchive.f_${k}` as "leagueArchive.f_name"),
    [t],
  );
  const locLabel = useCallback(
    (loc: string) => t(`leagueArchive.loc_${loc}` as "leagueArchive.loc_zh"),
    [t],
  );

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    const q = rosterQRef.current.trim();
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    const [rRes, pRes, piRes, vcRes, awRes, aRes] = await Promise.all([
      apiFetch(`/league/archive/students${qs}`),
      apiFetch("/league/archive/pending"),
      apiFetch("/league/archive/pending-identity"),
      apiFetch("/league/archive/volunteer-claims/pending"),
      apiFetch("/league/archive/awards/pending"),
      apiFetch("/league/archive/audit-log?limit=30"),
    ]);
    if (!rRes.ok) {
      setError(await readErrorMessage(rRes));
      return;
    }
    if (!pRes.ok) {
      setError(await readErrorMessage(pRes));
      return;
    }
    if (!piRes.ok) {
      setError(await readErrorMessage(piRes));
      return;
    }
    if (!vcRes.ok) {
      setError(await readErrorMessage(vcRes));
      return;
    }
    if (!awRes.ok) {
      setError(await readErrorMessage(awRes));
      return;
    }
    if (!aRes.ok) {
      setError(await readErrorMessage(aRes));
      return;
    }
    const rBody = await readJson<{ items: RosterRow[] }>(rRes);
    const pBody = await readJson<{ items: PendingRow[] }>(pRes);
    const piBody = await readJson<{ items: PendingIdentityRow[] }>(piRes);
    const vcBody = await readJson<{ items: PendingVolunteerClaimRow[] }>(vcRes);
    const awBody = await readJson<{ items: PendingAwardRow[] }>(awRes);
    const aBody = await readJson<{ items: AuditRow[] }>(aRes);
    setRoster(rBody.items);
    setPending(pBody.items);
    setPendingIdentity(piBody.items);
    setPendingVolunteerClaims(vcBody.items);
    setPendingAwards(awBody.items);
    setAudit(aBody.items);
  }, [allowed]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const openDetail = async (userId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await apiFetch(`/league/archive/students/${userId}`);
      if (!res.ok) {
        setMsg(await readErrorMessage(res));
        return;
      }
      const body = await readJson<ArchiveDetail>(res);
      setDetail(body);
    } finally {
      setDetailLoading(false);
    }
  };

  async function decide(
    userId: string,
    action: "approve" | "reject",
    scope: "profile_basic" | "profile_identity",
  ) {
    setMsg(null);
    const reasonMap = scope === "profile_basic" ? reasonByUser : reasonIdentityByUser;
    const setReasonMap = scope === "profile_basic" ? setReasonByUser : setReasonIdentityByUser;
    const reason = reasonMap[userId]?.trim() ?? "";
    if (action === "reject" && !reason) {
      setMsg(t("leagueArchive.reason"));
      return;
    }
    const res = await apiFetch(`/archive/reviews/${userId}`, {
      method: "POST",
      body: JSON.stringify({
        action,
        scope,
        reason: action === "reject" ? reason : undefined,
      }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setReasonMap((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    if (detail?.user.id === userId) {
      await openDetail(userId);
    }
    await load();
  }

  const auditLabels = useMemo(
    () =>
      ({
        profile_basic: t("leagueArchive.profileBasic"),
        profile_identity: t("leagueArchive.profileIdentity"),
        profile: t("notifications.archiveContact"),
        award: t("notifications.archiveAward"),
      }) as Record<string, string>,
    [t],
  );

  const identityFieldLabel = useCallback(
    (k: string) => t(`archive.identityLabels.${k}` as "archive.identityLabels.nationality"),
    [t],
  );

  function volunteerClaimKey(userId: string, coordinationEventId: string) {
    return `${userId}:${coordinationEventId}`;
  }

  async function reviewVolunteerClaim(
    userId: string,
    coordinationEventId: string,
    action: "approve" | "reject",
  ) {
    setMsg(null);
    const key = volunteerClaimKey(userId, coordinationEventId);
    const reason = reasonByVolunteerClaim[key]?.trim() ?? "";
    if (action === "reject" && !reason) {
      setMsg(t("leagueArchive.volunteerClaimRejectReason"));
      return;
    }
    const res = await apiFetch("/league/archive/volunteer-claims/review", {
      method: "POST",
      body: JSON.stringify({
        userId,
        coordinationEventId,
        action,
        reason: action === "reject" ? reason : undefined,
      }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setReasonByVolunteerClaim((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (detail?.user.id === userId) {
      await openDetail(userId);
    }
    await load();
  }

  async function reviewAward(awardId: string, action: "approve" | "reject") {
    setMsg(null);
    const reason = reasonByAward[awardId]?.trim() ?? "";
    if (action === "reject" && !reason) {
      setMsg(t("leagueArchive.awardRejectReason"));
      return;
    }
    const res = await apiFetch(`/archive/awards/${awardId}/review`, {
      method: "POST",
      body: JSON.stringify({ action, reason: action === "reject" ? reason : undefined }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setReasonByAward((prev) => {
      const next = { ...prev };
      delete next[awardId];
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

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.rosterTitle")}</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder={t("leagueArchive.searchPlaceholder")}
            value={rosterQ}
            onChange={(e) => setRosterQ(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("orgManage.refresh")}
          </button>
        </div>
        {roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueArchive.noStudents")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((row) => (
              <button
                key={row.userId}
                type="button"
                onClick={() => void openDetail(row.userId)}
                className="rounded-lg border border-border bg-background p-3 text-left text-sm shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <p className="font-medium">{row.displayName ?? row.userId.slice(0, 8)}</p>
                <p className="text-xs text-muted-foreground">{row.studentNo ?? "—"}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {[row.grade, row.department, row.major].filter(Boolean).join(" · ") || "—"}
                </p>
                <p className="mt-2 text-xs text-primary">{t("leagueArchive.viewDetail")}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.pendingVolunteerClaims")}</h2>
        {pendingVolunteerClaims.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueArchive.noPendingVolunteerClaims")}</p>
        ) : (
          <ul className="space-y-4">
            {pendingVolunteerClaims.map((row) => {
              const ck = volunteerClaimKey(row.userId, row.coordinationEventId);
              return (
                <li
                  key={ck}
                  className="rounded-lg border border-border bg-background p-4 text-sm shadow-sm"
                >
                  <p className="font-medium">{row.eventTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.studentDisplayName ?? row.userId.slice(0, 8)} · {t("archive.studentNo")}:{" "}
                    {row.studentNo ?? "—"} · {t("archive.identityLabels.volunteerNumber")}:{" "}
                    {row.volunteerNumber} · {formatDisplayDateTime(row.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("leagueArchive.volunteerClaimActivityId")}:{" "}
                    <code className="rounded bg-muted px-1 font-mono text-[11px]">{row.coordinationEventId}</code>
                  </p>
                  <p className="mt-1 text-xs">
                    {t("leagueArchive.volunteerClaimResolved")}: {row.referenceBaseHours}h
                    {row.claimedHours != null
                      ? ` · ${t("leagueArchive.volunteerClaimDeclared")}: ${row.claimedHours}h`
                      : null}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2"
                      placeholder={t("leagueArchive.reason")}
                      value={reasonByVolunteerClaim[ck] ?? ""}
                      onChange={(e) =>
                        setReasonByVolunteerClaim((prev) => ({ ...prev, [ck]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void reviewVolunteerClaim(row.userId, row.coordinationEventId, "approve")}
                      className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
                    >
                      {t("leagueArchive.approve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewVolunteerClaim(row.userId, row.coordinationEventId, "reject")}
                      className="rounded-md border border-destructive/50 px-3 py-2 font-medium text-destructive"
                    >
                      {t("leagueArchive.reject")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void openDetail(row.userId)}
                      className="rounded-md border border-border px-3 py-2 text-xs"
                    >
                      {t("leagueArchive.viewDetail")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.pendingAwards")}</h2>
        {pendingAwards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueArchive.noPendingAwards")}</p>
        ) : (
          <ul className="space-y-4">
            {pendingAwards.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-border bg-background p-4 text-sm shadow-sm"
              >
                <p className="font-medium">{row.title}</p>
                <p className="text-xs text-muted-foreground">
                  {row.studentDisplayName ?? row.userId.slice(0, 8)} · {t("archive.studentNo")}:{" "}
                  {row.studentNo ?? "—"} · {formatDisplayDateTime(row.createdAt)}
                </p>
                {row.proofUrl ? (
                  <p className="mt-1 break-all text-xs">
                    {t("archive.proofUrl")}:{" "}
                    <a href={row.proofUrl} className="text-primary underline" target="_blank" rel="noreferrer">
                      {row.proofUrl}
                    </a>
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2"
                    placeholder={t("leagueArchive.reason")}
                    value={reasonByAward[row.id] ?? ""}
                    onChange={(e) =>
                      setReasonByAward((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void reviewAward(row.id, "approve")}
                    className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
                  >
                    {t("leagueArchive.approve")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void reviewAward(row.id, "reject")}
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
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.pending")}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueArchive.noPending")}</p>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => {
              const rowsBasic = basicDiffRows(row.basicI18nPublished, row.basicI18nDraft);
              const snPub = (row.studentNo ?? "").trim();
              const snDr = (row.studentNoDraft ?? "").trim();
              const studentNoChanged = snDr !== snPub;
              return (
                <li
                  key={row.userId}
                  className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.displayName ?? row.userId}</p>
                      <p className="text-muted-foreground">
                        {row.studentNo ?? "—"} · {row.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs"
                      onClick={() => void openDetail(row.userId)}
                    >
                      {t("leagueArchive.viewDetail")}
                    </button>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">{t("leagueArchive.profileBasic")}</p>

                  {rowsBasic.length > 0 || studentNoChanged ? (
                    <div className="mt-3 rounded-md border border-border bg-muted/20 p-2">
                      <p className="mb-2 text-xs font-medium">{t("leagueArchive.basicDiff")}</p>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-border text-left text-muted-foreground">
                              <th className="p-1">{t("leagueArchive.diffField")}</th>
                              <th className="p-1">{t("leagueArchive.diffLocale")}</th>
                              <th className="p-1">{t("leagueArchive.before")}</th>
                              <th className="p-1">{t("leagueArchive.after")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {studentNoChanged ? (
                              <tr className="border-b border-border/60">
                                <td className="p-1 whitespace-nowrap">{t("archive.studentNo")}</td>
                                <td className="p-1 whitespace-nowrap">—</td>
                                <td className="p-1 text-muted-foreground">{snPub || "—"}</td>
                                <td className="p-1 font-medium">{snDr || "—"}</td>
                              </tr>
                            ) : null}
                            {rowsBasic.map((d) => (
                              <tr key={`${d.field}-${d.loc}`} className="border-b border-border/60">
                                <td className="p-1 whitespace-nowrap">{fieldLabel(d.field)}</td>
                                <td className="p-1 whitespace-nowrap">{locLabel(d.loc)}</td>
                                <td className="p-1 text-muted-foreground">{d.before}</td>
                                <td className="p-1 font-medium">{d.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
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
                      onClick={() => void decide(row.userId, "approve", "profile_basic")}
                      className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
                    >
                      {t("leagueArchive.approve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(row.userId, "reject", "profile_basic")}
                      className="rounded-md border border-destructive/50 px-3 py-2 font-medium text-destructive"
                    >
                      {t("leagueArchive.reject")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.pendingIdentity")}</h2>
        {pendingIdentity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leagueArchive.noPendingIdentity")}</p>
        ) : (
          <ul className="space-y-4">
            {pendingIdentity.map((row) => {
              const idRows = identityDiffRows(row.identityPublished, row.identityDraft);
              return (
                <li
                  key={row.userId}
                  className="rounded-lg border border-border bg-card p-4 text-sm shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.displayName ?? row.userId}</p>
                      <p className="text-muted-foreground">
                        {row.studentNo ?? "—"} · {row.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-xs"
                      onClick={() => void openDetail(row.userId)}
                    >
                      {t("leagueArchive.viewDetail")}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t("leagueArchive.profileIdentity")}</p>
                  {idRows.length > 0 ? (
                    <div className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/20 p-2">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="p-1">{t("leagueArchive.diffField")}</th>
                            <th className="p-1">{t("leagueArchive.before")}</th>
                            <th className="p-1">{t("leagueArchive.after")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {idRows.map((d) => (
                            <tr key={d.key} className="border-b border-border/60">
                              <td className="p-1 whitespace-nowrap">{identityFieldLabel(d.key)}</td>
                              <td className="p-1 break-all text-muted-foreground">{d.before}</td>
                              <td className="p-1 break-all font-medium">{d.after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2"
                      placeholder={t("leagueArchive.reason")}
                      value={reasonIdentityByUser[row.userId] ?? ""}
                      onChange={(e) =>
                        setReasonIdentityByUser((prev) => ({
                          ...prev,
                          [row.userId]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void decide(row.userId, "approve", "profile_identity")}
                      className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
                    >
                      {t("leagueArchive.approve")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(row.userId, "reject", "profile_identity")}
                      className="rounded-md border border-destructive/50 px-3 py-2 font-medium text-destructive"
                    >
                      {t("leagueArchive.reject")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">{t("leagueArchive.auditLog")}</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-2">{t("leagueArchive.auditTime")}</th>
                <th className="p-2">{t("leagueArchive.auditStudent")}</th>
                <th className="p-2">{t("notifications.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((r) => {
                const pl = r.payload as {
                  scope?: string;
                  action?: string;
                  reason?: string | null;
                  decidedAt?: string;
                };
                const scopeLabel = pl.scope ? (auditLabels[pl.scope] ?? pl.scope) : "—";
                const actionLabel =
                  pl.action === "approve"
                    ? t("notifications.actionApprove")
                    : pl.action === "reject"
                      ? t("notifications.actionReject")
                      : (pl.action ?? "—");
                return (
                  <tr key={r.id} className="border-b border-border">
                    <td className="p-2 whitespace-nowrap text-muted-foreground">
                      {formatDisplayDateTime(r.createdAt)}
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{r.studentDisplayName ?? r.userId.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{scopeLabel}</div>
                    </td>
                    <td className="p-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{actionLabel}</span>
                      {pl.reason ? (
                        <span className="mt-1 block text-xs text-muted-foreground">{pl.reason}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {detail || detailLoading ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t("leagueArchive.detailTitle")}
          onClick={() => setDetail(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{t("leagueArchive.detailTitle")}</h2>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetail(null);
                }}
              >
                {t("leagueArchive.close")}
              </button>
            </div>
            {detailLoading ? (
              <p className="text-sm text-muted-foreground">{t("archive.loading")}</p>
            ) : detail ? (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-border p-3">
                  <p className="font-medium">{detail.user.displayName ?? detail.user.id}</p>
                  <p className="text-muted-foreground">
                    {t("leagueArchive.studentEmail")}: {detail.user.email}
                  </p>
                  <p className="mt-1">
                    {t("archive.studentNo")}: {detail.profile.studentNo ?? "—"}
                    {detail.profile.studentNoDraft &&
                    detail.profile.studentNoDraft !== detail.profile.studentNo ? (
                      <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
                        ({t("leagueArchive.pendingDraft")}: {detail.profile.studentNoDraft})
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("archive.basicAudit")}: {detail.profile.basicAuditStatus}
                    {detail.profile.basicAuditReason
                      ? ` — ${detail.profile.basicAuditReason}`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("archive.identityAudit")}: {detail.profile.identityAuditStatus}
                    {detail.profile.identityAuditReason
                      ? ` — ${detail.profile.identityAuditReason}`
                      : ""}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {[detail.profile.grade, detail.profile.department, detail.profile.major]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1 text-xs">
                    GitHub: {detail.profile.github ?? "—"} · Weibo: {detail.profile.weibo ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("leagueArchive.phone")}: {detail.profile.phone ?? "—"} ·{" "}
                    {t("leagueArchive.wechat")}: {detail.profile.wechat ?? "—"}
                  </p>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 font-medium">{t("archive.basic")}</p>
                  <div className="space-y-3 text-xs">
                    {BASIC_KEYS.map((field) => (
                      <div key={field}>
                        <p className="mb-1 font-medium text-muted-foreground">{fieldLabel(field)}</p>
                        <div className="grid gap-1 sm:grid-cols-3">
                          {LOCALES.map((loc) => (
                            <div key={loc}>
                              <span className="text-muted-foreground">{loc}: </span>
                              {detail.profile.basicI18nPublished[field]?.[loc] ?? "—"}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {detail.profile.basicI18nDraft ? (
                    <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                      {t("leagueArchive.basicDraftPending")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("archive.identity")}</p>
                  <p className="mb-2">
                    {detail.identityComplete ? t("archive.identityComplete") : t("archive.identityIncomplete")}
                  </p>
                  <dl className="grid gap-1 text-xs sm:grid-cols-2">
                    {IDENTITY_DIFF_KEYS.map((k) => (
                      <div key={k} className="sm:col-span-2">
                        <dt className="text-muted-foreground">{identityFieldLabel(k)}</dt>
                        <dd className="break-all">
                          {String(detail.profile[k] ?? "—")}
                          {k === "idPhotoUrl" || k === "portraitUrl" ? (
                            detail.profile[k] ? (
                              <img
                                src={detail.profile[k]!}
                                alt=""
                                className="mt-1 h-24 max-w-xs rounded border border-border object-contain"
                              />
                            ) : null
                          ) : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {detail.profile.identityDraft ? (
                    <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                      {t("leagueArchive.identityDraftPending")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 font-medium">{t("archive.tags")}</p>
                  <ul className="space-y-1 text-xs">
                    {detail.abilityTags.map((tag) => (
                      <li key={tag.id}>
                        {tag.category}: {tag.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="mb-2 font-medium">{t("leagueArchive.awardsAll")}</p>
                  <ul className="space-y-2 text-xs">
                    {detail.myAwards.map((a) => (
                      <li key={a.id} className="border-b border-border/60 pb-2">
                        <span className="font-medium">{a.title}</span> — {a.status}
                        {a.proofUrl ? (
                          <a
                            href={a.proofUrl}
                            className="ml-1 text-primary underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("archive.proofUrl")}
                          </a>
                        ) : null}
                        {a.reason ? (
                          <span className="mt-1 block text-muted-foreground">{a.reason}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-border p-3">
                  <p className="font-medium">{t("archive.volunteer")}</p>
                  <p className="text-muted-foreground">
                    {t("archive.totalHours")}: {detail.volunteerSummary.totalHours}
                  </p>
                  {detail.volunteerSummary.records.length > 0 ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="p-1">{t("archive.volunteer")}</th>
                            <th className="p-1">{t("leagueArchive.volunteerHours")}</th>
                            <th className="p-1">{t("leagueArchive.volunteerWhen")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.volunteerSummary.records.map((r) => (
                            <tr key={r.id} className="border-b border-border/60">
                              <td className="p-1">{r.title}</td>
                              <td className="p-1">{r.hours}</td>
                              <td className="p-1 whitespace-nowrap">
                                {formatDisplayDateTime(r.occurredAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
