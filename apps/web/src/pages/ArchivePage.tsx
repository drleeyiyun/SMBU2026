import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiBase, apiFetch, readErrorMessage, readJson } from "../lib/api";

type AbilityCategory = "technical" | "planning" | "management" | "sports";

type LocaleTri = { zh?: string; en?: string; ru?: string };

type ProfileOut = {
  userId: string;
  studentNo: string | null;
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
  profileDraftPhone: string | null;
  profileDraftWechat: string | null;
  profileAuditStatus: string;
  profileAuditReason: string | null;
  basicI18nPublished: Record<string, LocaleTri>;
  basicI18nDraft: Record<string, LocaleTri> | null;
  basicAuditStatus: string;
  basicAuditReason: string | null;
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
  };
};

const BASIC_FIELDS = ["name", "phone", "wechat", "email", "github", "weibo"] as const;
type BasicField = (typeof BASIC_FIELDS)[number];

const LANGS = ["zh", "en", "ru"] as const;

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
  });
  const [draftPhone, setDraftPhone] = useState("");
  const [legacyPatching, setLegacyPatching] = useState(false);
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
    setStudentNo(body.profile.studentNo ?? "");
    setIdentity({
      nationality: body.profile.nationality,
      idNumber: body.profile.idNumber,
      grade: body.profile.grade,
      department: body.profile.department,
      major: body.profile.major,
      className: body.profile.className,
      idPhotoUrl: body.profile.idPhotoUrl ?? "",
      portraitUrl: body.profile.portraitUrl ?? "",
    });
    setDraftPhone(body.profile.profileDraftPhone ?? body.profile.phone ?? "");
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
        if (s === "profile_basic" || s === "profile" || s === "award") {
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
      body: JSON.stringify({ basicI18nDraft }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setMsg(t("archive.saveBasic") + " — OK");
    await load();
  }

  async function saveStudentNo() {
    setMsg(null);
    const res = await apiFetch("/archive/me", {
      method: "PATCH",
      body: JSON.stringify({ studentNo: studentNo.trim() || null }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    await load();
  }

  async function saveIdentity() {
    setMsg(null);
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
      }),
    });
    if (!res.ok) {
      setMsg(await readErrorMessage(res));
      return;
    }
    setMsg(t("archive.saveIdentity") + " — OK");
    await load();
  }

  async function saveLegacyPhone() {
    setLegacyPatching(true);
    setMsg(null);
    try {
      const res = await apiFetch("/archive/me", {
        method: "PATCH",
        body: JSON.stringify({ profileDraftPhone: draftPhone || null }),
      });
      if (!res.ok) {
        setMsg(await readErrorMessage(res));
        return;
      }
      await load();
    } finally {
      setLegacyPatching(false);
    }
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("archive.title")}</h1>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {liveMode === "sse" ? t("archive.live") : t("archive.poll")}
        </span>
      </div>

      {msg ? (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">{msg}</p>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t("archive.basic")}</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          {t("archive.basicAudit")}: {data.profile.basicAuditStatus}
          {data.profile.basicAuditReason ? ` — ${data.profile.basicAuditReason}` : ""}
        </p>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[140px] flex-col gap-1 text-sm">
            {t("archive.studentNo")}
            <input
              className={inputClass}
              value={studentNo}
              onChange={(e) => setStudentNo(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => void saveStudentNo()}
            className="rounded-md bg-secondary px-3 py-2 text-sm font-medium"
          >
            {t("plans.save")}
          </button>
        </div>
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
          {t("archive.saveBasic")}
        </button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t("archive.identity")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {data.identityComplete ? t("archive.identityComplete") : t("archive.identityIncomplete")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["nationality", identity.nationality],
              ["idNumber", identity.idNumber],
              ["grade", identity.grade],
              ["department", identity.department],
              ["major", identity.major],
              ["className", identity.className],
              ["idPhotoUrl", identity.idPhotoUrl],
              ["portraitUrl", identity.portraitUrl],
            ] as const
          ).map(([key, val]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              {key}
              <input
                className={inputClass}
                value={val}
                onChange={(e) => setIdentity((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void saveIdentity()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t("archive.saveIdentity")}
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
                {r.hours}h · {r.source}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-medium">{t("archive.claimTitle")}</p>
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
            />
            <button
              type="button"
              onClick={() => void submitClaim()}
              className="rounded-md bg-secondary px-3 py-2 text-sm font-medium"
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
              {a.reason ? <p className="text-xs text-red-600">{a.reason}</p> : null}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputClass} max-w-xs flex-1`}
            placeholder={t("archive.awardTitle")}
            value={awardTitle}
            onChange={(e) => setAwardTitle(e.target.value)}
          />
          <input
            className={`${inputClass} max-w-md flex-1`}
            placeholder={t("archive.proofUrl")}
            value={awardProof}
            onChange={(e) => setAwardProof(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void submitAward()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("archive.submitAward")}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">{t("archive.phoneDraftLegacy")}</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputClass} max-w-xs flex-1`}
            value={draftPhone}
            onChange={(e) => setDraftPhone(e.target.value)}
          />
          <button
            type="button"
            disabled={legacyPatching}
            onClick={() => void saveLegacyPhone()}
            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {t("plans.save")}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("archive.status")} (legacy): {data.profile.profileAuditStatus}
        </p>
      </section>
    </div>
  );
}
