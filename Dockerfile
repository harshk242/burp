FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Install Node.js for MCP server execution
# MCP servers use @modelcontextprotocol/sdk which requires Node
RUN apk add --no-cache nodejs npm

# Build MCP servers
FROM base AS mcp-build
COPY *-mcp-server ./servers/
RUN for dir in servers/*/; do \
      echo "Building $dir..." && \
      cd "$dir" && \
      bun install && \
      bun run build && \
      cd ../.. ; \
    done

# Build web UI (static export)
FROM base AS web-build

# NEXT_PUBLIC_* vars must be available at build time
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY app/web ./web
RUN cd web && bun install && bun run build
# Output is in ./web/out (static HTML/CSS/JS)

# Build server
FROM base AS server-build
COPY app/server ./server
COPY app/package.json ./
RUN bun install

# Final image
FROM base AS runner

# Copy MCP servers (built artifacts)
COPY --from=mcp-build /app/servers ./servers

# Copy web static files (served by Hono)
COPY --from=web-build /app/web/out ./public

# Copy server
COPY --from=server-build /app/server ./server
COPY --from=server-build /app/node_modules ./node_modules

# Create data directory for SQLite
RUN mkdir -p /app/data

# Environment
ENV PORT=3000
ENV DATABASE_URL=/app/data/app.db
ENV MCP_SERVERS_BASE=/app/servers

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["bun", "run", "server/index.ts"]
