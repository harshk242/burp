import { desc, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../connection";
import { accessRequests } from "../schema";
import type { DbAccessRequest } from "../../types";

export function createAccessRequestQueries(db: DrizzleDb) {
  function review(id: string, status: "approved" | "rejected", reviewedBy: string | null) {
    return db
      .update(accessRequests)
      .set({ status, reviewed_at: sql`(unixepoch())`, reviewed_by: reviewedBy })
      .where(eq(accessRequests.id, id))
      .run();
  }

  return {
    create(
      id: string,
      email: string,
      name: string,
      institution: string | null,
      researchArea: string | null,
      useCase: string | null
    ) {
      return db
        .insert(accessRequests)
        .values({ id, email, name, institution, research_area: researchArea, use_case: useCase })
        .run();
    },

    findByEmail(email: string): DbAccessRequest | null {
      return db.select().from(accessRequests).where(eq(accessRequests.email, email)).get() ?? null;
    },

    findPending(): DbAccessRequest[] {
      return db
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.status, "pending"))
        .orderBy(desc(accessRequests.submitted_at))
        .all();
    },

    findById(id: string): DbAccessRequest | null {
      return db.select().from(accessRequests).where(eq(accessRequests.id, id)).get() ?? null;
    },

    approve(id: string, reviewedBy: string | null) {
      return review(id, "approved", reviewedBy);
    },

    reject(id: string, reviewedBy: string | null) {
      return review(id, "rejected", reviewedBy);
    },

    findAll(): DbAccessRequest[] {
      return db.select().from(accessRequests).orderBy(desc(accessRequests.submitted_at)).all();
    },
  };
}
