import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";
import { formatDisplayDateTime } from "../lib/format-date";
import { uploadImageFile } from "../lib/upload-image";
import { useSession } from "../state/session";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateTimeLocalValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(s: string): Date {
  return new Date(s);
}

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
  organizationBefore?: {
    nameFull: string;
    nameShort: string;
    orgType: string;
    logoUrl: string | null;
  };
  status: string;
  payload: unknown;
  createdAt: string;
};

function PendingRevisionDiff({
  organizationBefore,
  payload,
}: {
  organizationBefore: NonNullable<RevisionRow["organizationBefore"]>;
  payload: unknown;
}) {
  const { t } = useTranslation("common");
  const fieldDefs = [
    { key: "nameFull" as const, labelKey: "orgManage.nameFull" },
    { key: "nameShort" as const, labelKey: "orgManage.nameShort" },
    { key: "orgType" as const, labelKey: "orgManage.orgType" },
    { key: "logoUrl" as const, labelKey: "orgManage.logoUrl" },
  ];
  if (payload == null || typeof payload !== "object") {
    return (
      <p className="mt-2 text-xs text-muted-foreground">{t("orgManage.revisionPayloadInvalid")}</p>
    );
  }
  const p = payload as Record<string, unknown>;
  const rows: { label: string; before: string; after: string }[] = [];
  for (const f of fieldDefs) {
    if (!(f.key in p)) continue;
    const beforeRaw = organizationBefore[f.key];
    const before =
      f.key === "logoUrl"
        ? beforeRaw == null || beforeRaw === ""
          ? "—"
          : String(beforeRaw)
        : String(beforeRaw ?? "—");
    const rawAfter = p[f.key];
    const after =
      rawAfter === null || (f.key === "logoUrl" && rawAfter === "")
        ? "—"
        : typeof rawAfter === "string"
          ? rawAfter
          : String(rawAfter);
    rows.push({ label: t(f.labelKey), before, after });
  }
  if (rows.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">{t("orgManage.revisionNoFields")}</p>
    );
  }
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="border-b border-border px-2 py-1.5 font-medium">
              {t("orgManage.revisionColField")}
            </th>
            <th className="border-b border-border px-2 py-1.5 font-medium">
              {t("orgManage.revisionColBefore")}
            </th>
            <th className="border-b border-border px-2 py-1.5 font-medium">
              {t("orgManage.revisionColAfter")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="border-b border-border/80 px-2 py-1.5 align-top text-muted-foreground">
                {row.label}
              </td>
              <td className="border-b border-border/80 px-2 py-1.5 align-top">{row.before}</td>
              <td className="border-b border-border/80 px-2 py-1.5 align-top font-medium text-foreground">
                {row.after}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

function SearchableScrollBox(props: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  children: ReactNode;
}) {
  const { search, onSearchChange, searchPlaceholder, children } = props;
  return (
    <div className="mt-1 rounded-md border border-border bg-background">
      <input
        className="w-full border-b border-border bg-transparent px-2 py-1.5 text-sm outline-none"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
      />
      <div className="max-h-40 overflow-y-auto">{children}</div>
    </div>
  );
}

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
  const [memberPickLabel, setMemberPickLabel] = useState("");
  const [memberTitle, setMemberTitle] = useState("");
  const [events, setEvents] = useState<LeadershipEvent[]>([]);
  const [instrQuery, setInstrQuery] = useState("");
  const [instrHits, setInstrHits] = useState<Array<{ id: string; displayName: string; email: string }>>([]);
  const [orgPickSearch, setOrgPickSearch] = useState("");
  const [assigneeSearchQ, setAssigneeSearchQ] = useState("");
  const [assigneeHits, setAssigneeHits] = useState<
    Array<{ id: string; displayName: string; email: string; volunteerNumber: string | null }>
  >([]);
  const [assigneeMeta, setAssigneeMeta] = useState<Record<string, string>>({});
  const [memberSearchQ, setMemberSearchQ] = useState("");
  const [memberHits, setMemberHits] = useState<
    Array<{ id: string; displayName: string; email: string; volunteerNumber: string | null }>
  >([]);

  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const instrSearchTimer = useRef<number | null>(null);
  const assigneeSearchTimer = useRef<number | null>(null);
  const memberSearchTimer = useRef<number | null>(null);

  const [taskKind, setTaskKind] = useState<"single" | "cross" | "transfer">("single");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskTimelineAudience, setTaskTimelineAudience] = useState<"org_members" | "all_students">(
    "org_members",
  );
  const [taskStarts, setTaskStarts] = useState(() => toDateTimeLocalValue(new Date()));
  const [taskEnds, setTaskEnds] = useState(() =>
    toDateTimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [directoryOrgs, setDirectoryOrgs] = useState<OrgJson[]>([]);
  const [involvedOrgIds, setInvolvedOrgIds] = useState<string[]>([]);
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (memberships.length > 0 && !officerOrgId) {
      setOfficerOrgId(memberships[0]!.orgId);
    }
  }, [memberships, officerOrgId]);

  useEffect(() => {
    if (officerOrgId) {
      setInvolvedOrgIds([officerOrgId]);
    }
  }, [officerOrgId]);

  useEffect(() => {
    if (!canOfficerSection) return;
    void (async () => {
      const res = await apiFetch("/orgs");
      if (res.ok) {
        const body = await readJson<{ organizations: OrgJson[] }>(res);
        setDirectoryOrgs(body.organizations);
      }
    })();
  }, [canOfficerSection]);

  useEffect(() => {
    if (!canOfficerSection) return;
    if (instrSearchTimer.current != null) window.clearTimeout(instrSearchTimer.current);
    instrSearchTimer.current = window.setTimeout(() => {
      instrSearchTimer.current = null;
      void (async () => {
        const res = await apiFetch(
          `/directory/instructors?browse=1&q=${encodeURIComponent(instrQuery)}&limit=50`,
        );
        if (!res.ok) return;
        const body = await readJson<{
          users: Array<{ id: string; displayName: string; email: string }>;
        }>(res);
        setInstrHits(body.users);
      })();
    }, 280);
    return () => {
      if (instrSearchTimer.current != null) window.clearTimeout(instrSearchTimer.current);
    };
  }, [instrQuery, canOfficerSection]);

  useEffect(() => {
    if (!canOfficerSection) return;
    if (assigneeSearchTimer.current != null) window.clearTimeout(assigneeSearchTimer.current);
    assigneeSearchTimer.current = window.setTimeout(() => {
      assigneeSearchTimer.current = null;
      void (async () => {
        const res = await apiFetch(
          `/directory/students?browse=1&q=${encodeURIComponent(assigneeSearchQ)}&limit=50`,
        );
        if (!res.ok) return;
        const body = await readJson<{
          users: Array<{
            id: string;
            displayName: string;
            email: string;
            volunteerNumber: string | null;
          }>;
        }>(res);
        setAssigneeHits(body.users);
      })();
    }, 280);
    return () => {
      if (assigneeSearchTimer.current != null) window.clearTimeout(assigneeSearchTimer.current);
    };
  }, [assigneeSearchQ, canOfficerSection]);

  useEffect(() => {
    if (!canOfficerSection) return;
    if (memberSearchTimer.current != null) window.clearTimeout(memberSearchTimer.current);
    memberSearchTimer.current = window.setTimeout(() => {
      memberSearchTimer.current = null;
      void (async () => {
        const res = await apiFetch(
          `/directory/students?browse=1&q=${encodeURIComponent(memberSearchQ)}&limit=50`,
        );
        if (!res.ok) return;
        const body = await readJson<{
          users: Array<{
            id: string;
            displayName: string;
            email: string;
            volunteerNumber: string | null;
          }>;
        }>(res);
        setMemberHits(body.users);
      })();
    }, 280);
    return () => {
      if (memberSearchTimer.current != null) window.clearTimeout(memberSearchTimer.current);
    };
  }, [memberSearchQ, canOfficerSection]);

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
    setTaskTitle("");
    setTaskDescription("");
    setTaskKind("single");
    setTaskTimelineAudience("org_members");
    const now = new Date();
    setTaskStarts(toDateTimeLocalValue(now));
    setTaskEnds(toDateTimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000)));
    setInvolvedOrgIds([orgId]);
    setAssigneeUserIds([]);
    setAssigneeMeta({});
    setMemberUserId("");
    setMemberPickLabel("");
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

  const submitOrgTask = async () => {
    if (!officerOrgId || !orgDetail) return;
    if (orgDetail.lifecycleStatus !== "active") {
      setError(t("orgManage.orgTimelineInactive"));
      return;
    }
    const title = taskTitle.trim();
    if (!title) return;
    const involved = [...new Set(involvedOrgIds)];
    if (!involved.includes(officerOrgId)) {
      setError(t("orgManage.orgTaskInvolvedMustIncludeSelf"));
      return;
    }
    const assignees = [...new Set(assigneeUserIds)];
    const starts = fromDateTimeLocal(taskStarts);
    const ends = fromDateTimeLocal(taskEnds);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || starts >= ends) {
      setError(t("timeline.errorInvalidRange"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/orgs/${officerOrgId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          kind: taskKind,
          title,
          description: taskDescription.trim() === "" ? null : taskDescription.trim(),
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
          involvedOrgIds: involved,
          assigneeUserIds: assignees.length > 0 ? assignees : undefined,
          timelineAudience: taskTimelineAudience,
        }),
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

  const pickLogoFile = () => logoFileRef.current?.click();

  const onLogoFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadImageFile(f);
      setRevLogoUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
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
      setMemberPickLabel("");
      setMemberTitle("");
      await loadOfficerOrg(officerOrgId);
    } finally {
      setBusy(false);
    }
  };

  const filteredDirectoryOrgs = useMemo(() => {
    const q = orgPickSearch.trim().toLowerCase();
    if (!q) return directoryOrgs;
    return directoryOrgs.filter(
      (o) => o.nameShort.toLowerCase().includes(q) || o.nameFull.toLowerCase().includes(q),
    );
  }, [directoryOrgs, orgPickSearch]);

  const toggleInvolvedOrg = (orgIdToggle: string) => {
    setInvolvedOrgIds((prev) => {
      if (prev.includes(orgIdToggle)) {
        if (orgIdToggle === officerOrgId) return prev;
        return prev.filter((x) => x !== orgIdToggle);
      }
      return [...prev, orgIdToggle];
    });
  };

  const addTaskAssignee = (id: string, displayName: string) => {
    setAssigneeUserIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setAssigneeMeta((m) => ({ ...m, [id]: displayName }));
  };

  const removeTaskAssignee = (id: string) => {
    setAssigneeUserIds((prev) => prev.filter((x) => x !== id));
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
                  {r.organizationBefore ? (
                    <PendingRevisionDiff organizationBefore={r.organizationBefore} payload={r.payload} />
                  ) : (
                    <pre className="mt-2 max-h-28 overflow-auto rounded bg-muted/50 p-2 text-xs">
                      {JSON.stringify(r.payload, null, 2)}
                    </pre>
                  )}
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
                  <input type="file" accept="image/*" className="hidden" ref={logoFileRef} onChange={(e) => void onLogoFileChange(e)} />
                  <div className="flex max-w-lg flex-wrap items-end gap-2">
                    <input
                      className={`${inputClass} min-w-[12rem] flex-1`}
                      value={revLogoUrl}
                      onChange={(e) => setRevLogoUrl(e.target.value)}
                      placeholder={t("orgManage.logoUrl")}
                    />
                    <button type="button" className={btnGhost} disabled={busy} onClick={pickLogoFile}>
                      {t("uploadImage")}
                    </button>
                  </div>
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
                <h3 className="mb-2 font-medium">{t("orgManage.orgTaskPublishTitle")}</h3>
                <p className="mb-2 text-xs text-muted-foreground">{t("orgManage.orgTaskPublishHint")}</p>
                {orgDetail.lifecycleStatus !== "active" ? (
                  <p className="text-sm text-muted-foreground">{t("orgManage.orgTimelineInactive")}</p>
                ) : (
                  <div className="grid max-w-lg gap-2">
                    <label className="text-xs text-muted-foreground">
                      {t("oa.filters.kind")}
                      <select
                        className={`${inputClass} mt-1`}
                        value={taskKind}
                        onChange={(e) => setTaskKind(e.target.value as typeof taskKind)}
                      >
                        <option value="single">{t("oa.taskKind.single")}</option>
                        <option value="cross">{t("oa.taskKind.cross")}</option>
                        <option value="transfer">{t("oa.taskKind.transfer")}</option>
                      </select>
                    </label>
                    <input
                      className={inputClass}
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder={t("orgManage.orgTaskTitlePlaceholder")}
                    />
                    <textarea
                      className={`${inputClass} min-h-[4rem]`}
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                      placeholder={t("orgManage.orgTaskDescriptionPlaceholder")}
                    />
                    <fieldset className="flex flex-col gap-2 text-xs">
                      <legend className="mb-1 text-muted-foreground">{t("orgManage.taskTimelineAudienceLabel")}</legend>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="tl-aud"
                          checked={taskTimelineAudience === "org_members"}
                          onChange={() => setTaskTimelineAudience("org_members")}
                        />
                        {t("orgManage.taskTimelineAudienceOrgMembers")}
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="tl-aud"
                          checked={taskTimelineAudience === "all_students"}
                          onChange={() => setTaskTimelineAudience("all_students")}
                        />
                        {t("orgManage.taskTimelineAudienceAllStudents")}
                      </label>
                    </fieldset>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {t("orgManage.orgTimelineStarts")}
                        <input
                          type="datetime-local"
                          className={inputClass}
                          value={taskStarts}
                          onChange={(e) => setTaskStarts(e.target.value)}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        {t("orgManage.orgTimelineEnds")}
                        <input
                          type="datetime-local"
                          className={inputClass}
                          value={taskEnds}
                          onChange={(e) => setTaskEnds(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t("orgManage.orgTaskInvolvedHint")}</span>
                      <SearchableScrollBox
                        search={orgPickSearch}
                        onSearchChange={setOrgPickSearch}
                        searchPlaceholder={t("orgManage.pickOrgFilter")}
                      >
                        {filteredDirectoryOrgs.length === 0 ? (
                          <p className="px-2 py-2 text-muted-foreground">{t("orgManage.pickOrgEmpty")}</p>
                        ) : (
                          <ul className="divide-y divide-border text-sm">
                            {filteredDirectoryOrgs.map((o) => (
                              <li key={o.id}>
                                <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted">
                                  <input
                                    type="checkbox"
                                    checked={involvedOrgIds.includes(o.id)}
                                    onChange={() => toggleInvolvedOrg(o.id)}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="font-medium">{o.nameShort}</span>
                                    <span className="ml-1 text-muted-foreground">{o.nameFull}</span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        )}
                      </SearchableScrollBox>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t("orgManage.orgTaskAssigneesHint")}</span>
                      {assigneeUserIds.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {assigneeUserIds.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs hover:bg-muted"
                              onClick={() => removeTaskAssignee(id)}
                            >
                              {assigneeMeta[id] ?? id.slice(0, 8) + "…"} ×
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <SearchableScrollBox
                        search={assigneeSearchQ}
                        onSearchChange={setAssigneeSearchQ}
                        searchPlaceholder={t("orgManage.pickStudentFilter")}
                      >
                        {assigneeHits.length === 0 ? (
                          <p className="px-2 py-2 text-muted-foreground">{t("orgManage.pickStudentEmpty")}</p>
                        ) : (
                          <ul className="divide-y divide-border text-sm">
                            {assigneeHits.map((u) => (
                              <li key={u.id}>
                                <button
                                  type="button"
                                  disabled={assigneeUserIds.includes(u.id)}
                                  className="w-full px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                  onClick={() => addTaskAssignee(u.id, u.displayName)}
                                >
                                  <span className="font-medium">{u.displayName}</span>
                                  <span className="ml-1 text-muted-foreground">{u.email}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </SearchableScrollBox>
                    </div>
                    <button
                      type="button"
                      className={`${btnPrimary} w-fit`}
                      disabled={busy}
                      onClick={() => void submitOrgTask()}
                    >
                      {t("orgManage.orgTaskSubmit")}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 font-medium">{t("orgManage.advisor")}</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  {advisorField.trim()
                    ? t("orgManage.advisorSelectedHint", {
                        id: advisorField.trim().slice(0, 8) + "…",
                      })
                    : t("orgManage.advisorNone")}
                </p>
                <div className="mb-3 flex flex-wrap items-center gap-2">
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
                <p className="mb-1 text-xs font-medium text-foreground">{t("orgManage.pickInstructorTitle")}</p>
                <SearchableScrollBox
                  search={instrQuery}
                  onSearchChange={setInstrQuery}
                  searchPlaceholder={t("orgManage.instructorSearchBrowse")}
                >
                  {instrHits.length === 0 ? (
                    <p className="px-2 py-2 text-muted-foreground">{t("orgManage.pickInstructorEmpty")}</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {instrHits.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            className="w-full px-2 py-1.5 text-left hover:bg-muted"
                            onClick={() => setAdvisorField(h.id)}
                          >
                            <span className="font-medium">{h.displayName}</span>
                            <span className="ml-1 text-muted-foreground">{h.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </SearchableScrollBox>
              </div>

              <div>
                <h3 className="mb-2 font-medium">{t("orgManage.addMember")}</h3>
                <p className="mb-1 text-xs text-muted-foreground">
                  {memberUserId.trim()
                    ? t("orgManage.memberSelectedHint", {
                        label: memberPickLabel || memberUserId.slice(0, 8) + "…",
                      })
                    : t("orgManage.memberPickHint")}
                </p>
                <SearchableScrollBox
                  search={memberSearchQ}
                  onSearchChange={setMemberSearchQ}
                  searchPlaceholder={t("orgManage.pickStudentFilter")}
                >
                  {memberHits.length === 0 ? (
                    <p className="px-2 py-2 text-muted-foreground">{t("orgManage.pickStudentEmpty")}</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {memberHits.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            className="w-full px-2 py-1.5 text-left hover:bg-muted"
                            onClick={() => {
                              setMemberUserId(u.id);
                              setMemberPickLabel(u.displayName);
                            }}
                          >
                            <span className="font-medium">{u.displayName}</span>
                            <span className="ml-1 text-muted-foreground">{u.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </SearchableScrollBox>
                <div className="mt-2 flex flex-wrap gap-2">
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
