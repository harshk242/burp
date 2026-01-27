import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { accessRequestQueries } from "../db";

const waitlist = new Hono();

// POST /api/waitlist - Submit access request (public)
waitlist.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { email, name, institution, research_area, use_case } = body;

    if (!email || !name) {
      return c.json({ error: "Email and name are required" }, 400);
    }

    // Check if already exists
    const existing = accessRequestQueries.findByEmail(email);
    if (existing) {
      return c.json({ error: "Access request already submitted" }, 409);
    }

    const id = uuidv4();
    accessRequestQueries.create(
      id,
      email,
      name,
      institution || null,
      research_area || null,
      use_case || null
    );

    return c.json({ message: "Access request submitted", id }, 201);
  } catch (error) {
    console.error("Error creating access request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /api/waitlist - List pending requests (Admin only)
waitlist.get("/", async (c) => {
  // TODO: Add admin auth check in Phase 2
  try {
    const requests = accessRequestQueries.findPending();
    return c.json({ requests });
  } catch (error) {
    console.error("Error fetching access requests:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/waitlist/:id/approve - Approve request (Admin only)
waitlist.post("/:id/approve", async (c) => {
  // TODO: Add admin auth check in Phase 2
  const { id } = c.req.param();

  try {
    const request = accessRequestQueries.findById(id);
    if (!request) {
      return c.json({ error: "Request not found" }, 404);
    }

    // TODO: Get admin user id from auth context
    accessRequestQueries.approve(id, null);
    return c.json({ message: "Request approved" });
  } catch (error) {
    console.error("Error approving request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// POST /api/waitlist/:id/reject - Reject request (Admin only)
waitlist.post("/:id/reject", async (c) => {
  // TODO: Add admin auth check in Phase 2
  const { id } = c.req.param();

  try {
    const request = accessRequestQueries.findById(id);
    if (!request) {
      return c.json({ error: "Request not found" }, 404);
    }

    accessRequestQueries.reject(id, null);
    return c.json({ message: "Request rejected" });
  } catch (error) {
    console.error("Error rejecting request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { waitlist };
