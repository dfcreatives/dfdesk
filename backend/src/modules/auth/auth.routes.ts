import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";
import { ok } from "../../shared/http/respond.js";
import { requireActor } from "../../middleware/auth.js";
import { accountUpdateSchema, credentialsSchema } from "./auth.schema.js";
import {
  authenticate,
  bootstrap,
  createSession,
  destroySession,
  setupRequired,
  updateAccount,
} from "./auth.service.js";
import { getWorkspace } from "../legacy-workspace/legacy-workspace.service.js";
import { unauthorized } from "../../shared/errors/app-error.js";

export const authRouter = Router();
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const cookieOptions = () => ({
  httpOnly: true,
  secure: env().COOKIE_SECURE ?? env().NODE_ENV === "production",
  sameSite: "lax" as const,
  domain: env().COOKIE_DOMAIN,
  path: "/",
});

function setSessionCookies(
  response: Response,
  session: Awaited<ReturnType<typeof createSession>>,
) {
  response.cookie(env().COOKIE_NAME, session.token, {
    ...cookieOptions(),
    expires: session.expiresAt,
  });
  response.cookie("desk_csrf", session.csrfToken, {
    ...cookieOptions(),
    httpOnly: false,
    expires: session.expiresAt,
  });
}

authRouter.post("/bootstrap", authLimit, async (request, response) => {
  const body = credentialsSchema.parse(request.body);
  const user = await bootstrap(body.name, body.password);
  const session = await createSession(user.id, {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(request.header("user-agent")
      ? { userAgent: request.header("user-agent")!.slice(0, 300) }
      : {}),
  });
  setSessionCookies(response, session);
  return ok(
    response,
    { user, csrfToken: session.csrfToken, workspace: await getWorkspace(user) },
    201,
  );
});
authRouter.post("/login", authLimit, async (request, response) => {
  const body = credentialsSchema.parse(request.body);
  const user = await authenticate(body.name, body.password);
  if (!user) throw unauthorized("Name or password is incorrect.");
  const session = await createSession(user.id, {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(request.header("user-agent")
      ? { userAgent: request.header("user-agent")!.slice(0, 300) }
      : {}),
  });
  setSessionCookies(response, session);
  return ok(response, {
    user,
    csrfToken: session.csrfToken,
    workspace: await getWorkspace(user),
  });
});
authRouter.post("/logout", async (request, response) => {
  const cookies = request.cookies as
    Record<string, string | undefined> | undefined;
  await destroySession(cookies?.[env().COOKIE_NAME]);
  response.clearCookie(env().COOKIE_NAME, cookieOptions());
  response.clearCookie("desk_csrf", { ...cookieOptions(), httpOnly: false });
  return response.status(204).send();
});
authRouter.get("/session", async (request, response) =>
  ok(response, {
    user: request.actor
      ? {
          id: request.actor.id,
          name: request.actor.name,
          role:
            request.actor.role === "ADMIN"
              ? "Admin"
              : request.actor.role === "MANAGER"
                ? "Manager"
                : "Employee",
        }
      : null,
    setupRequired: await setupRequired(),
    workspace: request.actor ? await getWorkspace(request.actor) : null,
  }),
);
authRouter.patch(
  "/account",
  requireActor,
  authLimit,
  async (request, response) => {
    const body = accountUpdateSchema.parse(request.body);
    const user = await updateAccount(
      request.actor,
      body.name,
      body.currentPassword,
      body.newPassword,
    );
    return ok(response, { user, workspace: await getWorkspace(user) });
  },
);
