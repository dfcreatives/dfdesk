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
  attendanceSeconds?: number | undefined;
  attendanceStartedAt?: number | null | undefined;
  attendanceRecords?: AttendanceRecord[] | undefined;
  manualAttendance?: ManualAttendanceEntry[] | undefined;
  task: string;
  active: boolean;
  /** Write-only. The API never returns a password or password hash. */
  password?: string | undefined;
};

export type StaffMember = {
  id: string;
  name: string;
  role: "Admin" | "Manager";
  /** Write-only. The API never returns a password or password hash. */
  password?: string | undefined;
  attendanceSeconds?: number | undefined;
  attendanceStartedAt?: number | null | undefined;
  attendanceRecords?: AttendanceRecord[] | undefined;
};

export type TaskStatus =
  "Not started" | "In progress" | "Blocked" | "Completed";

export type TaskCollaborator = {
  employeeId: string;
  name: string;
  responsibility: string;
};

export type Task = {
  title: string;
  orderId?: string | undefined;
  owner: string;
  ownerId?: string | undefined;
  leadResponsibility?: string | undefined;
  collaborators?: TaskCollaborator[] | undefined;
  due: string;
  progress: number;
  tone: string;
  completed: boolean;
  completedAt?: number | undefined;
  status: TaskStatus;
};

export type Order = {
  id: string;
  createdAt?: number | undefined;
  source?: "Desk" | "Frames 41" | undefined;
  externalOrderId?: string | undefined;
  externalOrderNumber?: string | undefined;
  importPayloadHash?: string | undefined;
  customer: string;
  customerMobile?: string | undefined;
  customerEmail?: string | undefined;
  item: string;
  value: string;
  advanceAmount?: number | undefined;
  advancePaymentMethod?: PaymentMethod | undefined;
  shippingAddress?: CommerceAddress | undefined;
  lineItems?: CommerceLineItem[] | undefined;
  subtotalPaise?: number | undefined;
  discountPaise?: number | undefined;
  shippingPaise?: number | undefined;
  totalPaise?: number | undefined;
  paidPaise?: number | undefined;
  balanceDuePaise?: number | undefined;
  currency?: "INR" | undefined;
  paymentProvider?: "Razorpay" | undefined;
  paymentReference?: string | undefined;
  paymentMethod?: string | undefined;
  partialPayment?: boolean | undefined;
  placedAt?: string | undefined;
  paidAt?: string | undefined;
  promisedDeliveryAt?: string | undefined;
  commerceStatus?: string | undefined;
  deadline?: string | undefined;
  assignedEmployeeId?: string | undefined;
  assignedEmployeeName?: string | undefined;
  status: string;
  color: string;
  customFields?: Record<string, OrderCustomFieldValue> | undefined;
};

export type OrderCustomFieldValue = string | number | boolean | string[] | null;

export type OrderFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "CURRENCY"
  | "DATE"
  | "PHONE"
  | "EMAIL"
  | "SELECT"
  | "MULTI_SELECT"
  | "CHECKBOX";

export type OrderFieldDefinition = {
  id: string;
  key: string;
  label: string;
  type: OrderFieldType;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  options: string[];
  position: number;
  showInList: boolean;
};

export type PaymentMethod = "Cash" | "UPI" | "Split" | "Razorpay";

export type PaymentRecord = {
  id: string;
  orderId?: string | undefined;
  source?: "Manual" | "Advance" | "Commerce" | undefined;
  customer: string;
  cashAmount: number;
  upiAmount: number;
  total: number;
  method: PaymentMethod;
  upiReference: string;
  createdAt: number;
};

export type CommerceAddress = {
  line1: string;
  line2?: string | undefined;
  city: string;
  state: string;
  pincode: string;
};

export type CommerceLineItem = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  imageUrl?: string | undefined;
  quantity: number;
  unitPricePaise: number;
  totalPricePaise: number;
  variant?: string | undefined;
  customization?: Record<string, unknown> | undefined;
};

export type IntegrationDeliveryStatus =
  "NONE" | "PENDING" | "SYNCED" | "FAILED";

export type IntegrationSyncState = {
  eventId: string;
  status: IntegrationDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  updatedAt: string;
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
