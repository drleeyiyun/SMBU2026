import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { AcademicDeptMajorSelects } from "../components/AcademicDeptMajorSelects";
import { StudentGradeSelect } from "../components/StudentGradeSelect";
import { normalizeDepartmentMajorSelection, normalizeStudentGradeSelection } from "academic-catalog";
import { apiBase, apiFetch, readErrorMessage, readJson } from "../lib/api";
import { uploadImageFile } from "../lib/upload-image";
import { formatDisplayDateTime } from "../lib/format-date";

type AbilityCategory = "technical" | "planning" | "management" | "sports";

type LocaleTri = { zh?: string; en?: string; ru?: string };

type IdentityDraftOut = {
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

type ProfileOut = {
  userId: string;
  studentNo: string | null;
  studentNoDraft: string | null;
  volunteerNumber: string;
  nationality: string;
  idNumber: string;
  grade: string;
  department: string;
  major: string;
  className: string;
  idPhotoUrl: string | null;
  portraitUrl: string | null;
  phone: string | null;
  wechat: string | null;
  github: string | null;
  weibo: string | null;
  basicI18nPublished: Record<string, LocaleTri>;
  basicI18nDraft: Record<string, LocaleTri> | null;
  basicAuditStatus: string;
  basicAuditReason: string | null;
  identityDraft: IdentityDraftOut | null;
  identityAuditStatus: string;
  identityAuditReason: string | null;
};

type AwardRow = {
  id: string;
  title: string;
  proofUrl: string | null;
  status: string;
  reason: string | null;
  decidedAt: string | null;
  createdAt: string;
};

type ArchiveMe = {
  profile: ProfileOut;
  identityComplete: boolean;
  abilityTagsByCategory: Record<AbilityCategory, { id: string; label: string }[]>;
  awards: AwardRow[];
  myAwards: AwardRow[];
  publicAwards: AwardRow[];
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
      auditStatus: "pending" | "approved" | "rejected";
      rejectReason: string | null;
      createdAt: string;
    }[];
  };
};

const BASIC_FIELDS = ["name", "phone", "wechat", "email", "github", "weibo"] as const;
type BasicField = (typeof BASIC_FIELDS)[number];

const LANGS = ["zh", "en", "ru"] as const;

