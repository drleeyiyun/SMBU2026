import { and, eq, sql } from "drizzle-orm";
import { db } from "db";
import {
  leagueCoordinationEvents,
  studentProfiles,
  studentVolunteerEventClaims,
  volunteerRecords,
} from "db/schema";

export function hoursFromRange(startsAt: Date, endsAt: Date): number {
  const ms = endsAt.getTime() - startsAt.getTime();
  return Math.round((ms / 3_600_000) * 100) / 100;
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
      ),
    );

  let upserted = 0;
  for (const { claim, event } of rows) {
    const hoursVal =
      claim.claimedHours !== null
        ? Number.parseFloat(String(claim.claimedHours))
        : hoursFromRange(event.startsAt, event.endsAt);

    const hoursStr = hoursVal.toFixed(2);
    const externalRef = event.id;

    await db
      .insert(volunteerRecords)
      .values({
        volunteerNumber: profile.volunteerNumber,
        title: event.title,
        hours: hoursStr,
        source: "coordination",
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
