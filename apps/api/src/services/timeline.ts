export type TimelineScheduleInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  instructor?: string | null;
};

export type TimelinePlanInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  priority?: number | null;
};

export type TimelineOrgTaskInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  sourceMeta: unknown;
};

export type TimelineCoordinationInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  category: string;
  description?: string | null;
};

export type TimelineOrgPublishedInput = {
  id: string;
  orgId: string;
  orgNameShort: string;
  kind: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  description?: string | null;
};

export type MergeTimelineSourcesInput = {
  schedule: TimelineScheduleInput[];
  plans: TimelinePlanInput[];
  orgTasks: TimelineOrgTaskInput[];
  leagueCoordination: TimelineCoordinationInput[];
  /** Legacy rows from org_timeline_events table (merged into org_activity). */
  orgTimeline?: TimelineOrgPublishedInput[];
  /** 社团活动（全员任务 + legacy） */
  orgActivities?: TimelineOrgPublishedInput[];
};

export type MergedTimelineItem = {
  sourceType: "schedule" | "plan" | "org_task" | "league_coordination" | "org_activity";
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  meta?: unknown;
};

export function mergeTimelineSources(input: MergeTimelineSourcesInput): MergedTimelineItem[] {
  const items: MergedTimelineItem[] = [];

  for (const s of input.schedule) {
    const meta: Record<string, unknown> = {};
    if (s.location != null && String(s.location).length > 0) {
      meta.location = s.location;
    }
    if (s.instructor != null && String(s.instructor).length > 0) {
      meta.instructor = s.instructor;
    }
    items.push({
      sourceType: "schedule",
      sourceId: s.id,
      title: s.title,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    });
  }

  for (const p of input.plans) {
    const meta: Record<string, unknown> = {};
    const pr = p.priority ?? 1;
    meta.priority = pr;
    if (p.location != null && String(p.location).length > 0) {
      meta.location = p.location;
    }
    items.push({
      sourceType: "plan",
      sourceId: p.id,
      title: p.title,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
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

  for (const c of input.leagueCoordination) {
    const meta: { category: string; description?: string } = { category: c.category };
    if (c.description != null && String(c.description).length > 0) {
      meta.description = c.description;
    }
    items.push({
      sourceType: "league_coordination",
      sourceId: c.id,
      title: c.title,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      meta,
    });
  }

  const activityInputs = [...(input.orgActivities ?? []), ...(input.orgTimeline ?? [])];
  for (const o of activityInputs) {
    const meta: {
      kind: string;
      orgId: string;
      orgNameShort: string;
      description?: string;
    } = {
      kind: o.kind,
      orgId: o.orgId,
      orgNameShort: o.orgNameShort,
    };
    if (o.description != null && String(o.description).length > 0) {
      meta.description = o.description;
    }
    items.push({
      sourceType: "org_activity",
      sourceId: o.id,
      title: o.title,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      meta,
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
