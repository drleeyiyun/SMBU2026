/** 周一=1 … 周日=7（与课表习惯一致） */

export type WeeklySlotInput = {
  weekday: number;
  startTime: string;
  endTime: string;
  title: string;
  location: string;
  instructor: string;
};

export type PublishItem = {
  title: string;
  location: string | null;
  instructor: string | null;
  startsAt: string;
  endsAt: string;
};

function parseYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

/** 取该公历日所在周的周一（本地时区，00:00）。 */
export function mondayOfWeekContaining(ymd: string): Date | null {
  const d = parseYmdLocal(ymd);
  if (!d) return null;
  const dow = d.getDay();
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setDate(mon.getDate() + toMonday);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

export function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** 当前本地时区下，「本周一」的 YYYY-MM-DD。 */
export function defaultWeekAnchorYmd(): string {
  const mon = mondayOfWeekContaining(formatYmdLocal(new Date()));
  return mon ? formatYmdLocal(mon) : formatYmdLocal(new Date());
}

function addDaysLocal(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** weekday 1=周一 … 7=周日 → 相对周一偏移 0–6 */
function weekdayToOffsetFromMonday(weekday: number): number | null {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return null;
  return weekday === 7 ? 6 : weekday - 1;
}

function parseHHmm(s: string): { h: number; m: number } | null {
  const t = s.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

function combineLocal(dateMidnight: Date, hhmm: string): Date | null {
  const p = parseHHmm(hhmm);
  if (!p) return null;
  const x = new Date(dateMidnight);
  x.setHours(p.h, p.m, 0, 0);
  return x;
}

/**
 * 将「一周模板」按周数展开为绝对时间的发布条目（本地时区 interpretation）。
 */
export function expandWeeklyScheduleToItems(
  anchorYmd: string,
  weekRepeatCount: number,
  slots: WeeklySlotInput[],
): { ok: true; items: PublishItem[] } | { ok: false; error: string } {
  const monday0 = mondayOfWeekContaining(anchorYmd);
  if (!monday0) {
    return { ok: false, error: "invalidAnchorDate" };
  }

  const weeks = Math.min(52, Math.max(1, Math.floor(weekRepeatCount)));
  const items: PublishItem[] = [];

  for (let w = 0; w < weeks; w++) {
    const weekMonday = addDaysLocal(monday0, w * 7);
    for (const slot of slots) {
      const title = slot.title.trim();
      if (!title) continue;
      const off = weekdayToOffsetFromMonday(slot.weekday);
      if (off === null) continue;
      const st = slot.startTime.trim();
      const en = slot.endTime.trim();
      if (!st || !en) continue;

      const day = addDaysLocal(weekMonday, off);
      const startsAt = combineLocal(day, st);
      const endsAt = combineLocal(day, en);
      if (!startsAt || !endsAt) continue;
      if (startsAt.getTime() >= endsAt.getTime()) {
        return { ok: false, error: "timeOrder" };
      }

      const loc = slot.location.trim();
      const inst = slot.instructor.trim();
      items.push({
        title,
        location: loc.length > 0 ? loc : null,
        instructor: inst.length > 0 ? inst : null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
    }
  }

  if (items.length === 0) {
    return { ok: false, error: "noSlots" };
  }

  return { ok: true, items };
}
