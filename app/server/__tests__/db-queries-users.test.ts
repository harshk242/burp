import { beforeEach, describe, expect, it } from "bun:test";
import { createTestDb, type TestDb } from "../__test-utils__/db";
import { createQueries, type Queries } from "../db/queries";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

let t: TestDb;
let q: Queries;

beforeEach(() => {
  t = createTestDb();
  q = createQueries(t.db);
});

function addUser(id = USER_ID, email = "a@example.com", role = "user") {
  q.userQueries.create(id, `clerk_${id}`, email, "Ada", null, role, "MIT", null);
}

describe("userQueries", () => {
  it("returns null (not undefined) when a user is missing", () => {
    expect(q.userQueries.findById("nope")).toBeNull();
    expect(q.userQueries.findByEmail("nope@example.com")).toBeNull();
    expect(q.userQueries.findByClerkId("nope")).toBeNull();
  });

  it("creates a user with schema defaults and snake_case keys", () => {
    addUser();
    const user = q.userQueries.findByClerkId(`clerk_${USER_ID}`)!;
    expect(Object.keys(user).sort()).toEqual(
      [
        "clerk_id",
        "created_at",
        "daily_cost_limit_microusd",
        "daily_query_limit",
        "daily_token_limit",
        "email",
        "id",
        "image_url",
        "institution",
        "last_active_at",
        "monthly_cost_limit_microusd",
        "name",
        "research_area",
        "role",
        "total_queries",
      ].sort()
    );
    expect(user).toMatchObject({ id: USER_ID, email: "a@example.com", role: "user", total_queries: 0, last_active_at: null });
    expect(typeof user.created_at).toBe("number");
    expect(q.userQueries.findByEmail("a@example.com")?.id).toBe(USER_ID);
  });

  it("updates role, limits, activity and query counter", () => {
    addUser();
    q.userQueries.updateRole(USER_ID, "admin");
    q.userQueries.updateLimits(USER_ID, 10, 1000, null, 5_000_000);
    q.userQueries.updateLastActive(USER_ID);
    q.userQueries.incrementQueries(USER_ID);
    q.userQueries.incrementQueries(USER_ID);
    const user = q.userQueries.findById(USER_ID)!;
    expect(user).toMatchObject({
      role: "admin",
      total_queries: 2,
      daily_query_limit: 10,
      daily_token_limit: 1000,
      daily_cost_limit_microusd: null,
      monthly_cost_limit_microusd: 5_000_000,
    });
    expect(user.last_active_at).toBeNumber();

    q.userQueries.updateLimits(USER_ID, null, null, null, null);
    expect(q.userQueries.findById(USER_ID)!.daily_query_limit).toBeNull();
  });

  it("rejects roles outside the CHECK constraint", () => {
    expect(() => addUser(USER_ID, "a@example.com", "superuser")).toThrow();
  });

  it("lists users newest first", () => {
    addUser(USER_ID, "a@example.com");
    addUser(OTHER_ID, "b@example.com");
    t.sqlite.run("UPDATE users SET created_at = 100 WHERE id = ?", [USER_ID]);
    t.sqlite.run("UPDATE users SET created_at = 200 WHERE id = ?", [OTHER_ID]);
    expect(q.userQueries.listAll().map((u) => u.id)).toEqual([OTHER_ID, USER_ID]);
  });
});

describe("accessRequestQueries", () => {
  const REQ = "33333333-3333-4333-8333-333333333333";
  const REQ2 = "44444444-4444-4444-8444-444444444444";

  it("creates pending requests and finds them", () => {
    expect(q.accessRequestQueries.findById(REQ)).toBeNull();
    expect(q.accessRequestQueries.findByEmail("r@example.com")).toBeNull();
    q.accessRequestQueries.create(REQ, "r@example.com", "Rosalind", null, "Genomics", "research");
    const req = q.accessRequestQueries.findByEmail("r@example.com")!;
    expect(req).toMatchObject({ id: REQ, status: "pending", research_area: "Genomics", reviewed_at: null, reviewed_by: null });
    expect(req.submitted_at).toBeNumber();
    expect(q.accessRequestQueries.findPending().map((r) => r.id)).toEqual([REQ]);
  });

  it("approve/reject stamp the reviewer and leave the pending list", () => {
    addUser();
    q.accessRequestQueries.create(REQ, "r@example.com", "R", null, null, null);
    q.accessRequestQueries.create(REQ2, "s@example.com", "S", null, null, null);
    t.sqlite.run("UPDATE access_requests SET submitted_at = 100 WHERE id = ?", [REQ]);
    t.sqlite.run("UPDATE access_requests SET submitted_at = 200 WHERE id = ?", [REQ2]);
    expect(q.accessRequestQueries.findAll().map((r) => r.id)).toEqual([REQ2, REQ]);

    q.accessRequestQueries.approve(REQ, USER_ID);
    q.accessRequestQueries.reject(REQ2, null);
    expect(q.accessRequestQueries.findById(REQ)).toMatchObject({ status: "approved", reviewed_by: USER_ID });
    expect(q.accessRequestQueries.findById(REQ)!.reviewed_at).toBeNumber();
    expect(q.accessRequestQueries.findById(REQ2)).toMatchObject({ status: "rejected", reviewed_by: null });
    expect(q.accessRequestQueries.findPending()).toEqual([]);
  });
});

