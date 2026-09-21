import { z } from "zod";

const password = z.string().min(8).max(256);
export const credentialsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  password,
});
export const accountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  currentPassword: password,
  newPassword: z.union([z.literal(""), password]).default(""),
});
