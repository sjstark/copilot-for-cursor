# Multi-stage build for optimal image size
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json ./
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build step needed for Bun runtime

# Production image
FROM oven/bun:1-slim AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bunuser

# Copy application files
COPY --from=builder --chown=bunuser:nodejs /app/*.ts ./
COPY --from=builder --chown=bunuser:nodejs /app/dashboard.html ./
COPY --from=builder --chown=bunuser:nodejs /app/package.json ./

# Create data directory for persistence
RUN mkdir -p /app/data && chown bunuser:nodejs /app/data

USER bunuser

# Expose ports
EXPOSE 4141 4142

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun -e "fetch('http://localhost:4142/api/usage').then(r => r.ok ? process.exit(0) : process.exit(1))" || exit 1

# Default command
CMD ["bun", "run", "start.ts"]
