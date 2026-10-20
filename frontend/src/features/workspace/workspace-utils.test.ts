import { describe, expect, it } from "vitest";
import {
  getAttendanceRecordSeconds,
  summarizeAttendanceRecords,
} from "./workspace-utils";

describe("attendance duration", () => {
  it("derives completed session time from login and logout timestamps", () => {
    const record = {
      id: "session-1",
      date: "2026-09-25",
      clockIn: Date.parse("2026-09-25T09:00:00.000Z"),
      clockOut: Date.parse("2026-09-25T17:30:00.000Z"),
      durationSeconds: 0,
    };

    expect(getAttendanceRecordSeconds(record, record.clockOut)).toBe(30_600);
    expect(
      summarizeAttendanceRecords(
        [record],
        Date.parse("2026-09-25T00:00:00.000Z"),
        Date.parse("2026-09-26T00:00:00.000Z"),
        record.clockOut,
      ),
    ).toEqual([
      expect.objectContaining({ durationSeconds: 30_600 }),
    ]);
  });

  it("calculates a running session up to the current time", () => {
    const clockIn = Date.parse("2026-09-25T09:00:00.000Z");
    expect(
      getAttendanceRecordSeconds(
        {
          id: "session-2",
          date: "2026-09-25",
          clockIn,
          clockOut: null,
          durationSeconds: 0,
        },
        clockIn + 90_000,
      ),
    ).toBe(90);
  });
});
