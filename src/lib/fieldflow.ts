export type UserRole = "Admin" | "Manager" | "Employee";

export type SessionUser = {
  id: string;
  name: string;
  role: UserRole;
};

export type AttendanceRecord = {
  id: string;
  date: string;
  clockIn: number;
  clockOut: number | null;
  durationSeconds: number;
};

export type ManualAttendanceEntry = {
  date: string;
  status: "Present" | "Absent";
  markedAt: number;
  markedBy: string;
};

export type Employee = {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  hours: string;
  attendanceSeconds?: number;
  attendanceStartedAt?: number | null;
  attendanceRecords?: AttendanceRecord[];
  manualAttendance?: ManualAttendanceEntry[];
  task: string;
  active: boolean;
  /** Write-only. The API never returns a password or password hash. */
  password?: string;
};

export type StaffMember = {
  id: string;
  name: string;
  role: "Admin" | "Manager";
  /** Write-only. The API never returns a password or password hash. */
  password?: string;
  attendanceSeconds?: number;
  attendanceStartedAt?: number | null;
  attendanceRecords?: AttendanceRecord[];
};

export type TaskStatus =
  | "Not started"
  | "In progress"
  | "Blocked"
  | "Completed";

export type TaskCollaborator = {
  employeeId: string;
  name: string;
  responsibility: string;
};

export type Task = {
  title: string;
  orderId?: string;
  owner: string;
  ownerId?: string;
  leadResponsibility?: string;
  collaborators?: TaskCollaborator[];
  due: string;
  progress: number;
  tone: string;
  completed: boolean;
  completedAt?: number;
  status: TaskStatus;
};

export type Order = {
  id: string;
  createdAt?: number;
  customer: string;
  customerMobile?: string;
  item: string;
  value: string;
  advanceAmount?: number;
  advancePaymentMethod?: "Cash" | "UPI";
  deadline?: string;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  status: string;
  color: string;
};

export type PaymentMethod = "Cash" | "UPI" | "Split";

export type PaymentRecord = {
  id: string;
  orderId?: string;
  source?: "Manual" | "Advance";
  customer: string;
  cashAmount: number;
  upiAmount: number;
  total: number;
  method: PaymentMethod;
  upiReference: string;
  createdAt: number;
};

export type Workspace = {
  employees: Employee[];
  staff: StaffMember[];
  tasks: Task[];
  orders: Order[];
  payments: PaymentRecord[];
};

export const emptyWorkspace = (): Workspace => ({
  employees: [],
  staff: [],
  tasks: [],
  orders: [],
  payments: [],
});
