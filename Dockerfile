FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

RUN apk add --no-cache nodejs npm

FROM base AS mcp-build
COPY mcp-server/package.json mcp-server/bun.lock ./mcp-server/
RUN cd mcp-server && bun install
COPY tsconfig.base.json ./
COPY mcp-server ./mcp-server
RUN cd mcp-server && bun run build

FROM base AS web-build

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Mirror the repo layout so app/web/tsconfig.json can extend ../../tsconfig.base.json.
COPY app/web/package.json app/web/bun.lock ./app/web/
RUN cd app/web && bun install
COPY tsconfig.base.json ./
COPY app/shared ./app/shared
COPY app/web ./app/web
RUN cd app/web && bun run build

FROM base AS server-build
COPY app/package.json app/bun.lock ./
RUN bun install
COPY app/shared ./shared
COPY app/server ./server
COPY app/scripts/build-server.ts ./scripts/
RUN bun run build:server

FROM base AS runner

COPY --from=mcp-build /app/mcp-server ./mcp-server

COPY --from=web-build /app/app/web/out ./public

# The bundle must stay at server/index.js: APP_DIR resolves config.yaml and migrations from it.
COPY --from=server-build /app/dist/server ./server
COPY --from=server-build /app/server/db/migrations ./server/db/migrations
# Runtime externals (node-jq's jq binary) still resolve from node_modules.
COPY --from=server-build /app/node_modules ./node_modules

COPY app/config.yaml ./

RUN mkdir -p /app/data

ENV PORT=3000
ENV DATABASE_URL=/app/data/app.db
ENV MCP_SERVERS_BASE=/app/mcp-server

ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["bun", "server/index.js"]
