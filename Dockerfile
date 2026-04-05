FROM oven/bun:1.3-alpine AS base
WORKDIR /app

# Install Node.js for MCP server execution
# MCP server uses @modelcontextprotocol/sdk which requires Node
RUN apk add --no-cache nodejs npm

# Build MCP server
FROM base AS mcp-build
COPY mcp-server/package.json mcp-server/bun.lock ./mcp-server/
RUN cd mcp-server && bun install
COPY mcp-server ./mcp-server
RUN cd mcp-server && bun run build

# Build web UI (static export)
FROM base AS web-build

# NEXT_PUBLIC_* vars must be available at build time
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY app/web/package.json app/web/bun.lock ./web/
RUN cd web && bun install
COPY app/web ./web
RUN cd web && bun run build
# Output is in ./web/out (static HTML/CSS/JS)

# Install server dependencies
FROM base AS server-build
COPY app/package.json app/bun.lock ./
RUN bun install
COPY app/server ./server

# Final image
FROM base AS runner

# Copy MCP server (built artifacts)
COPY --from=mcp-build /app/mcp-server ./mcp-server

# Copy web static files (served by Hono)
COPY --from=web-build /app/web/out ./public

# Copy server
COPY --from=server-build /app/server ./server
COPY --from=server-build /app/node_modules ./node_modules

# Copy runtime config directly (not via build stage to avoid cache busting)
COPY app/config.yaml ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Environment
ENV PORT=3000
ENV DATABASE_URL=/app/data/app.db
ENV MCP_SERVERS_BASE=/app/mcp-server

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["bun", "run", "server/index.ts"]
