// Generated from backend/src/openapi.ts. Do not import backend implementation code here.
export type ApiEnvelope<T> = { data: T; meta: { requestId: string } };
export type Role = "Admin" | "Manager" | "Employee";
export type SessionUser = { id: string; name: string; role: Role };
export type SessionResponse = {
  user: SessionUser | null;
  setupRequired: boolean;
  csrfToken?: string;
  workspace: unknown | null;
};
export type SyncStatus = "NONE" | "PENDING" | "SYNCED" | "FAILED";
export type IntegrationSync = {
  eventId: string;
  status: SyncStatus;
  attempts: number;
  maxAttempts: 1;
  lastError: string | null;
  deliveredAt: string | null;
  updatedAt: string;
} | null;
