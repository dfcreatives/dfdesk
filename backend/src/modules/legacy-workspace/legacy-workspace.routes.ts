import { Router } from "express";
import { requireActor } from "../../middleware/auth.js";
import { ok } from "../../shared/http/respond.js";
import { getWorkspace, saveWorkspace } from "./legacy-workspace.service.js";
import { z } from "zod";

export const legacyWorkspaceRouter = Router();
legacyWorkspaceRouter.use(requireActor);
legacyWorkspaceRouter.get("/", async (request, response) =>
  ok(response, { workspace: await getWorkspace(request.actor!) }),
);
legacyWorkspaceRouter.put("/", async (request, response) => {
  const body = z.object({ workspace: z.unknown() }).parse(request.body);
  return ok(response, {
    workspace: await saveWorkspace(body.workspace, request.actor),
  });
});
