# ZipLink

A URL shortener that converts long URLs into short links.

## Tech stack

Taken from `package.json` and the source files provided:

- TanStack Start (React 19, TanStack Router), Vite 8, Tailwind CSS 4
- Nitro 3 (beta) for the production server build
- PostgreSQL via Drizzle ORM (`drizzle-orm`, `postgres`, `drizzle-kit`)
- Redis: Upstash REST (`@upstash/redis`) or a standard Redis server (`ioredis`), with an in-memory fallback
- Package manager: Bun (`bun.lock`)

## Project structure

```
src/
  routes/          File-based routes (home, $slug redirect, auth/login, auth/signup, dashboard)
  components/      UI components (shadcn/ui in components/ui)
  lib/             Server logic: auth, shortener, ratelimit, redis, server functions
  lib/db/          Drizzle connection and schema
  server.ts        Server entry (wraps TanStack Start with an error page fallback)
  start.ts         Request middleware (error handling, CSRF for server functions)
drizzle.config.ts  Drizzle Kit config (schema: src/lib/db/schema.ts, output: ./drizzle)
```

## Prerequisites

- [Bun](https://bun.sh)
- A PostgreSQL database
- Optional: Redis or an Upstash Redis database
- Optional: Docker

## Setup

```bash
bun install
cp .env.example .env   # then fill in your own values
bun run dev            # http://localhost:3000
```

## Scripts

| Script | Command |
| --- | --- |
| `dev` | `vite dev --port 3000` |
| `build` | `vite build` (produces `.output/` via Nitro) |
| `build:dev` | `vite build --mode development` |
| `preview` | `vite preview` |
| `lint` | `eslint .` |
| `format` | `prettier --write .` |

There is no `start` script. The production server is started with `node .output/server/index.mjs`.

## Environment variables

All variables are read at runtime from `process.env`. None are needed at build time.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `APP_URL` | Public base URL used to build short links. Falls back to `SITE_URL`, then `VITE_APP_URL`, then `http://localhost:3000`. **Set it in production**, otherwise links point at localhost. |
| `NODE_ENV` | `production` enables secure cookies and quieter cache logging. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis. Used when both are set. |
| `REDIS_URL` | Standard Redis (TCP). Used only if the Upstash variables are not set. |
| `PORT` / `HOST` | Not read by the app code. Handled by the Nitro server (see Docker). |

`.env.example` also lists `SESSION_SECRET`, but no code under `src/` reads it.

### Redis behavior

Provider choice: Upstash if both Upstash variables are set, otherwise `REDIS_URL`, otherwise an in-memory cache. In-memory data (including sessions) is lost on restart and not shared between instances. In production the "no provider configured" case is not logged, so check that your variables are set.

## Database and migrations

Drizzle Kit reads `DATABASE_URL` and the schema at `src/lib/db/schema.ts`. No `db:*` scripts or `drizzle/` migration folder were provided, so the migration workflow is not documented here yet. Run Drizzle Kit commands from your machine against the target database, for example:

```bash
bunx drizzle-kit push
```

Not run or verified yet. The Docker image does not apply the schema.

## Docker

```bash
docker build -t ziplink .
docker run --rm -p 3000:3000 -e PORT=3000 --env-file .env.docker ziplink
```

Notes:

- The image builds with Bun on Node 22, then runs `node .output/server/index.mjs` on Node 22 as a non-root user.
- `--env-file` does not strip quotes. In `.env.docker`, write values without quotes (`APP_URL=http://localhost:3000`) and do not set `NODE_ENV=development`.
- Inside a container, `localhost` is the container itself. Use `host.docker.internal` for a database or Redis running on your host.
- With `NODE_ENV=production`, session cookies are `secure`, so some browsers may not keep them over plain `http://localhost`.

## Deploy to Render

1. Push the repository to GitHub/GitLab.
2. Create a **Web Service** and choose **Docker** as the runtime (Dockerfile at the repo root).
3. Add environment variables: `DATABASE_URL`, `APP_URL` (your Render URL or custom domain), and either the two Upstash variables or `REDIS_URL`.
4. Render injects `PORT`; the Dockerfile sets `HOST=0.0.0.0`.
5. Apply the database schema before first use (see above).

## Security notes

- Never commit `.env` or real credentials. `.dockerignore` excludes `.env` and `.env.*` (except `.env.example`).
- Pass secrets through your host's environment settings, not build args.
- Server functions are protected by CSRF middleware (`src/start.ts`).

## Troubleshooting

- **Short links show `localhost:3000`**: `APP_URL` is not set.
- **Sessions lost after restart or redeploy**: no Redis provider is configured, so the in-memory cache is in use.
- **Cannot stay logged in when running the production image locally**: secure cookie over plain HTTP (see Docker notes).
- **403 on login/signup after deploy**: check the CSRF middleware behavior behind Render's proxy.
