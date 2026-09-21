# Desk

Desk is a small operations product built as a React client and an Express API. PostgreSQL data is normalized through Prisma in the dedicated `desk` schema. The deployment uses one frontend service, one API service, and no workers, queues, Redis, or schedulers.

## Local setup

Requirements: Node.js 22+, npm 10+, and PostgreSQL 15+.

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

The frontend runs at `http://localhost:3000`; the API runs at `http://localhost:4000`. Vite proxies `/api` to the API during local development.

The database URL must contain `schema=desk`. This keeps Desk tables and Prisma migration history out of the shared `public` schema used by Frames 41.

## Structure

- `frontend/` contains React 19, Vite, React Router, the typed API client, feature UI, and styles.
- `backend/` contains Express, authentication and authorization middleware, Prisma, domain services, integration handling, and migration scripts.
- `backend/prisma/migrations/` is the only supported way to change production tables.

The API uses opaque, hashed server-side sessions. Browser mutations require the request's own origin or an exact origin in `FRONTEND_ORIGINS`, plus a CSRF header matching the CSRF cookie. Reverse proxies serving the frontend and API together must preserve the browser-facing `Host` and set `X-Forwarded-Proto` to the original protocol. Separate frontend deployments must list their full origins in `FRONTEND_ORIGINS`. Integration requests use HMAC-SHA256 over `timestamp + "." + rawBody`, a five-minute timestamp window, and idempotency keys.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run db:migrate
```

Do not use `prisma db push` against a shared or production database.

## Legacy migration

Take and verify a database backup before migration. Set `MIGRATION_TARGET_HOST` and `MIGRATION_TARGET_DATABASE` to the exact reviewed target; the script refuses any other database.

```bash
npm run db:migrate
npm run db:migrate-legacy -- --dry-run
npm run db:migrate-legacy
npm run db:validate-migration
```

The migration reads and locks `public.fieldflow_state`, creates normalized records under `desk`, preserves UUIDs where possible, deterministically maps legacy IDs, and records the source revision and checksum. It is idempotent. Any unresolved legacy outbox events block the write run and must be reconciled first.

During the seven-day rollback window, generate an export for review with:

```bash
npm run db:export-legacy
```

Writing it back to `public.fieldflow_state` requires both `--write` and `ALLOW_LEGACY_EXPORT=true`.

## Integration delivery

Incoming paid-order events are validated and committed with their inbox record in one transaction. Outgoing status changes are committed locally first and sent before the API request completes with a four-second timeout. Failures remain on the order and can be retried by an Admin or Manager. The receiver must treat the event ID as an idempotency key.

## API documentation

- [Custom order form API](docs/custom-order-form-api.md) — discover workspace fields and submit orders with typed custom-field values.

There are no automatic retries. A failed or interrupted callback remains visible for manual retry, and the latest order version wins over stale responses.

## Railway

Create separate frontend and backend services from this repository. The backend start command is `npm run start`; its health path is `/api/v1/health`. Run `npm run db:migrate` as the backend pre-deploy command. The frontend build command is `npm run build -w frontend`, with `frontend/dist` as its output.

Use Railway private networking for PostgreSQL and the Frames service. Never expose `DATABASE_URL` or `DF_INTEGRATION_SECRET` through a `VITE_*` variable.
