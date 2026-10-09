/**
 * Type-level test (compiled by `bun run typecheck`, never executed): the
 * Drizzle row types must stay compatible with the hand-written Zod API types.
 *
 * - forward: every DB row is assignable to its API type (no nullable column
 *   where the API promises a value, no type mismatch);
 * - reverse: every non-null DB column is part of the API type, so adding a
 *   column to the schema forces a decision about the API.
 */
import type { z } from "@hono/zod-openapi";
import type {
  AccessRequestSchema,
  ChatSessionSchema,
  MessageSchema2,
  UsageEventSchema,
  UserSchema,
} from "../schemas";
import type { DbAccessRequest, DbChatSession, DbMessageRow, DbUsageEvent, DbUser } from "../types";

type Assert<T extends true> = T;
type IsAssignable<A, B> = [A] extends [B] ? true : false;
type NonNullKeys<T> = { [K in keyof T]-?: null extends T[K] ? never : undefined extends T[K] ? never : K }[keyof T];
type NoMissingNonNullColumns<Db, Api> = [Exclude<NonNullKeys<Db>, keyof Api>] extends [never] ? true : false;
type Compatible<Db, Api> = IsAssignable<Db, Api> extends true ? NoMissingNonNullColumns<Db, Api> : false;

// tool_calls is serialized JSON in the DB and parsed into objects by the API layer.
type ApiMessageRow = Omit<z.infer<typeof MessageSchema2>, "tool_calls"> & { tool_calls: string | null };

export type RowTypeChecks = [
  Assert<Compatible<DbUser, z.infer<typeof UserSchema>>>,
  Assert<Compatible<DbAccessRequest, z.infer<typeof AccessRequestSchema>>>,
  Assert<Compatible<DbChatSession, z.infer<typeof ChatSessionSchema>>>,
  Assert<Compatible<DbMessageRow, ApiMessageRow>>,
  Assert<Compatible<DbUsageEvent, z.infer<typeof UsageEventSchema>>>,
];
