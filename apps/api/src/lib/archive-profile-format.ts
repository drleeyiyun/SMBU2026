import { studentProfiles } from "db/schema";

export const IDENTITY_DRAFT_KEYS = [
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
export type IdentityDraftKey = (typeof IDENTITY_DRAFT_KEYS)[number];

export type IdentityDraft = {
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

export const BASIC_KEYS = ["name", "phone", "wechat", "email", "github", "weibo"] as const;
export type BasicKey = (typeof BASIC_KEYS)[number];
export type BasicI18n = Partial<Record<BasicKey, { zh?: string; en?: string; ru?: string }>>;

export type ProfileRow = typeof studentProfiles.$inferSelect;

export function parseBasicI18n(raw: unknown): BasicI18n {
  if (raw === null || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: BasicI18n = {};
  for (const k of BASIC_KEYS) {
    const v = o[k];
    if (v === null || typeof v !== "object") continue;
    const tri = v as Record<string, unknown>;
    out[k] = {
      zh: typeof tri.zh === "string" ? tri.zh : undefined,
      en: typeof tri.en === "string" ? tri.en : undefined,
      ru: typeof tri.ru === "string" ? tri.ru : undefined,
    };
  }
  return out;
}

export function mergeBasicI18n(base: BasicI18n, patch: BasicI18n): BasicI18n {
  const out: BasicI18n = { ...base };
  for (const k of BASIC_KEYS) {
    const p = patch[k];
    if (!p) continue;
    const prev = out[k] ?? {};
    out[k] = { ...prev, ...p };
  }
  return out;
}

const LOCALE_KEYS = ["zh", "en", "ru"] as const;

export function basicI18nDeepEqual(a: BasicI18n, b: BasicI18n): boolean {
  for (const k of BASIC_KEYS) {
    for (const loc of LOCALE_KEYS) {
      const x = (a[k]?.[loc] ?? "").trim();
      const y = (b[k]?.[loc] ?? "").trim();
      if (x !== y) return false;
    }
  }
  return true;
}

export type ResolveArchiveDisplayNameOptions = {
  /**
   * When false, pending `basicI18nDraft` is ignored — only published basic + `users.displayName`.
   * League audit UI must use false so unapproved changes are not shown as the student's live label.
   */
  includePendingBasicDraft?: boolean;
};

export function resolveArchiveDisplayName(
  userDisplayName: string | null,
  publishedRaw: unknown,
  draftRaw: unknown | null,
  basicAuditStatus: string,
  options?: ResolveArchiveDisplayNameOptions,
): string | null {
  const published = parseBasicI18n(publishedRaw);
  const draft = draftRaw === null ? null : parseBasicI18n(draftRaw);
  const pick = (b: BasicI18n) =>
    b.name?.zh?.trim() || b.name?.en?.trim() || b.name?.ru?.trim() || null;
  const usePendingDraft =
    options?.includePendingBasicDraft !== false &&
    basicAuditStatus === "pending" &&
    draft !== null;
  if (usePendingDraft) {
    const n = pick(draft);
    if (n) return n;
  }
  const pub = pick(published);
  if (pub) return pub;
  return userDisplayName?.trim() || null;
}

export function normStudentNo(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t.length > 0 ? t : null;
}

export function parseIdentityDraft(raw: unknown): IdentityDraft | null {
  if (raw === null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<IdentityDraft> = {};
  for (const k of IDENTITY_DRAFT_KEYS) {
    const v = o[k];
    if (k === "idPhotoUrl" || k === "portraitUrl") {
      out[k] = typeof v === "string" && v.trim() ? v.trim() : null;
    } else if (k === "volunteerNumber") {
      if (typeof v !== "string" || !v.trim()) return null;
      out[k] = v.trim();
    } else {
      if (typeof v !== "string" || !v.trim()) return null;
      out[k] = v.trim();
    }
  }
  return out as IdentityDraft;
}

export function identityDraftFromProfileRow(p: ProfileRow): IdentityDraft {
  return {
    nationality: p.nationality,
    idNumber: p.idNumber,
    grade: p.grade,
    department: p.department,
    major: p.major,
    className: p.className,
    idPhotoUrl: p.idPhotoUrl && p.idPhotoUrl.trim() ? p.idPhotoUrl.trim() : null,
    portraitUrl: p.portraitUrl && p.portraitUrl.trim() ? p.portraitUrl.trim() : null,
    volunteerNumber: p.volunteerNumber,
  };
}

function normIdentityForCompare(d: IdentityDraft): IdentityDraft {
  return {
    nationality: d.nationality.trim(),
    idNumber: d.idNumber.trim(),
    grade: d.grade.trim(),
    department: d.department.trim(),
    major: d.major.trim(),
    className: d.className.trim(),
    idPhotoUrl: d.idPhotoUrl?.trim() || null,
    portraitUrl: d.portraitUrl?.trim() || null,
    volunteerNumber: d.volunteerNumber.trim(),
  };
}

export function identityDraftsEqual(a: IdentityDraft, b: IdentityDraft): boolean {
  return JSON.stringify(normIdentityForCompare(a)) === JSON.stringify(normIdentityForCompare(b));
}

export function triPhoneEmailFromBasic(
  published: BasicI18n,
): { phone: string | null; wechat: string | null } {
  const phone = published.phone?.zh ?? published.phone?.en ?? published.phone?.ru ?? null;
  const wechat = published.wechat?.zh ?? published.wechat?.en ?? published.wechat?.ru ?? null;
  return {
    phone: phone && phone.trim() ? phone.trim() : null,
    wechat: wechat && wechat.trim() ? wechat.trim() : null,
  };
}

export function identityCompleteRow(p: ProfileRow): boolean {
  const fields = [
    p.nationality,
    p.idNumber,
    p.grade,
    p.department,
    p.major,
    p.className,
    p.volunteerNumber,
    p.idPhotoUrl,
    p.portraitUrl,
  ];
  return fields.every((x) => typeof x === "string" && x.trim().length > 0);
}

/** Uses pending identity draft when applicable (student-facing completeness). */
export function identityCompleteEffective(p: ProfileRow): boolean {
  if (p.identityAuditStatus === "pending" && p.identityDraft !== null) {
    const d = parseIdentityDraft(p.identityDraft);
    if (!d) return false;
    const fields = [
      d.nationality,
      d.idNumber,
      d.grade,
      d.department,
      d.major,
      d.className,
      d.volunteerNumber,
      d.idPhotoUrl,
      d.portraitUrl,
    ];
    return fields.every((x) => typeof x === "string" && x.trim().length > 0);
  }
  return identityCompleteRow(p);
}

export function profileToJson(p: ProfileRow) {
  return {
    userId: p.userId,
    studentNo: p.studentNo,
    studentNoDraft: p.studentNoDraft,
    volunteerNumber: p.volunteerNumber,
    nationality: p.nationality,
    idNumber: p.idNumber,
    grade: p.grade,
    department: p.department,
    major: p.major,
    className: p.className,
    idPhotoUrl: p.idPhotoUrl,
    portraitUrl: p.portraitUrl,
    phone: p.phone,
    wechat: p.wechat,
    github: p.github,
    weibo: p.weibo,
    basicI18nPublished: parseBasicI18n(p.basicI18nPublished),
    basicI18nDraft: p.basicI18nDraft === null ? null : parseBasicI18n(p.basicI18nDraft),
    basicAuditStatus: p.basicAuditStatus,
    basicAuditReason: p.basicAuditReason,
    identityDraft: p.identityDraft === null ? null : parseIdentityDraft(p.identityDraft),
    identityAuditStatus: p.identityAuditStatus,
    identityAuditReason: p.identityAuditReason,
  };
}

export const ABILITY_CATEGORIES = ["technical", "planning", "management", "sports"] as const;

export function groupAbilityTags(
  rows: { id: string; category: string; label: string }[],
): Record<(typeof ABILITY_CATEGORIES)[number], { id: string; label: string }[]> {
  const empty: Record<(typeof ABILITY_CATEGORIES)[number], { id: string; label: string }[]> = {
    technical: [],
    planning: [],
    management: [],
    sports: [],
  };
  for (const r of rows) {
    const cat = r.category as (typeof ABILITY_CATEGORIES)[number];
    if (empty[cat]) {
      empty[cat].push({ id: r.id, label: r.label });
    }
  }
  return empty;
}

export function sumVolunteerHours(records: { hours: string | number }[]): number {
  return records.reduce((acc, r) => acc + Number.parseFloat(String(r.hours)), 0);
}
