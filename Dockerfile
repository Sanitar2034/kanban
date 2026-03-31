# ─────────────────────────────────────────────────────────────────────────────
# Cline Kanban — Multi-stage, multi-arch Dockerfile
#
# Supported platforms: linux/amd64, linux/arm64
#
# Build:
#   docker build -t cline-kanban:latest .
#
# Multi-arch (requires buildx):
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     --tag cline-kanban:latest --push .
#
# Run:
#   docker compose up   (with docker-compose.yml + .env)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Compiles TypeScript, builds the web UI, and downloads the cloudflared binary.
# Uses the full bookworm image so native addons (node-pty, better-sqlite3) can
# be compiled with python3, make, and g++.
FROM node:22-bookworm AS builder

ARG TARGETARCH

WORKDIR /app

# Build toolchain for native Node addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Install root dependencies ─────────────────────────────────────────────────
# Copy lockfiles first to maximise layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# ── Install web-ui dependencies ───────────────────────────────────────────────
COPY web-ui/package.json web-ui/package-lock.json ./web-ui/
RUN npm ci --prefix web-ui

# ── Copy source and build ─────────────────────────────────────────────────────
# Copying the full source after dependency install keeps the npm ci layers cached
# even when only source files change.
COPY . .

# Build everything:
#   - web-ui Vite build → web-ui/dist/
#   - esbuild: dist/cli.js, dist/index.js, dist/docker-init.js
#   - Copies web-ui/dist → dist/web-ui/
#   - Sentry upload is skipped (no SENTRY_AUTH_TOKEN in Docker builds)
RUN npm run build

# Patch the Cline SDK's OAuth success HTML to redirect to /auth/finalize
# instead of trying to close the window. This enables the server-side OAuth
# flow (used for remote logins) to redirect the browser back into Kanban.
COPY scripts/patch-sdk-oauth.js ./scripts/patch-sdk-oauth.js
RUN node scripts/patch-sdk-oauth.js

# ── Download cloudflared binary ───────────────────────────────────────────────
# Architecture-aware download: amd64 for x86_64, arm64 for aarch64.
# Pre-installing avoids the runtime download in cloudflare-tunnel.ts and makes
# the container work in airgapped environments.
RUN ARCH=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "amd64") && \
    curl -fsSL \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
      -o /tmp/cloudflared && \
    chmod +x /tmp/cloudflared


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
# Minimal runtime image. No build tools — only what's needed to run the server.
FROM node:22-bookworm-slim

WORKDIR /app

# Runtime system dependencies:
#   git     — required for all workspace operations (worktrees, diffs, commits)
#   ca-certificates — required for HTTPS requests (WorkOS, api.cline.bot)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Install cloudflared system-wide so findBin() finds it on PATH immediately
COPY --from=builder /tmp/cloudflared /usr/local/bin/cloudflared

# Copy and make entrypoint executable
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# ── Runtime configuration ─────────────────────────────────────────────────────

# Set HOME to /data so all ~/.cline/ paths resolve to /data/.cline/
# This is the only persistent data directory needed.
ENV HOME=/data

# Bind to all interfaces — required for the server to be reachable outside the container.
# Default 127.0.0.1 would make the server unreachable.
ENV KANBAN_RUNTIME_HOST=0.0.0.0
ENV KANBAN_RUNTIME_PORT=3484

# Disable runtime auto-update (npm install at runtime is inappropriate in a container)
ENV KANBAN_NO_AUTO_UPDATE=1

# Production mode
ENV NODE_ENV=production

# Use /data/.gitconfig as the global git config (written by docker-entrypoint.sh)
ENV GIT_CONFIG_GLOBAL=/data/.gitconfig

# Declare the persistent data volume.
# Bind-mount your git repositories separately (see docker-compose.yml).
VOLUME ["/data"]

EXPOSE 3484

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/cli.js", "--no-open"]
