# ARC Lab — HuggingFace Space (Docker)

FROM oven/bun:1 AS base
WORKDIR /app

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

EXPOSE 7860

# Create db dir, push schema, start
CMD ["sh", "-c", "mkdir -p /app/db && bunx prisma db push --skip-generate --accept-data-loss && bun run start"]
