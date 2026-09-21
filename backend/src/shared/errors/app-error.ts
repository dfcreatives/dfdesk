export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") =>
  new AppError(400, code, message);
export const unauthorized = (message = "Authentication required.") =>
  new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (
  message = "You do not have permission to perform this action.",
) => new AppError(403, "FORBIDDEN", message);
export const notFound = (message: string) =>
  new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string, code = "CONFLICT") =>
  new AppError(409, code, message);
