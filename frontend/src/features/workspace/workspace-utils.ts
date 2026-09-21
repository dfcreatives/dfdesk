import type { AttendanceRecord, Task } from "@/shared/domain";

export type AttendanceReportPeriod = "Daily" | "Weekly" | "Monthly";
type AttendanceDaySummary = {
  date: string;
  clockIn: number;
  clockOut: number | null;
  durationSeconds: number;
  hasOpenSession: boolean;
};

export function normalizeTask(task: Task): Task {
  const status = task.status ?? (task.completed ? "Completed" : "Not started");
  return {
    ...task,
    status,
    completed: status === "Completed",
    progress: status === "Completed" ? 100 : status === "In progress" ? 50 : 0,
  };
}

export function getAttendancePeriodRange(
  timestamp: number,
  period: AttendanceReportPeriod,
) {
  const start = new Date(timestamp);
  start.setHours(0, 0, 0, 0);
  if (period === "Weekly")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === "Monthly") start.setDate(1);
  const end = new Date(start);
  if (period === "Daily") end.setDate(end.getDate() + 1);
  else if (period === "Weekly") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

export function summarizeAttendanceRecords(
  records: AttendanceRecord[],
  start: number,
  end: number,
  now: number,
) {
  return Array.from(
    records
      .filter((record) => record.clockIn >= start && record.clockIn < end)
      .reduce((days, record) => {
        const existing = days.get(record.date) ?? {
          date: record.date,
          clockIn: record.clockIn,
          clockOut: record.clockOut,
          durationSeconds: 0,
          hasOpenSession: false,
        };
        existing.clockIn = Math.min(existing.clockIn, record.clockIn);
        existing.hasOpenSession ||= record.clockOut === null;
        if (record.clockOut !== null)
          existing.clockOut = Math.max(existing.clockOut ?? 0, record.clockOut);
        existing.durationSeconds +=
          record.clockOut !== null
            ? record.durationSeconds
            : Math.max(0, Math.floor((now - record.clockIn) / 1000));
        days.set(record.date, existing);
        return days;
      }, new Map<string, AttendanceDaySummary>())
      .values(),
  ).sort((left, right) => right.clockIn - left.clockIn);
}

export function withoutPassword<T extends { password?: string | undefined }>(
  value: T,
): Omit<T, "password"> {
  const copy = { ...value };
  delete copy.password;
  return copy;
}
export function formatRupees(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
export function formatPaise(amount: number | undefined) {
  return formatRupees((amount ?? 0) / 100);
}
export function customizationImageUrls(
  value: Record<string, unknown> | undefined,
) {
  if (!value) return [];
  const urls = new Set<string>();
  const visit = (entry: unknown, key = "") => {
    if (
      typeof entry === "string" &&
      /image|photo|artwork|asset/i.test(key) &&
      /^https?:\/\//i.test(entry)
    ) {
      urls.add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, key));
      return;
    }
    if (entry && typeof entry === "object")
      Object.entries(entry as Record<string, unknown>).forEach(
        ([nestedKey, nestedValue]) => visit(nestedValue, nestedKey),
      );
  };
  visit(value);
  return [...urls].slice(0, 12);
}
export function parseRupeesInput(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}
export function formatDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function resolveOrderDeadline(
  manualDeadline: string,
  orderCreatedAt: number,
) {
  const deadline = manualDeadline
    ? new Date(`${manualDeadline}T12:00:00`)
    : new Date(orderCreatedAt);
  deadline.setHours(12, 0, 0, 0);
  if (!manualDeadline) deadline.setDate(deadline.getDate() + 2);
  if (deadline.getDay() === 0) deadline.setDate(deadline.getDate() + 1);
  return formatDateInputValue(deadline);
}