const IDENTITY_FIELDS = [
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
type IdentityField = (typeof IDENTITY_FIELDS)[number];

function emptyBasicForm(): Record<BasicField, { zh: string; en: string; ru: string }> {
  const o = {} as Record<BasicField, { zh: string; en: string; ru: string }>;
  for (const f of BASIC_FIELDS) {
    o[f] = { zh: "", en: "", ru: "" };
  }
  return o;
}

function basicFromProfile(p: ProfileOut): Record<BasicField, { zh: string; en: string; ru: string }> {
  const base = emptyBasicForm();
  const src = p.basicI18nDraft ?? p.basicI18nPublished ?? {};
  for (const f of BASIC_FIELDS) {
    const t = src[f];
    if (t) {
      base[f] = {
        zh: t.zh ?? "",
        en: t.en ?? "",
        ru: t.ru ?? "",
      };
    }
  }
  return base;
}

const inputClass =
  "min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm w-full";

export default function ArchivePage() {
  const { t } = useTranslation("common");
  const [data, setData] = useState<ArchiveMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [basicForm, setBasicForm] = useState(() => emptyBasicForm());
  const [studentNo, setStudentNo] = useState("");
  const [identity, setIdentity] = useState({
    nationality: "",
    idNumber: "",
    grade: "",
    department: "",
    major: "",
    className: "",
    idPhotoUrl: "",
    portraitUrl: "",
    volunteerNumber: "",
  });
  const [identityErrors, setIdentityErrors] = useState<Set<IdentityField>>(() => new Set());
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const idPhotoFileRef = useRef<HTMLInputElement | null>(null);
  const portraitFileRef = useRef<HTMLInputElement | null>(null);
  const awardProofFileRef = useRef<HTMLInputElement | null>(null);
  const [claimEventId, setClaimEventId] = useState("");
  const [claimHours, setClaimHours] = useState("");
  const [tagLabel, setTagLabel] = useState<Record<AbilityCategory, string>>({
    technical: "",
    planning: "",
    management: "",
    sports: "",
  });
  const [awardTitle, setAwardTitle] = useState("");
  const [awardProof, setAwardProof] = useState("");
  const [liveMode, setLiveMode] = useState<"sse" | "poll">("sse");
  const pollRef = useRef<number | null>(null);
  const debounceRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch("/archive/me");
    if (res.status === 401) {
      setError("Unauthorized");
      return;
    }
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<ArchiveMe>(res);
    setData(body);
    setBasicForm(basicFromProfile(body.profile));
    setStudentNo(body.profile.studentNoDraft ?? body.profile.studentNo ?? "");
    const idSrc =
      body.profile.identityDraft ??
      ({
        nationality: body.profile.nationality,
        idNumber: body.profile.idNumber,
        grade: body.profile.grade,
        department: body.profile.department,
        major: body.profile.major,
        className: body.profile.className,
        idPhotoUrl: body.profile.idPhotoUrl,
        portraitUrl: body.profile.portraitUrl,
        volunteerNumber: body.profile.volunteerNumber,
      } satisfies IdentityDraftOut);
    const dm = normalizeDepartmentMajorSelection(idSrc.department, idSrc.major);
    const gNorm = normalizeStudentGradeSelection(idSrc.grade);
    setIdentity({
      nationality: idSrc.nationality,
      idNumber: idSrc.idNumber,
      grade: gNorm,
      department: dm.department,
      major: dm.major,
      className: idSrc.className,
      idPhotoUrl: idSrc.idPhotoUrl ?? "",
      portraitUrl: idSrc.portraitUrl ?? "",
      volunteerNumber: idSrc.volunteerNumber ?? "",
    });
    setIdentityErrors(new Set());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const base = apiBase();
    const url = `${base}/notifications/stream`;

    const scheduleReload = () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        void load();
      }, 400);
    };

    const startPoll = () => {
      if (pollRef.current != null) return;
      setLiveMode("poll");
      pollRef.current = window.setInterval(() => {
        void load();
      }, 10_000);
    };

    const es = new EventSource(url);
    es.addEventListener("notification", (ev) => {
      try {
        const row = JSON.parse((ev as MessageEvent).data as string) as { payload?: unknown };
        const pl = row.payload as { scope?: string } | undefined;
        const s = pl?.scope;
        if (s === "profile_basic" || s === "profile_identity" || s === "award") {
          scheduleReload();
        }
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      es.close();
      startPoll();
    };
    es.onopen = () => {
      setLiveMode("sse");
    };

    return () => {
      es.close();
      if (pollRef.current != null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [load]);

  async function saveBasicDraft() {
    setMsg(null);
    const basicI18nDraft: Record<string, LocaleTri> = {};
    for (const f of BASIC_FIELDS) {
      const tri = basicForm[f];
      basicI18nDraft[f] = {
        zh: tri.zh || undefined,
        en: tri.en || undefined,
        ru: tri.ru || undefined,
      };
    }
    const res = await apiFetch("/archive/me", {
      method: "PATCH",
      body: JSON.stringify({
        basicI18nDraft,
        studentNo: studentNo.trim() || null,
      }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setMsg(t("archive.basicSubmitOk"));
    await load();
  }

  async function saveIdentity() {
    setMsg(null);
    const missing = IDENTITY_FIELDS.filter((k) => !String(identity[k] ?? "").trim());
    if (missing.length > 0) {
      setIdentityErrors(new Set(missing));
      setMsg(t("archive.identityRequiredHint"));
      return;
    }
    setIdentityErrors(new Set());
    const res = await apiFetch("/archive/me", {
      method: "PATCH",
      body: JSON.stringify({
        nationality: identity.nationality || null,
        idNumber: identity.idNumber || null,
        grade: identity.grade || null,
        department: identity.department || null,
        major: identity.major || null,
        className: identity.className || null,
        idPhotoUrl: identity.idPhotoUrl || null,
        portraitUrl: identity.portraitUrl || null,
        volunteerNumber: identity.volunteerNumber.trim() || null,
      }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setMsg(t("archive.identitySubmitOk"));
    await load();
  }

  async function onIdentityImagePick(key: "idPhotoUrl" | "portraitUrl", e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImageUploadBusy(true);
    setMsg(null);
    try {
      const url = await uploadImageFile(f);
      patchIdentity(key, url);
      setMsg(t("archive.imageUploadOk"));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploadBusy(false);
    }
  }

  async function onAwardProofPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImageUploadBusy(true);
    setMsg(null);
    try {
      const url = await uploadImageFile(f);
      setAwardProof(url);
      setMsg(t("archive.imageUploadOk"));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploadBusy(false);
    }
  }

  function patchIdentity<K extends IdentityField>(key: K, value: string) {
    setIdentity((prev) => ({ ...prev, [key]: value }));
    setIdentityErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  async function submitClaim() {
    setMsg(null);
    const body: { coordinationEventId: string; claimedHours?: number } = {
      coordinationEventId: claimEventId.trim(),
    };
    if (claimHours.trim()) {
      const h = Number.parseFloat(claimHours);
      if (!Number.isNaN(h) && h > 0) body.claimedHours = h;
    }
    const res = await apiFetch("/archive/volunteer-claims", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setMsg(t("archive.claimSubmittedPending"));
    setClaimEventId("");
    setClaimHours("");
    await load();
  }

  async function volunteerSync() {
    setMsg(null);
    const res = await apiFetch("/archive/volunteer-sync", { method: "POST", body: "{}" });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    await load();
  }

  async function addTag(cat: AbilityCategory) {
    const label = tagLabel[cat].trim();
    if (!label) return;
    const res = await apiFetch("/archive/ability-tags", {
      method: "POST",
      body: JSON.stringify({ category: cat, label }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setTagLabel((prev) => ({ ...prev, [cat]: "" }));
    await load();
  }

  async function removeTag(id: string) {
    const res = await apiFetch(`/archive/ability-tags/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    await load();
  }

  async function submitAward() {
    setMsg(null);
    const res = await apiFetch("/archive/awards", {
      method: "POST",
      body: JSON.stringify({
        title: awardTitle.trim(),
        proofUrl: awardProof.trim() || null,
      }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setAwardTitle("");
    setAwardProof("");
    setMsg(t("archive.awardSubmittedPending"));
    await load();
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground">{t("archive.loading")}</p>;
  }

  const categories: AbilityCategory[] = ["technical", "planning", "management", "sports"];
  const catLabel = (c: AbilityCategory) =>
    ({
      technical: t("archive.categoryTechnical"),
      planning: t("archive.categoryPlanning"),
      management: t("archive.categoryManagement"),
      sports: t("archive.categorySports"),
    })[c];

  const approvedClaimForInput =
    claimEventId.trim().length > 0
      ? (data.volunteerSummary.claims ?? []).find(
          (c) => c.coordinationEventId === claimEventId.trim() && c.auditStatus === "approved",
        )
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("archive.title")}</h1>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {liveMode === "sse" ? t("archive.live") : t("archive.poll")}
        </span>
      </div>

      {msg ? (
        <p
          className={
            identityErrors.size > 0
              ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              : "rounded-md border border-border bg-muted/50 px-3 py-2 text-sm"
          }
        >
          {msg}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t("archive.basic")}</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("archive.basicAudit")}: {data.profile.basicAuditStatus}
          {data.profile.basicAuditReason ? ` — ${data.profile.basicAuditReason}` : ""}
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
            {t("archive.studentNo")}
            <input
              className={inputClass}
              value={studentNo}
              onChange={(e) => setStudentNo(e.target.value)}
            />
          </label>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("archive.studentNoWithBasicHint")}</p>
        <div className="space-y-4">
          {BASIC_FIELDS.map((field) => (
            <div key={field}>
              <p className="mb-2 text-sm font-medium capitalize text-muted-foreground">{field}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {LANGS.map((lng) => (
                  <label key={lng} className="flex flex-col gap-1 text-xs">
                    {lng}
                    <input
                      className={inputClass}
                      value={basicForm[field][lng]}
                      onChange={(e) =>
                        setBasicForm((prev) => ({
                          ...prev,
                          [field]: { ...prev[field], [lng]: e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void saveBasicDraft()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t("archive.submitBasicForReview")}
        </button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t("archive.identity")}</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("archive.identityAudit")}: {data.profile.identityAuditStatus}
          {data.profile.identityAuditReason ? ` — ${data.profile.identityAuditReason}` : ""}
        </p>
        <p className="mb-3 text-sm text-muted-foreground">
          {data.identityComplete ? t("archive.identityComplete") : t("archive.identityIncomplete")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            <AcademicDeptMajorSelects
              department={identity.department}
              major={identity.major}
              onDepartmentChange={(d) => patchIdentity("department", d)}
              onMajorChange={(m) => patchIdentity("major", m)}
              departmentInvalid={identityErrors.has("department")}
              majorInvalid={identityErrors.has("major")}
            />
          </div>
          <StudentGradeSelect
            value={identity.grade}
            onChange={(g) => patchIdentity("grade", g)}
            invalid={identityErrors.has("grade")}
            required
            labelMode="archive"
          />
          {IDENTITY_FIELDS.filter(
            (key) => key !== "department" && key !== "major" && key !== "grade",
          ).map((key) => {
            const val = identity[key];
            const err = identityErrors.has(key);
            if (key === "idPhotoUrl" || key === "portraitUrl") {
              return (
                <label key={key} className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span>
                    {t(`archive.identityLabels.${key}` as "archive.identityLabels.nationality")}
                    <span className="text-destructive" aria-hidden>
                      {" "}
                      *
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      ref={key === "idPhotoUrl" ? idPhotoFileRef : portraitFileRef}
                      onChange={(e) => void onIdentityImagePick(key, e)}
                    />
                    <input
                      className={
                        err
                          ? `${inputClass} min-w-[12rem] flex-1 border-destructive ring-1 ring-destructive/30`
                          : `${inputClass} min-w-[12rem] flex-1`
                      }
                      value={val}
                      onChange={(e) => patchIdentity(key, e.target.value)}
                      aria-invalid={err}
                    />
                    <button
                      type="button"
                      disabled={imageUploadBusy}
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                      onClick={() =>
                        (key === "idPhotoUrl" ? idPhotoFileRef : portraitFileRef).current?.click()
                      }
                    >
                      {t("uploadImage")}
                    </button>
                  </div>
                  {val.trim().length > 0 ? (
                    <img
                      src={val}
                      alt=""
                      className="mt-1 h-28 max-w-xs rounded border border-border object-contain"
                    />
                  ) : null}
                </label>
              );
            }
            return (
              <label key={key} className="flex flex-col gap-1 text-sm">
                <span>
                  {t(`archive.identityLabels.${key}` as "archive.identityLabels.nationality")}
                  <span className="text-destructive" aria-hidden>
                    {" "}
                    *
                  </span>
                </span>
                <input
                  className={
                    err
                      ? `${inputClass} border-destructive ring-1 ring-destructive/30`
                      : inputClass
                  }
                  value={val}
                  onChange={(e) => patchIdentity(key, e.target.value)}
                  aria-invalid={err}
                />
              </label>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void saveIdentity()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t("archive.submitIdentityForReview")}
        </button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t("archive.volunteer")}</h2>
        <p className="text-2xl font-bold text-foreground">{data.volunteerSummary.totalHours}</p>
        <p className="text-sm text-muted-foreground">{t("archive.totalHours")}</p>
        <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm">
          {data.volunteerSummary.records.map((r) => (
            <li key={r.id} className="flex justify-between gap-2 border-b border-border py-1">
              <span>{r.title}</span>
                <span className="text-muted-foreground">
                {r.hours}h · {r.source} · {formatDisplayDateTime(r.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
        {(data.volunteerSummary.claims ?? []).length > 0 ? (
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">{t("archive.volunteerClaimsTitle")}</p>
            <ul className="space-y-2">
              {(data.volunteerSummary.claims ?? []).map((c) => (
                <li key={c.coordinationEventId} className="border-b border-border/80 pb-2 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{c.eventTitle}</span>
                    <span
                      className={
                        c.auditStatus === "pending"
                          ? "text-amber-700 dark:text-amber-400"
                          : c.auditStatus === "rejected"
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }
                    >
                      {c.auditStatus === "pending"
                        ? t("archive.claimStatusPending")
                        : c.auditStatus === "rejected"
                          ? t("archive.claimStatusRejected")
                          : t("archive.claimStatusApproved")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("leagueArchive.volunteerClaimResolved")}: {c.resolvedHours}h
                    {c.claimedHours != null ? ` · ${t("leagueArchive.volunteerClaimDeclared")}: ${c.claimedHours}h` : null}
                    {" · "}
                    {formatDisplayDateTime(c.createdAt)}
                  </p>
                  {c.auditStatus === "rejected" && c.rejectReason ? (
                    <p className="mt-1 text-xs text-destructive">
                      {t("archive.claimRejectReason")}: {c.rejectReason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">{t("archive.claimTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("archive.coordinationEventIdHint")}</p>
          {!data.profile.volunteerNumber?.trim() ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">{t("archive.claimVolunteerNumberMissing")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("archive.claimVolunteerNumberOk", { num: data.profile.volunteerNumber.trim() })}
            </p>
          )}
          {approvedClaimForInput ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">{t("archive.claimAlreadyApprovedHint")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} max-w-md flex-1`}
              placeholder={t("archive.coordinationEventId")}
              value={claimEventId}
              onChange={(e) => setClaimEventId(e.target.value)}
            />
            <input
              className={`${inputClass} w-28`}
              placeholder={t("archive.claimedHours")}
              value={claimHours}
              onChange={(e) => setClaimHours(e.target.value)}
              disabled={!!approvedClaimForInput}
            />
            <button
              type="button"
              onClick={() => void submitClaim()}
              className="rounded-md bg-secondary px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={!!approvedClaimForInput}
            >
              {t("archive.claim")}
            </button>
            <button
              type="button"
              onClick={() => void volunteerSync()}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium"
            >
              {t("archive.syncVolunteer")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("archive.syncVolunteerHint")}</p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("archive.tags")}</h2>
        <div className="flex flex-col gap-6">
          {categories.map((cat) => {
            const tags = data.abilityTagsByCategory[cat] ?? [];
            return (
              <div key={cat}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">{catLabel(cat)}</h3>
                <ul className="mb-2 flex flex-wrap gap-2">
                  {tags.map((tg) => (
                    <li
                      key={tg.id}
                      className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm"
                    >
                      {tg.label}
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={() => void removeTag(tg.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={`${inputClass} max-w-xs`}
                    placeholder={t("archive.tagLabel")}
                    value={tagLabel[cat]}
                    onChange={(e) =>
                      setTagLabel((prev) => ({ ...prev, [cat]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => void addTag(cat)}
                    className="rounded-md bg-secondary px-3 py-1.5 text-sm"
                  >
                    {t("archive.addTag")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">{t("archive.awardsPublic")}</h2>
        {data.publicAwards.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.publicAwards.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <span className="font-medium">{a.title}</span>
              </li>
            ))}
          </ul>
        )}
        <h3 className="mb-2 mt-6 text-base font-semibold">{t("archive.awardsMine")}</h3>
        <ul className="mb-4 divide-y divide-border">
          {data.myAwards.map((a) => (
            <li key={a.id} className="py-2 text-sm">
              <span className="font-medium">{a.title}</span>
              <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{a.status}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {formatDisplayDateTime(a.createdAt)}
                {a.decidedAt ? ` · ${formatDisplayDateTime(a.decidedAt)}` : ""}
              </span>
              {a.reason ? <p className="text-xs text-red-600">{a.reason}</p> : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} max-w-xs flex-1`}
              placeholder={t("archive.awardTitle")}
              value={awardTitle}
              onChange={(e) => setAwardTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" accept="image/*" className="hidden" ref={awardProofFileRef} onChange={(e) => void onAwardProofPick(e)} />
            <input
              className={`${inputClass} max-w-md min-w-[12rem] flex-1`}
              placeholder={t("archive.proofUrl")}
              value={awardProof}
              onChange={(e) => setAwardProof(e.target.value)}
            />
            <button
              type="button"
              disabled={imageUploadBusy}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              onClick={() => awardProofFileRef.current?.click()}
            >
              {t("uploadImage")}
            </button>
            <button
              type="button"
              onClick={() => void submitAward()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              {t("archive.submitAward")}
            </button>
          </div>
          {awardProof.trim().length > 0 ? (
            <img src={awardProof} alt="" className="h-24 max-w-xs rounded border object-contain" />
          ) : null}
        </div>
      </section>

    </div>
  );
}
