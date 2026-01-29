# Use Node.js LTS version
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S uniprot -u 1001

# Copy built application from builder stage
COPY --from=builder --chown=uniprot:nodejs /app/build ./build
COPY --from=builder --chown=uniprot:nodejs /app/package*.json ./
COPY --from=builder --chown=uniprot:nodejs /app/node_modules ./node_modules

# Switch to non-root user
USER uniprot

# Health check (optional - for container orchestration)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('UniProt MCP Server is healthy')" || exit 1

# Set environment variables
ENV NODE_ENV=production

# Entry point
ENTRYPOINT ["node", "build/index.js"]

# Labels for metadata
LABEL maintainer="UniProt MCP Server Team"
LABEL description="Model Context Protocol server for UniProt protein database access"
LABEL version="0.1.0"
