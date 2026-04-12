import { and, eq, sql } from "drizzle-orm";
import { db } from "db";
import {
  leagueCoordinationEvents,
  studentProfiles,
  studentVolunteerEventClaims,
  volunteerRecords,
} from "db/schema";

const COORDINATION_SOURCE = "coordination";

/** Removes a coordination-derived volunteer row so pending/rejected claims do not show as credited hours. */
export async function deleteVolunteerRecordForCoordination(
  volunteerNumber: string,
  coordinationEventId: string,
): Promise<void> {
  await db.delete(volunteerRecords).where(
    and(
      eq(volunteerRecords.volunteerNumber, volunteerNumber),
      eq(volunteerRecords.externalRef, coordinationEventId),
      eq(volunteerRecords.source, COORDINATION_SOURCE),
    ),
  );
}

export function hoursFromRange(startsAt: Date, endsAt: Date): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function parseNumericHours(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

type VolunteerHoursEventSlice = Pick<
  typeof leagueCoordinationEvents.$inferSelect,
  "startsAt" | "endsAt" | "defaultVolunteerHours"
>;

/** Resolves hours for a coordination claim: explicit claim > event default > duration of event. */
export function resolveVolunteerHoursForClaim(
  claimClaimedHours: unknown,
  event: VolunteerHoursEventSlice,
): number {
  const explicit = parseNumericHours(claimClaimedHours);
  if (explicit !== null) {
    return explicit;
  }
  const defaulted = parseNumericHours(event.defaultVolunteerHours);
  if (defaulted !== null) {
    return defaulted;
  }
  return hoursFromRange(event.startsAt, event.endsAt);
}

/** Idempotent upsert: claims × volunteer-category coordination events → volunteer_records. */
export async function syncVolunteerRecordsForUser(userId: string): Promise<{ upserted: number }> {
  const [profile] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    return { upserted: 0 };
  }

  const rows = await db
    .select({
      claim: studentVolunteerEventClaims,
      event: leagueCoordinationEvents,
    })
    .from(studentVolunteerEventClaims)
    .innerJoin(
      leagueCoordinationEvents,
      eq(studentVolunteerEventClaims.coordinationEventId, leagueCoordinationEvents.id),
    )
    .where(
      and(
        eq(studentVolunteerEventClaims.userId, userId),
        eq(leagueCoordinationEvents.category, "volunteer"),
        eq(studentVolunteerEventClaims.auditStatus, "approved"),
      ),
    );

  let upserted = 0;
  for (const { claim, event } of rows) {
    const hoursVal = resolveVolunteerHoursForClaim(claim.claimedHours, event);

    const hoursStr = hoursVal.toFixed(2);
    const externalRef = event.id;

    await db
      .insert(volunteerRecords)
      .values({
        volunteerNumber: profile.volunteerNumber,
        title: event.title,
        hours: hoursStr,
        source: COORDINATION_SOURCE,
        externalRef,
        occurredAt: event.startsAt,
      })
      .onConflictDoUpdate({
        target: [volunteerRecords.volunteerNumber, volunteerRecords.externalRef],
        set: {
          hours: sql`excluded.hours`,
          title: sql`excluded.title`,
          occurredAt: sql`excluded.occurred_at`,
        },
      });

    upserted += 1;
  }

  return { upserted };
}
