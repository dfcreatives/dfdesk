# Desk

Desk is a monolithic Next.js operations application. The UI, authenticated
HTTP API, business rules, and durable persistence all run in the same Node.js
process.

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
  session management, and atomic persistence
- `.data/fieldflow.json` — runtime data (created automatically and gitignored)

Set `FIELDFLOW_DATA_FILE` to place the data file on a mounted persistent volume
in production. The default is `.data/fieldflow.json` in the project directory.
Because this backend writes to local disk, deploy it as a single long-running
Node.js service with persistent storage, not as stateless serverless functions.

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
