import { z } from "zod";
export const manualAttendanceSchema = z.object({
  employeeId: z.uuid(),
  date: z.iso.date(),
  status: z.literal("Absent").nullable(),
});
