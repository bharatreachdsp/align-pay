/**
 * ALIGN's ledger response schema, vendored so ALIGN Pay reads ALIGN-format entries exactly as ALIGN serves them.
 *
 * Copied from ALIGN's public CLI, https://github.com/bharatreachdsp/align-cli (commit 05a65c5),
 * packages/core/src/api/ledger.ts and packages/core/src/api/common.ts.
 * MIT License, Copyright (c) 2026 The ALIGN authors. See THIRD_PARTY_NOTICES.md at the repository root.
 *
 * Only the response types are kept (entries, revisions, evidence, checks, conflicts); request schemas are omitted.
 */
import { z } from "zod";

/** Ids are server-issued opaque strings (uuidv7 in practice); clients never parse them. */
export const Id = z.string().min(1).max(200);

/** An ISO-8601 timestamp with an offset, as the server sends it. */
export const Timestamp = z.iso.datetime({ offset: true });

const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A repository-relative POSIX path or glob (docs/13): no leading `/`, no `..` segment, no backslash. */
export const RepoPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes(".."), "repository-relative path");

/** `AL-12`, `Q-3` (docs/11 §Identifiers). */
export const EntryKey = z.string().regex(/^[A-Z][A-Z0-9]{0,5}-[1-9][0-9]{0,8}$/);


export const EntryKind = z.enum(["decision", "commitment", "question"]);
export const EntryStatus = z.enum([
  "proposed",
  "confirmed",
  "rejected",
  "superseded",
  "withdrawn",
  "open",
  "answered",
  "dismissed",
]);
export const Verification = z.enum(["unverified", "verified", "drifted", "not_checkable"]);
export const CheckKind = z.enum([
  "forbid_import",
  "forbid_dependency",
  "forbid_pattern",
  "require_pattern",
  "path_exists",
  "path_absent",
]);
export const CheckStatus = z.enum(["proposed", "active", "disabled"]);
export const CheckResult = z.enum(["pass", "fail", "error", "skipped"]);
export const ConflictStatus = z.enum(["open", "resolved_superseded", "resolved_changed", "dismissed"]);

export const PersonRef = z.object({ id: Id, display_name: z.string() });
export type PersonRef = z.infer<typeof PersonRef>;


export const EntrySummary = z.object({
  key: z.string(),
  kind: EntryKind,
  status: EntryStatus,
  statement: z.string(),
  scope_paths: z.array(z.string()),
  verification: Verification,
  /** The entry is author-only (a proposal of the caller's that nobody else sees yet). */
  private: z.boolean(),
  confirmed_by: PersonRef.nullable().optional(),
  confirmed_at: Timestamp.nullable().optional(),
  owner: PersonRef.nullable().optional(),
  due_date: DateOnly.nullable().optional(),
  open_conflicts: z.number().int().min(0),
  /** The current revision: what a confirm of this summary's wording passes as `revision` (D419). */
  revision: z.number().int().min(1).optional(),
});
export type EntrySummary = z.infer<typeof EntrySummary>;

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });

export const EntriesPage = Page(EntrySummary);
export type EntriesPage = z.infer<typeof EntriesPage>;

export const Revision = z.object({
  revision: z.number().int().min(1),
  statement: z.string(),
  rationale: z.string().nullable(),
  alternatives_rejected: z.array(z.string()),
  scope_paths: z.array(z.string()),
  due_date: DateOnly.nullable(),
  owner_hint: z.string().nullable(),
  reason: z.string().nullable(),
  by: z.enum(["person", "align"]),
  created_at: Timestamp,
});

export const EvidenceView = z.object({
  kind: z.enum(["transcript", "commit", "source_text", "event", "confirmation"]),
  locator: z.string(),
  quote: z.string(),
  url: z.string().nullable(),
  added_in_revision: z.number().int().min(1),
  created_at: Timestamp,
});
export type EvidenceView = z.infer<typeof EvidenceView>;

export const CheckRunView = z.object({
  result: CheckResult,
  context: z.enum(["default_branch", "pr", "local"]),
  sha: z.string(),
  ran_at: Timestamp,
});

export const CheckView = z.object({
  id: Id,
  entry_key: z.string(),
  kind: CheckKind,
  spec: z.record(z.string(), z.unknown()),
  status: CheckStatus,
  revision: z.number().int().min(1),
  last_run: CheckRunView.nullable(),
});
export type CheckView = z.infer<typeof CheckView>;

export const ConflictView = z.object({
  id: Id,
  entry_key: z.string(),
  origin: z.enum(["pr", "default_branch", "local"]),
  pr_number: z.number().int().nullable(),
  sha: z.string(),
  method: z.enum(["check", "judge"]),
  summary: z.string(),
  status: ConflictStatus,
  created_at: Timestamp,
  resolved_at: Timestamp.nullable(),
});
export type ConflictView = z.infer<typeof ConflictView>;

export const Entry = EntrySummary.extend({
  rationale: z.string().nullable(),
  alternatives_rejected: z.array(z.string()),
  owner_hint: z.string().nullable(),
  origin: z.string(),
  created_at: Timestamp,
  superseded_by: z.string().nullable(),
  revision: z.number().int().min(1),
  revisions: z.array(Revision),
  evidence: z.array(EvidenceView),
  links: z.array(
    z.object({
      relation: z.enum(["supersedes", "refines", "duplicates", "conflicts_with", "answers"]),
      direction: z.enum(["out", "in"]),
      key: z.string(),
    }),
  ),
  checks: z.array(CheckView),
  conflicts: z.array(ConflictView),
  events: z.array(z.object({ kind: z.string(), by: z.enum(["person", "align", "system"]), created_at: Timestamp })),
});
export type Entry = z.infer<typeof Entry>;
