import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "db";
import {
  abilityTags,
  awards,
  leagueCoordinationEvents,
  studentProfiles,
  studentVolunteerEventClaims,
  volunteerRecords,
} from "db/schema";
import { resolveVolunteerHoursForClaim } from "./archive-volunteer-sync.js";
import {
  groupAbilityTags,
  identityCompleteEffective,
  profileToJson,
  sumVolunteerHours,
} from "../lib/archive-profile-format.js";

/** Same payload shape as `GET /archive/me` for a single student. */
export async function fetchStudentArchiveDetail(userId: string) {
  const [profile] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    return null;
  }

  const tags = await db
    .select({
      id: abilityTags.id,
      category: abilityTags.category,
      label: abilityTags.label,
    })
    .from(abilityTags)
    .where(eq(abilityTags.userId, userId));

  const awardRows = await db
    .select({
      id: awards.id,
      title: awards.title,
      proofUrl: awards.proofUrl,
      status: awards.status,
      reason: awards.reason,
      decidedAt: awards.decidedAt,
      createdAt: awards.createdAt,
    })
    .from(awards)
    .where(eq(awards.userId, userId))
    .orderBy(asc(awards.createdAt));

  const vr = await db
    .select({
      id: volunteerRecords.id,
      title: volunteerRecords.title,
      hours: volunteerRecords.hours,
      source: volunteerRecords.source,
      externalRef: volunteerRecords.externalRef,
      occurredAt: volunteerRecords.occurredAt,
    })
    .from(volunteerRecords)
    .where(eq(volunteerRecords.volunteerNumber, profile.volunteerNumber))
    .orderBy(asc(volunteerRecords.occurredAt));

  const claimRows = await db
    .select({
      coordinationEventId: studentVolunteerEventClaims.coordinationEventId,
      claimedHours: studentVolunteerEventClaims.claimedHours,
      auditStatus: studentVolunteerEventClaims.auditStatus,
      rejectReason: studentVolunteerEventClaims.rejectReason,
      createdAt: studentVolunteerEventClaims.createdAt,
      eventTitle: leagueCoordinationEvents.title,
      eventStartsAt: leagueCoordinationEvents.startsAt,
      eventEndsAt: leagueCoordinationEvents.endsAt,
      defaultVolunteerHours: leagueCoordinationEvents.defaultVolunteerHours,
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
    )
    .orderBy(desc(studentVolunteerEventClaims.createdAt));

  const volunteerClaimsOut = claimRows.map((r) => ({
    coordinationEventId: r.coordinationEventId,
    eventTitle: r.eventTitle,
    claimedHours:
      r.claimedHours !== null && r.claimedHours !== undefined
        ? Number.parseFloat(String(r.claimedHours))
        : null,
    resolvedHours: resolveVolunteerHoursForClaim(r.claimedHours, {
      startsAt: r.eventStartsAt,
      endsAt: r.eventEndsAt,
      defaultVolunteerHours: r.defaultVolunteerHours,
    }),
    auditStatus: r.auditStatus,
    rejectReason: r.rejectReason,
    createdAt: r.createdAt.toISOString(),
  }));

  const volunteerRecordsOut = vr.map((r) => ({
    id: r.id,
    title: r.title,
    hours: Number.parseFloat(String(r.hours)),
    source: r.source,
    externalRef: r.externalRef,
    occurredAt: r.occurredAt.toISOString(),
  }));

  const myAwards = awardRows.map((a) => ({
    id: a.id,
    title: a.title,
    proofUrl: a.proofUrl,
    status: a.status,
    reason: a.reason,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }));

  const publicAwards = myAwards.filter((a) => a.status === "approved");

  return {
    profile: profileToJson(profile),
    identityComplete: identityCompleteEffective(profile),
    abilityTags: tags.map((t) => ({
      id: t.id,
      category: t.category,
      label: t.label,
    })),
    abilityTagsByCategory: groupAbilityTags(tags),
    awards: myAwards,
    myAwards,
    publicAwards,
    volunteerSummary: {
      totalHours: sumVolunteerHours(vr),
      records: volunteerRecordsOut,
      claims: volunteerClaimsOut,
    },
  };
}
