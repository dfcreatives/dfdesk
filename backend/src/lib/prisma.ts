import { PrismaClient } from "@prisma/client";

const singleton = globalThis as typeof globalThis & {
  deskPrisma?: PrismaClient;
};
export const prisma =
  singleton.deskPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") singleton.deskPrisma = prisma;
