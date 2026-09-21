# Next.js to Simple PERN + Prisma Migration

## Summary

Convert Desk into an npm-workspace monorepo for fewer than 10 users, with two applications:

- `frontend/`: React 19 + Vite + React Router + TanStack Query.
- `backend/`: Node.js + Express + Prisma + PostgreSQL, with one API process.

Keep the backend small: one Express application, Prisma queries in feature services, normalized tables, and explicit REST mutations. Do not add queues, workers, Redis, a scheduler, or separate background processes. Use a controlled cutover. Preserve all current workspace data and leave the legacy JSONB state untouched until migration validation and rollback coverage are complete.

The shared Railway PostgreSQL database already contains Frames 41 tables. Desk must use a dedicated PostgreSQL schema named `desk` via `DATABASE_URL=...?schema=desk`, giving it an independent Prisma migration history and preventing collisions with Frames models and `_prisma_migrations`.

## Target Repository Structure

```text
/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── App.tsx
│   │   │   ├── router.tsx
│   │   │   ├── providers.tsx
│   │   │   └── query-client.ts
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   ├── generated/
│   │   │   └── errors.ts
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── attendance/
│   │   │   ├── team/
│   │   │   ├── tasks/
│   │   │   ├── orders/
│   │   │   ├── payments/
│   │   │   ├── reports/
│   │   │   ├── integrations/
│   │   │   └── settings/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   ├── feedback/
│   │   │   └── ui/
│   │   ├── hooks/
│   │   ├── styles/
│   │   │   ├── tokens.css
│   │   │   └── globals.css
│   │   ├── test/
│   │   └── main.tsx
│   ├── public/
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/
│   │   ├── lib/
│   │   │   ├── prisma.ts
│   │   │   └── logger.ts
│   │   ├── middleware/
│   │   ├── shared/
│   │   │   ├── errors/
│   │   │   ├── http/
│   │   │   ├── money/
│   │   │   ├── security/
│   │   │   └── validation/
│   │   └── modules/
│   │       ├── auth/
│   │       ├── users/
│   │       ├── attendance/
│   │       ├── tasks/
│   │       ├── orders/
│   │       ├── payments/
│   │       ├── reports/
│   │       ├── integrations/
│   │       └── legacy-workspace/
│   ├── scripts/
│   │   ├── migrate-legacy-workspace.ts
│   │   ├── validate-migration.ts
│   │   └── export-legacy-workspace.ts
│   ├── tests/
│   └── package.json
├── pern.md
├── package.json
├── tsconfig.base.json
├── eslint.config.mjs
└── README.md
```

The root package uses npm workspaces for `frontend` and `backend`. Backend owns the OpenAPI contract; generated TypeScript types are committed under `frontend/src/api/generated`. No frontend code imports backend source files.

## Backend Architecture and Data Model

### Module standard

Start each backend feature with only the files it needs:

```text
module/
├── module.routes.ts
├── module.service.ts
└── module.schema.ts
```

- Routes handle HTTP input/output, authentication middleware and Zod validation.
- Services contain business rules and call the shared Prisma client directly.
- Use plain exported functions; no mandatory controller/repository layers, constructor injection or dependency-injection framework.
- Add separate types or helpers only when they are reused or make a large file easier to understand.
- Use Prisma transactions for related writes that must succeed together.
- Keep authorization checks on the server and scope queries to the workspace.
- Add focused tests for business rules, permissions and integration behavior.

### Prisma schema

Use UUID primary keys, UTC timestamps, explicit indexes, foreign keys, optimistic `version` columns on mutable aggregates, and soft archival where historical references must remain.

Core models:

- `Workspace`: tenant boundary, name, slug and timestamps.
- `User`: workspace, login name, password hash, role, active/archive state, profile information.
- `Session`: hashed opaque token, user, expiry, revocation and metadata.
- `AttendanceSession`: clock-in, clock-out and calculated duration.
- `ManualAttendance`: date, status, marker and audit timestamps.
- `Task`: workspace, optional order, title, status, progress, deadline and completion timestamps.
- `TaskAssignee`: task/user join, lead flag and responsibility.
- `Customer`: normalized name, email and phone for manual customers.
- `Order`: workspace, source, external IDs, customer, workflow status, promised deadline, assignment and integer-paise totals.
- `OrderAddress`: immutable delivery snapshot associated with an order.
- `OrderItem`: immutable product/SKU/variant/quantity and integer-paise snapshot.
- `OrderItemAsset`: customization image/file URLs and asset type.
- `Payment`: order, source, method, provider reference and integer-paise amounts.
- `OrderStatusHistory`: old/new status, actor, source, note and timestamp.
- `IntegrationConnection`: workspace, client key, API identity, display name, enabled state and last health result.
- `IntegrationInbox`: event ID, hash, payload, processing result and timestamp.
- Store the latest outbound sync state on `Order`: status (`pending`, `synced`, `failed`), last attempted version, last attempt time and sanitized error. This supports visible failures and manual retries without a job table.
- `AuditLog`: actor, action, aggregate, request ID and sanitized metadata.
- `MigrationRun`: legacy source revision, checksum, counts, result and timestamp.

