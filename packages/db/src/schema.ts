import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const localeEnum = pgEnum("locale", ["zh", "en", "ru"]);
export const userRoleEnum = pgEnum("user_role", [
  "student",
  "org_member",
  "org_officer",
  "org_president",
  "league_admin",
  "instructor",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  preferredLocale: localeEnum("preferred_locale").notNull().default("zh"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })]
);

export const orgLifecycleEnum = pgEnum("org_lifecycle", ["pending", "active", "suspended"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  nameFull: text("name_full").notNull(),
  nameShort: text("name_short").notNull(),
  logoUrl: text("logo_url"),
  orgType: text("org_type").notNull(),
  lifecycleStatus: orgLifecycleEnum("lifecycle_status").notNull().default("pending"),
  advisorUserId: uuid("advisor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgRevisions = pgTable("organization_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull().default("pending"),
  reviewerUserId: uuid("reviewer_user_id").references(() => users.id),
  reviewReason: text("review_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgLeadershipChangeKindEnum = pgEnum("org_leadership_change_kind", [
  "advisor_updated",
  "member_added",
  "member_removed",
  "member_title_updated",
]);

export const orgLifecycleEvents = pgTable("org_lifecycle_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fromStatus: orgLifecycleEnum("from_status"),
  toStatus: orgLifecycleEnum("to_status").notNull(),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgLeadershipEvents = pgTable("org_leadership_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  changeKind: orgLeadershipChangeKindEnum("change_kind").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgMemberships = pgTable(
  "org_memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })]
);

export const taskKindEnum = pgEnum("org_task_kind", ["single", "cross", "transfer"]);
export const orgTaskTimelineAudienceEnum = pgEnum("org_task_timeline_audience", [
  "assignees_only",
  "org_members",
  "all_students",
]);
export const taskAssignStatusEnum = pgEnum("task_assign_status", [
  "unread",
  "read",
  "in_progress",
  "done",
]);

export const orgTasks = pgTable("org_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  kind: taskKindEnum("kind").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  leagueVisible: boolean("league_visible").notNull().default(true),
  timelineAudience: orgTaskTimelineAudienceEnum("timeline_audience")
    .notNull()
    .default("assignees_only"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgTaskInvolvedOrgs = pgTable(
  "org_task_involved_orgs",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => orgTasks.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.orgId] })]
);

export const orgTaskAssignments = pgTable("org_task_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => orgTasks.id, { onDelete: "cascade" }),
  assigneeUserId: uuid("assignee_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: taskAssignStatusEnum("status").notNull().default("unread"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgTaskStatusEvents = pgTable("org_task_status_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => orgTasks.id, { onDelete: "cascade" }),
  assignmentId: uuid("assignment_id").references(() => orgTaskAssignments.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  fromStatus: taskAssignStatusEnum("from_status"),
  toStatus: taskAssignStatusEnum("to_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgTaskHandoffs = pgTable("org_task_handoffs", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => orgTasks.id, { onDelete: "cascade" }),
  fromUserId: uuid("from_user_id").references(() => users.id),
  toUserId: uuid("to_user_id").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studentProfiles = pgTable(
  "student_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    volunteerNumber: text("volunteer_number").notNull(),
    nationality: text("nationality").notNull(),
    idNumber: text("id_number").notNull(),
    grade: text("grade").notNull(),
    department: text("department").notNull(),
    major: text("major").notNull(),
    className: text("class_name").notNull(),
    idPhotoUrl: text("id_photo_url"),
    portraitUrl: text("portrait_url"),
    phone: text("phone"),
    wechat: text("wechat"),
    github: text("github"),
    weibo: text("weibo"),
    profileDraftPhone: text("profile_draft_phone"),
    profileDraftWechat: text("profile_draft_wechat"),
    profileAuditStatus: text("profile_audit_status").notNull().default("none"),
    profileAuditReason: text("profile_audit_reason"),
    studentNo: text("student_no"),
    studentNoDraft: text("student_no_draft"),
    identityDraft: jsonb("identity_draft"),
    identityAuditStatus: text("identity_audit_status").notNull().default("none"),
    identityAuditReason: text("identity_audit_reason"),
    basicI18nPublished: jsonb("basic_i18n_published")
      .notNull()
      .default(sql`'{}'::jsonb`),
    basicI18nDraft: jsonb("basic_i18n_draft"),
    basicAuditStatus: text("basic_audit_status").notNull().default("none"),
    basicAuditReason: text("basic_audit_reason"),
  },
  (t) => [
    uniqueIndex("volunteer_number_uidx").on(t.volunteerNumber),
    uniqueIndex("student_no_uidx").on(t.studentNo).where(sql`${t.studentNo} IS NOT NULL`),
  ]
);

export const abilityTagCategoryEnum = pgEnum("ability_tag_category", [
  "technical",
  "planning",
  "management",
  "sports",
]);

export const abilityTags = pgTable("ability_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  category: abilityTagCategoryEnum("category").notNull(),
  label: text("label").notNull(),
});

export const awardStatusEnum = pgEnum("award_status", ["pending", "approved", "rejected"]);

export const awards = pgTable("awards", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  proofUrl: text("proof_url"),
  status: awardStatusEnum("status").notNull().default("pending"),
  reviewerUserId: uuid("reviewer_user_id").references(() => users.id),
  reason: text("reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const volunteerRecords = pgTable(
  "volunteer_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    volunteerNumber: text("volunteer_number").notNull(),
    title: text("title").notNull(),
    hours: numeric("hours", { precision: 8, scale: 2 }).notNull(),
    source: text("source").notNull(),
    externalRef: text("external_ref"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("vr_volunteer_number_idx").on(t.volunteerNumber),
    uniqueIndex("vr_volunteer_external_uidx")
      .on(t.volunteerNumber, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
  ]
);

export const personalPlans = pgTable("personal_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  priority: integer("priority").notNull().default(1),
  status: text("status").notNull().default("planned"),
  onTimeline: boolean("on_timeline").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduleItemsCache = pgTable(
  "schedule_items_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    batchId: text("batch_id"),
  },
  (t) => [index("schedule_user_starts_idx").on(t.userId, t.startsAt)]
);

export const notificationTypeEnum = pgEnum("notification_type", [
  "archive_audit",
  "task_status",
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const coordinationCategoryEnum = pgEnum("coordination_category", [
  "practice",
  "volunteer",
  "work_study",
  "general",
]);

export const leagueCoordinationEvents = pgTable(
  "league_coordination_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    category: coordinationCategoryEnum("category").notNull().default("general"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("league_coordination_range_idx").on(t.startsAt, t.endsAt),
  ],
);

export const orgTimelineEventKindEnum = pgEnum("org_timeline_event_kind", [
  "meeting",
  "work_task",
  "activity",
  "innovation",
]);

export const orgTimelineEvents = pgTable(
  "org_timeline_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: orgTimelineEventKindEnum("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("org_timeline_org_range_idx").on(t.orgId, t.startsAt, t.endsAt)],
);

export const studentVolunteerEventClaims = pgTable(
  "student_volunteer_event_claims",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    coordinationEventId: uuid("coordination_event_id")
      .notNull()
      .references(() => leagueCoordinationEvents.id, { onDelete: "cascade" }),
    claimedHours: numeric("claimed_hours", { precision: 8, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.coordinationEventId] })],
);
