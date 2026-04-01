export type TimelineScheduleInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
};

export type TimelinePlanInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
};

export type TimelineOrgTaskInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  sourceMeta: unknown;
};

export type MergeTimelineSourcesInput = {
  schedule: TimelineScheduleInput[];
  plans: TimelinePlanInput[];
  orgTasks: TimelineOrgTaskInput[];
};

export type MergedTimelineItem = {
  sourceType: "schedule" | "plan" | "org_task";
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  meta?: unknown;
};

export function mergeTimelineSources(input: MergeTimelineSourcesInput): MergedTimelineItem[] {
  const items: MergedTimelineItem[] = [];

  for (const s of input.schedule) {
    items.push({
      sourceType: "schedule",
      sourceId: s.id,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      meta:
        s.location != null && String(s.location).length > 0 ? { location: s.location } : undefined,
    });
  }

  for (const p of input.plans) {
    items.push({
      sourceType: "plan",
      sourceId: p.id,
      title: p.title,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      meta:
        p.location != null && String(p.location).length > 0 ? { location: p.location } : undefined,
    });
  }

  for (const t of input.orgTasks) {
    items.push({
      sourceType: "org_task",
      sourceId: t.id,
      title: t.title,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      meta: t.sourceMeta,
    });
  }

  items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return items;
}

/** Inclusive overlap: [a0,a1] intersects [b0,b1]. */
export function intervalsOverlap(a0: Date, a1: Date, b0: Date, b1: Date): boolean {
  return a0.getTime() <= b1.getTime() && a1.getTime() >= b0.getTime();
}

export function effectiveOrgTaskWindow(
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): { startsAt: Date; endsAt: Date } {
  const s = startsAt ?? now;
  const e = endsAt ?? now;
  if (e.getTime() < s.getTime()) {
    return { startsAt: s, endsAt: s };
  }
  return { startsAt: s, endsAt: e };
}
