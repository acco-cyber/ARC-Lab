# ARC Lab — HuggingFace Space (Docker)
# Next.js app + the vendored acco-cyber/ARC-AGI-2 arcjepa Python engine.

FROM oven/bun:1 AS base
WORKDIR /app

# Python engine deps (arcjepa symbolic mode needs python3 + numpy only)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --break-system-packages --no-cache-dir numpy \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY . .

# Build-time env
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/app/db/custom.db

# Generate Prisma client + build
RUN bunx prisma generate || npx prisma generate
RUN bun run build

# Runtime
ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/app/db/custom.db
ENV PYTHONUNBUFFERED=1

EXPOSE 7860

# Create db dir, push schema, start (engine/ is reachable at /app/engine)
CMD ["sh", "-c", "mkdir -p /app/db && bunx prisma db push --skip-generate --accept-data-loss && bun run start"]
