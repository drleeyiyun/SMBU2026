import { studentProfiles } from "db/schema";

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

export function profileToJson(p: ProfileRow) {
  return {
    userId: p.userId,
    studentNo: p.studentNo,
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
    profileDraftPhone: p.profileDraftPhone,
    profileDraftWechat: p.profileDraftWechat,
    profileAuditStatus: p.profileAuditStatus,
    profileAuditReason: p.profileAuditReason,
    basicI18nPublished: parseBasicI18n(p.basicI18nPublished),
    basicI18nDraft: p.basicI18nDraft === null ? null : parseBasicI18n(p.basicI18nDraft),
    basicAuditStatus: p.basicAuditStatus,
    basicAuditReason: p.basicAuditReason,
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