Use Prisma `BigInt` for stored paise values. API serializers must emit a JSON number only after checking `Number.isSafeInteger`; reject unsafe values rather than silently truncating.

Do not create generic public-schema tables such as `users`, `orders` or `payments`. All Desk Prisma migrations run in the `desk` PostgreSQL schema.

### Authentication and security

Preserve opaque server-side sessions rather than introducing JWTs:

- Store only a SHA-256 hash of the random session token.
- Use an HTTP-only, secure cookie.
- Configure `SameSite`, cookie domain and allowed origins through validated environment variables.
- Enable credentialed CORS only for the exact frontend origins.
- Require CSRF tokens plus origin validation for browser mutations.
- Exempt signed integration endpoints from CSRF but retain HMAC verification.
- Apply rate limits to login, bootstrap, account changes and integration endpoints.
- Use scrypt or Argon2id with versioned password hashes.
- Centralize RBAC middleware for Admin, Manager and Employee permissions.
- Redact passwords, cookies, signatures and integration payload secrets from logs.

### API contract

New resource APIs:

```text
GET    /api/v1/health
GET    /api/v1/ready

POST   /api/v1/auth/bootstrap
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/session
PATCH  /api/v1/auth/account

GET    /api/v1/users
POST   /api/v1/users
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

GET    /api/v1/attendance
POST   /api/v1/attendance/clock-in
POST   /api/v1/attendance/clock-out
PATCH  /api/v1/attendance/manual/:userId/:date

GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/:id
PATCH  /api/v1/tasks/:id
DELETE /api/v1/tasks/:id
PUT    /api/v1/tasks/:id/assignees

GET    /api/v1/orders
POST   /api/v1/orders
GET    /api/v1/orders/:id
PATCH  /api/v1/orders/:id
PATCH  /api/v1/orders/:id/status
PATCH  /api/v1/orders/:id/assignment

GET    /api/v1/payments
POST   /api/v1/payments
GET    /api/v1/reports/summary

GET    /api/v1/integrations/connections
GET    /api/v1/integrations/orders/:id/sync
POST   /api/v1/integrations/orders/:id/retry
POST   /api/v1/integrations/orders/import
POST   /api/v1/integrations/desk/order-status
```

Keep temporary compatibility endpoints:

```text
GET /api/workspace
PUT /api/workspace
```

The compatibility service constructs the legacy workspace response from normalized tables. Legacy bulk writes are validated, diffed and translated into explicit normalized operations in one transaction. It must preserve imported-order read-only rules. Save changed orders and their pending sync state in the same transaction, then attempt callbacks directly after commit before completing the HTTP request.

