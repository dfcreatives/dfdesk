import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      actor?: { id: string; workspaceId: string; name: string; role: UserRole };
      rawBody?: string;
    }
  }
}

export {};
