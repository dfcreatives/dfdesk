import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../shared/errors/app-error.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (_request, response) => {
  response
    .status(404)
    .type("application/problem+json")
    .json({
      type: "about:blank",
      title: "Not found",
      status: 404,
      detail: "The requested resource does not exist.",
      code: "NOT_FOUND",
      requestId: String(response.locals.requestId),
    });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  next,
) => {
  void next;
  const zod = error instanceof ZodError ? error : undefined;
  const app = error instanceof AppError ? error : undefined;
  const status = zod ? 400 : (app?.status ?? 500);
  const detail = zod
    ? "The request contains invalid values."
    : (app?.message ?? "An unexpected error occurred.");
  if (status >= 500)
    logger.error(
      {
        err: error,
        requestId: response.locals.requestId,
        method: request.method,
        path: request.path,
      },
      "request failed",
    );
  const errors = zod
    ? zod.issues.reduce<Record<string, string[]>>((all, issue) => {
        const path = issue.path.join(".") || "request";
        (all[path] ??= []).push(issue.message);
        return all;
      }, {})
    : app?.errors;
  response
    .status(status)
    .type("application/problem+json")
    .json({
      type: `https://desk.local/problems/${(app?.code ?? (zod ? "VALIDATION_FAILED" : "INTERNAL_ERROR")).toLowerCase()}`,
      title: zod
        ? "Validation failed"
        : status >= 500
          ? "Internal server error"
          : "Request failed",
      status,
      detail,
      code: app?.code ?? (zod ? "VALIDATION_FAILED" : "INTERNAL_ERROR"),
      requestId: String(response.locals.requestId),
      ...(errors ? { errors } : {}),
    });
};
