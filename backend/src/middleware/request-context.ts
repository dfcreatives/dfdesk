import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.header("x-request-id");
  const requestId =
    supplied && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
};
