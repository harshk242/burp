FROM oven/bun:1.3-alpine AS base
WORKDIR /app

RUN apk add --no-cache nodejs npm

FROM base AS mcp-build
COPY mcp-server/package.json mcp-server/bun.lock ./mcp-server/
RUN cd mcp-server && bun install
COPY mcp-server ./mcp-server
RUN cd mcp-server && bun run build

FROM base AS web-build

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY app/web/package.json app/web/bun.lock ./web/
RUN cd web && bun install
COPY app/shared ./shared
COPY app/web ./web
RUN cd web && bun run build

FROM base AS server-build
COPY app/package.json app/bun.lock ./
RUN bun install
COPY app/shared ./shared
COPY app/server ./server

FROM base AS runner

COPY --from=mcp-build /app/mcp-server ./mcp-server

COPY --from=web-build /app/web/out ./public

COPY --from=server-build /app/shared ./shared
COPY --from=server-build /app/server ./server
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

CMD ["bun", "run", "server/index.ts"]
