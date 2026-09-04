# Desk

Desk is a full-stack Next.js operations application. The UI, authenticated
HTTP API, and business rules run in the same Node.js service, with durable data
stored in PostgreSQL.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Create `.env.local` from `.env.example` and set `DATABASE_URL` before starting
the app. The value is only read by server code and must never use a
`NEXT_PUBLIC_` prefix.

On a new installation, use **Create the first account** on the sign-in page to
create the workspace administrator. No default credentials are stored in the
source code. Passwords are salted and hashed on the server, and authentication
is held in a 14-day HTTP-only session cookie.

## Architecture

- `src/app/*/page.tsx` — separate, bookmarkable workspace routes
- `src/components/fieldflow-app.tsx` — shared operations UI and API client
- `src/app/api/auth/*` — bootstrap, login, session, and logout endpoints
- `src/app/api/workspace/route.ts` — authenticated workspace read/write API
- `src/lib/server/store.ts` — validation, authorization, password hashing,
  session management, and workspace business rules
- `src/lib/server/database.ts` — pooled PostgreSQL connection and schema setup
- `src/app/api/health/route.ts` — application and database readiness check

The backend creates its `fieldflow_state` table on the first request. Updates
run in PostgreSQL transactions with row locking, so concurrent app instances do
not overwrite one another.

## Railway setup

1. Add a PostgreSQL service to the same Railway project as this app.
2. In the app service's **Variables** tab, add a reference variable named
   `DATABASE_URL` and select the PostgreSQL service's `DATABASE_URL` value.
3. Redeploy the app service.
4. Set the Railway healthcheck path to `/api/health`. A successful response is
   `{ "status": "ok", "database": "connected" }`.
5. Open the deployed app and create the first administrator account.

### Frames 41 order integration

Desk receives paid Frames 41 orders at
`POST /api/v1/integrations/orders/import` and sends workflow changes back from
its durable PostgreSQL outbox. Configure these server-only variables:

```env
FRAMES41_API_URL=https://<frames-backend-service>
DF_INTEGRATION_SECRET=<the-same-random-secret-used-by-frames41>
```

Create a second Railway service from this repository for the callback worker.
Give it the same variables and `DATABASE_URL`, and set its start command to:

```bash
npm run start:worker
```

Use Railway private service URLs when both apps are in one project. Deploy Desk
before enabling Frames delivery. Admins and managers can inspect callback sync
state in an imported order and retry exhausted deliveries there. Keep
`DF_INTEGRATION_SECRET` out of all `NEXT_PUBLIC_*` variables.

For local development against Railway, enable public access on the PostgreSQL
service and place its `DATABASE_PUBLIC_URL` value in `.env.local` as
`DATABASE_URL`. Do not expose the database publicly just for app-to-database
traffic inside Railway; the reference variable uses its private network.

### Migrate existing local JSON data

If this project already has `.data/fieldflow.json`, migrate it once after
setting `DATABASE_URL`:

```bash
npm run db:migrate-json
```

The command refuses to overwrite a PostgreSQL workspace that already contains
data. You can pass a different source path after `--` if needed.

Edit the shared dashboard in `src/components/fieldflow-app.tsx`, or add route
entry points under `src/app/`. The development server updates changes live.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
