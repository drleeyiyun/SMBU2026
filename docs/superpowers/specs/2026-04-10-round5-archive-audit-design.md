# Round 5 — Archive audit & league visibility (2026-04-10)

## Goals

1. **League roster & detail** show the same “logical” student name and profile preview as multilingual basic info and pending drafts (not only `users.display_name`).
2. **Basic review** cannot be submitted when there is no diff vs published (including student number).
3. **Student number** is only submitted together with basic multilingual fields (single action, no separate save).
4. **Identity fields** go through league review (draft + `identity_audit_status`); published columns update only on approve.
5. **League** can open a student and see full archive: basic i18n, identity, tags, all awards, volunteer records.

## Data model

Migration `0006_archive_identity_draft.sql`:

- `student_no_draft` — pending student number with basic review.
- `identity_draft` (jsonb) — pending identity snapshot.
- `identity_audit_status` / `identity_audit_reason` — mirror basic audit pattern.

## API

- `PATCH /archive/me`: identity keys must be sent together → writes `identity_draft`, sets `identity_audit_status = pending`; does not mutate published identity columns. Basic submit includes `basicI18nDraft` + optional `studentNo`; sets `student_no_draft`, rejects if no diff. `studentNo` alone is rejected (zod superRefine).
- `POST /archive/reviews/:userId`: body `scope`: `profile_basic` | `profile_identity` (default `profile_basic`). Basic approve copies draft to published, applies `student_no_draft` → `student_no`, clears drafts, syncs `users.display_name` from approved name. Identity approve copies `identity_draft` → columns, clears draft; then `syncVolunteerRecordsForUser`.
- `GET /league/archive/students`: resolved display name uses **published** basic i18n only (`includePendingBasicDraft: false`); roster **student number / 院系 /专业 / 年级** always reflect **published** DB columns until audits pass. Pending values appear only in the “待审核” diff sections.
- `GET /league/archive/pending-identity`: list for identity queue.

## Frontend

- **Archive**: one button for basic+学号; identity button submits full identity for review; audit status lines for both.
- **League archive**: pending basic shows student number diff; new pending identity section; detail modal expanded; review calls pass `scope`.

## Verification

- `pnpm db:migrate`, `pnpm test`, `pnpm --filter web build`.