describe("chatSessionQueries + messageQueries", () => {
  const S1 = "55555555-5555-4555-8555-555555555555";
  const S2 = "66666666-6666-4666-8666-666666666666";
  const M1 = "77777777-7777-4777-8777-777777777777";
  const M2 = "88888888-8888-4888-8888-888888888888";

  beforeEach(() => addUser());

  it("creates, orders, renames, touches and deletes sessions", () => {
    expect(q.chatSessionQueries.findById(S1)).toBeNull();
    q.chatSessionQueries.create(S1, USER_ID, null);
    q.chatSessionQueries.create(S2, USER_ID, "Second");
    t.sqlite.run("UPDATE chat_sessions SET updated_at = 100 WHERE id = ?", [S1]);
    t.sqlite.run("UPDATE chat_sessions SET updated_at = 200 WHERE id = ?", [S2]);
    expect(q.chatSessionQueries.findByUserId(USER_ID).map((s) => s.id)).toEqual([S2, S1]);

    q.chatSessionQueries.updateTitle(S1, "First");
    const s1 = q.chatSessionQueries.findById(S1)!;
    expect(s1.title).toBe("First");
    expect(s1.updated_at!).toBeGreaterThan(200);
    expect(q.chatSessionQueries.findByUserId(USER_ID)[0]!.id).toBe(S1);

    t.sqlite.run("UPDATE chat_sessions SET updated_at = 1 WHERE id = ?", [S2]);
    q.chatSessionQueries.touch(S2);
    expect(q.chatSessionQueries.findById(S2)!.updated_at!).toBeGreaterThan(1);

    q.chatSessionQueries.delete(S2);
    expect(q.chatSessionQueries.findById(S2)).toBeNull();
    expect(q.chatSessionQueries.findByUserId(OTHER_ID)).toEqual([]);
  });

  it("stores messages with token/cost defaults and cascades on session delete", () => {
    q.chatSessionQueries.create(S1, USER_ID, null);
    q.messageQueries.create(M1, S1, "user", "hi", null);
    q.messageQueries.create(M2, S1, "assistant", "hello", '[{"id":"t"}]', 12, 34, "thinking", 560);
    t.sqlite.run("UPDATE messages SET created_at = 100 WHERE id = ?", [M2]);
    t.sqlite.run("UPDATE messages SET created_at = 200 WHERE id = ?", [M1]);

    expect(q.messageQueries.findById(M1)).toMatchObject({
      role: "user",
      tool_calls: null,
      input_tokens: 0,
      output_tokens: 0,
      reasoning: null,
      cost_microusd: 0,
    });
    expect(q.messageQueries.findById(M2)).toMatchObject({
      tool_calls: '[{"id":"t"}]',
      input_tokens: 12,
      output_tokens: 34,
      reasoning: "thinking",
      cost_microusd: 560,
    });
    expect(q.messageQueries.findByChatId(S1).map((m) => m.id)).toEqual([M2, M1]);

    q.chatSessionQueries.delete(S1);
    expect(q.messageQueries.findById(M1)).toBeNull();
    expect(q.messageQueries.findByChatId(S1)).toEqual([]);
  });

  it("db.transaction() rolls back every global-query write on throw", () => {
    q.chatSessionQueries.create(S1, USER_ID, null);
    expect(() =>
      t.db.transaction(() => {
        q.messageQueries.create(M1, S1, "assistant", "x", null);
        q.userQueries.incrementQueries(USER_ID);
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(q.messageQueries.findById(M1)).toBeNull();
    expect(q.userQueries.findById(USER_ID)!.total_queries).toBe(0);

    t.db.transaction(() => {
      q.messageQueries.create(M1, S1, "assistant", "x", null);
      q.userQueries.incrementQueries(USER_ID);
    });
    expect(q.messageQueries.findById(M1)).not.toBeNull();
    expect(q.userQueries.findById(USER_ID)!.total_queries).toBe(1);
  });
});