All responses follow one envelope:

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid"
  }
}
```

Errors follow RFC 9457-style problem details with a stable application error code. Generate and publish OpenAPI from backend Zod schemas, and fail CI if generated frontend types are stale.

## Frontend Refactor

- Replace Next App Router pages with React Router routes and one authenticated application shell.
- Replace the 5,000-line `fieldflow-app.tsx` incrementally with feature-level pages, hooks, forms and components.
- Use TanStack Query exclusively for server state, caching, retry and invalidation.
- Use local component state for modal/form state; use Zustand only for genuinely cross-route UI state such as sidebar state and transient filters.
- Use React Hook Form with Zod resolvers for validated forms.
- Replace debounced whole-workspace autosave with explicit mutations and optimistic updates that include entity versions.
- Centralize the Fetch client with credentials, CSRF token attachment, request IDs, timeout handling and typed problem responses.
- Add route-level lazy loading, error boundaries, skeleton states and accessible empty/error states.
- Move global styles into design tokens, layout styles, shared UI styles and feature-scoped CSS Modules.
- Preserve the current visual design and responsive behavior during migration; do not redesign while changing architecture.
- Derive the connected website name from `GET /api/v1/integrations/connections`; never hardcode “Frames 41” in JSX.
- Keep commerce-owned order/customer/item/price/payment fields read-only in both UI and backend. UI disabling is not treated as authorization.

## Data Migration and Cutover

1. Add characterization tests around the current Next.js behavior before moving code.
2. Create the new `desk` PostgreSQL schema and Prisma migrations without altering Frames tables or legacy `public.fieldflow_*` tables.
3. Build `migrate-legacy-workspace.ts` to:
   - Refuse any database whose hostname/database does not match the explicitly approved target.
   - Lock and read `public.fieldflow_state`.
   - Validate the legacy JSON with Zod.
   - Compute and record a source checksum and revision.
   - Convert staff/employees, attendance, tasks, orders and payments into normalized rows.
   - Preserve IDs where valid and create deterministic mappings where legacy IDs are not UUIDs.
   - Preserve inbound integration event IDs and payload hashes. Reconcile legacy pending outbound events before cutover using a one-time migration script, preserving their event IDs and payloads; report unresolved events and block cutover until resolved. Keep legacy delivery records intact for audit and rollback without introducing a new outbox.
   - Run in one transaction and remain idempotent through `MigrationRun`.
4. Build a dry-run mode that reports counts, rejected records and mappings without writing.
5. Build `validate-migration.ts` to compare entity counts, financial totals, assignments, statuses, attendance duration and integration event IDs.
6. Build `export-legacy-workspace.ts` to reconstruct `public.fieldflow_state` from normalized data during the rollback window.
7. Run the new Express API and Vite frontend in parallel Railway services while the current Next app remains production.
8. Exercise the Vite frontend against Express using the compatibility adapter, then migrate each screen to resource APIs.
9. At cutover:
   - Take a database backup.
   - Put the old app into maintenance/read-only mode.
   - Run the final idempotent migration.
   - Run validation and financial reconciliation.
   - Smoke-test authentication, orders, attendance, assignments and Frames integration.
   - Switch frontend traffic to Vite and API traffic to Express.
10. Keep the old Next deployment and legacy exporter available for seven days. After acceptance, remove the compatibility endpoint, legacy JSON writer, Next dependency and old deployment.

No legacy table is deleted as part of the first production cutover.

## Simple Integration Handling

- Run a single Express process on Railway. No queues, workers, polling jobs or automatic retry infrastructure for this release.
- Process incoming Frames imports inside the HTTP request. Validate the signature and payload, then save the import and its `IntegrationInbox` receipt in one Prisma transaction before acknowledging success.
- Preserve HMAC-SHA256 signing over `timestamp + "." + rawBody`, five-minute timestamp validation, directional client IDs, idempotency and payload hashes.
- For outgoing status changes, save the local change and pending sync state in one transaction. After commit, attempt the callback within the same request with a short explicit timeout; do not hold a database transaction open during network calls.
- Record callback success or failure on the order. If delivery fails, return the saved order with its sync state so the UI can show “Saved locally; sync failed” without suggesting the local write failed.
- Show pending/failed sync on the order with a “Retry sync” action for Admin/Manager users. Retry sends the current status directly from its API endpoint; there are no scheduled retries.
- Use a stable event ID per order version and the same payload when retrying that version. Update sync results only if the attempted version is still current, so an older response cannot mark a newer change as synced. Prevent overlapping sends for the same order in the single API process.
- A process restart may leave an order pending; display it for manual retry. Remote delivery is at-least-once and depends on receiver idempotency. This release syncs the latest order status; it does not guarantee delivery of every intermediate status.
- Keep `Frames 41 → Desk` identity as `frames41` and `Desk → Frames 41` identity as `desk`.
- Revisit background processing only if measured request duration or delivery needs justify it.

## Quality and Operational Standards

- Use strict TypeScript with separate browser/server tsconfigs, ESLint and Prettier.
- Keep the backend OpenAPI contract and generated frontend types in sync; frontend code must not import backend implementation files.
- Use Vitest and Supertest for focused business-rule, authentication, permission and integration tests. Cover critical frontend flows with Testing Library or Playwright as needed.
- Run database and migration tests against a dedicated test PostgreSQL database; never load production `.env` files in tests. Testcontainers is optional.
- Use Pino request/error logs with request IDs and secret redaction. No tracing stack or separate observability service is required.
- Keep `/api/v1/health` for process health and `/api/v1/ready` for database/migration readiness.
- Shut down the API gracefully, allowing in-flight requests to finish before disconnecting Prisma.
- CI runs Prisma validation, API type drift checks, lint, type checking, focused tests and production builds. Run migration validation and critical-flow smoke tests before cutover.
- Deploy one backend service and one frontend service alongside the existing PostgreSQL database. No independent scaling setup is needed for fewer than 10 users.
- Document setup, environment variables, deployment, manual sync retry and rollback in the README. Separate architecture records and coverage gates are not required for this release.

## Acceptance Criteria

- No Next.js runtime or `next/*` import remains after final cutover.
- All frontend implementation resides under `frontend/`; all API and Prisma implementation resides under `backend/`.
- `fieldflow-app.tsx` and the monolithic store no longer exist.
- Desk data is stored in normalized Prisma models under the `desk` schema.
- Existing users, attendance, tasks, orders, payments and integration events reconcile exactly after migration.
- Existing role restrictions and commerce-field immutability are enforced server-side.
- Frames imports and callbacks remain idempotent and recoverable.
- Frontend routes and responsive behavior remain functionally equivalent.
- One Express backend process serves fewer than 10 users without queues, workers, Redis or scheduled jobs.
- Failed or interrupted callbacks remain visible and can be retried manually without duplicating remote changes.
- The old Next app can be restored during the seven-day rollback window without losing accepted Desk writes through the legacy exporter.
- Production migration requires a reviewed backup, dry-run report and validation report before traffic switching.

## Assumptions

- Use one repository with root npm workspaces and top-level `frontend/` and `backend/` directories.
- Build for fewer than 10 users with one Express process and a small set of feature modules.
- Accept manual integration retries and latest-status synchronization for this release; automatic background delivery is out of scope.
- Preserve all existing data.
- Use a parallel deployment and controlled cutover.
- Keep the temporary `/api/workspace` compatibility adapter until every frontend feature uses resource APIs.
- Continue hosting PostgreSQL on Railway while isolating Desk in the `desk` PostgreSQL schema.
- Keep the current product design during the architecture migration.
