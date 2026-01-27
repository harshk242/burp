import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { v4 as uuidv4 } from "uuid";
import { accessRequestQueries } from "../db";
import {
  CreateAccessRequestSchema,
  AccessRequestCreatedSchema,
  AccessRequestListSchema,
  ErrorSchema,
  MessageSchema,
} from "../schemas";

const waitlist = new OpenAPIHono();

// ============================================
// POST /api/waitlist - Submit access request (public)
// ============================================

const submitRequestRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Waitlist"],
  summary: "Submit access request",
  description: "Submit a request to access the Super Bio Agent platform. No authentication required.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateAccessRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: "Access request submitted successfully",
      content: {
        "application/json": {
          schema: AccessRequestCreatedSchema,
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: "Access request already exists for this email",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

waitlist.openapi(submitRequestRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    const { email, name, institution, research_area, use_case } = body;

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

// ============================================
// GET /api/waitlist - List pending requests (Admin only)
// ============================================

const listRequestsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Waitlist"],
  summary: "List pending access requests",
  description: "Get all pending access requests. Requires admin authentication.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "List of pending access requests",
      content: {
        "application/json": {
          schema: AccessRequestListSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    403: {
      description: "Forbidden - Admin access required",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

waitlist.openapi(listRequestsRoute, async (c) => {
  // TODO: Add admin auth check in Phase 2
  try {
    const requests = accessRequestQueries.findPending();
    return c.json({ requests }, 200);
  } catch (error) {
    console.error("Error fetching access requests:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================
// POST /api/waitlist/:id/approve - Approve request (Admin only)
// ============================================

const approveRequestRoute = createRoute({
  method: "post",
  path: "/{id}/approve",
  tags: ["Waitlist"],
  summary: "Approve access request",
  description: "Approve a pending access request. Requires admin authentication.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
  },
  responses: {
    200: {
      description: "Request approved",
      content: {
        "application/json": {
          schema: MessageSchema,
        },
      },
    },
    404: {
      description: "Request not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

waitlist.openapi(approveRequestRoute, async (c) => {
  const { id } = c.req.valid("param");

  try {
    const request = accessRequestQueries.findById(id);
    if (!request) {
      return c.json({ error: "Request not found" }, 404);
    }

    // TODO: Get admin user id from auth context
    accessRequestQueries.approve(id, null);
    return c.json({ message: "Request approved" }, 200);
  } catch (error) {
    console.error("Error approving request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ============================================
// POST /api/waitlist/:id/reject - Reject request (Admin only)
// ============================================

const rejectRequestRoute = createRoute({
  method: "post",
  path: "/{id}/reject",
  tags: ["Waitlist"],
  summary: "Reject access request",
  description: "Reject a pending access request. Requires admin authentication.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    }),
  },
  responses: {
    200: {
      description: "Request rejected",
      content: {
        "application/json": {
          schema: MessageSchema,
        },
      },
    },
    404: {
      description: "Request not found",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

waitlist.openapi(rejectRequestRoute, async (c) => {
  const { id } = c.req.valid("param");

  try {
    const request = accessRequestQueries.findById(id);
    if (!request) {
      return c.json({ error: "Request not found" }, 404);
    }

    accessRequestQueries.reject(id, null);
    return c.json({ message: "Request rejected" }, 200);
  } catch (error) {
    console.error("Error rejecting request:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { waitlist };
