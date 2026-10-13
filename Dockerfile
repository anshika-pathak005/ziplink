# syntax=docker/dockerfile:1

# ---------- Build stage ----------
# Node is needed because Vite's CLI runs on Node; Bun is copied in only to keep
# using the project's package manager (bun.lock).
FROM node:22-slim AS build
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Install dependencies first so this layer is cached until the lockfile changes.
# NODE_ENV is intentionally NOT set to production here: devDependencies are
# required for `vite build`.
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .

# Force the Node server output from Nitro (UNTESTED: confirm with `docker build`).
ENV NITRO_PRESET=node-server
RUN bun run build

# Fail the build early if the expected entry point was not produced.
RUN test -f .output/server/index.mjs

# ---------- Runtime stage ----------
# Nitro bundles server dependencies into .output, so node_modules is not copied.
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000

WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 10000

# Secrets (DATABASE_URL, Redis/Upstash vars, APP_URL) are read from process.env
# at runtime and must be supplied by the platform, never baked into the image.
CMD ["node", ".output/server/index.mjs"]
