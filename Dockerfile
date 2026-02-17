# ─────────────────────────────────────────────────────────────
#  smart-airport-cabpooling-backend — Dockerfile
#
#  Runtime  : Bun  (serves Express HTTP on :3000,
#                    Bun native WebSocket on :3001)
#  Services : PostgreSQL + Redis  (see docker-compose.yml)
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Install dependencies & generate Prisma client ──
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy dependency manifests first (better layer caching)
COPY package.json bun.lock ./

# Install ALL dependencies (including devDependencies for Prisma generate)
RUN bun install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Generate the Prisma client into /app/generated/prisma
RUN bunx prisma generate


# ── Stage 2: Production image ───────────────────────────────
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Copy dependency manifests and install production deps only
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy application source code
COPY --from=builder /app/index.ts ./index.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/prisma ./prisma

# Copy the generated Prisma client from the builder stage
COPY --from=builder /app/generated ./generated

# Expose HTTP (Express) and WebSocket (Bun native) ports
EXPOSE 3000 3001

# Run Prisma migrations, seed the database, then start the server.
# The entrypoint handles:
#   1. Retrying `prisma migrate deploy` until Postgres is reachable
#   2. Running the seed script (idempotent — safe to re-run)
#   3. Starting the Bun server
CMD ["sh", "-c", "\
  echo '⏳ Waiting for PostgreSQL to accept connections...' && \
  retries=0 && \
  max_retries=30 && \
  until bunx prisma migrate deploy 2>/dev/null; do \
    retries=$((retries + 1)); \
    if [ $retries -ge $max_retries ]; then \
      echo '❌ Could not connect to PostgreSQL after ${max_retries} attempts. Exiting.'; \
      exit 1; \
    fi; \
    echo \"⏳ Postgres not ready yet (attempt $retries/$max_retries). Retrying in 2s...\"; \
    sleep 2; \
  done && \
  echo '✅ Migrations applied successfully!' && \
  echo '🌱 Running database seed...' && \
  bun prisma/seed.ts && \
  echo '🚀 Starting server...' && \
  bun run index.ts \
"]
