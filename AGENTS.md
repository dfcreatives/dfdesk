# Desk engineering guide

- Keep the product as one Vite frontend and one Express backend. Do not add a queue, worker, Redis instance, scheduler, or microservice without measured need.
- Run all Desk Prisma migrations in the `desk` PostgreSQL schema. Never modify Frames 41 tables or legacy `public.fieldflow_*` tables from application code.
- Treat all request data as untrusted. Parse it with Zod at the route boundary, scope every query to the actor's workspace, and enforce permissions in the API.
- Never expose database URLs, session tokens, cookies, passwords, HMAC signatures, or integration payload secrets in client code or logs.
- Keep commerce-owned imported fields immutable. Only assignment, Desk workflow status, color, and deadline may change locally.
- Use integer paise in storage and reject values that cannot be represented safely in API JSON.
- Prefer a small route, schema, and service per feature. Add a layer only when it creates a real boundary.
- Before handing off a change, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
