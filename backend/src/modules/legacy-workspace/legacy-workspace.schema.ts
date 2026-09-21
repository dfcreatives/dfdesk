import { z } from "zod";

const attendanceRecord = z.object({
  id: z.string().min(1).max(160),
  date: z.iso.date(),
  clockIn: z.number().int(),
  clockOut: z.number().int().nullable(),
  durationSeconds: z.number().int().min(0),
});
const manualAttendance = z.object({
  date: z.iso.date(),
  status: z.enum(["Present", "Absent"]),
  markedAt: z.number().int(),
  markedBy: z.string().min(1).max(80),
});
const userBase = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  attendanceSeconds: z.number().int().min(0).optional(),
  attendanceStartedAt: z.number().int().nullable().optional(),
  attendanceRecords: z.array(attendanceRecord).max(10_000).optional(),
  password: z.string().max(256).optional(),
});
export const employeeSchema = userBase.extend({
  role: z.string().trim().min(1).max(120),
  initials: z.string().max(4),
  color: z.string().max(32),
  hours: z.string().max(40),
  manualAttendance: z.array(manualAttendance).max(10_000).optional(),
  task: z.string().max(300),
  active: z.boolean(),
});
export const staffSchema = userBase.extend({
  role: z.enum(["Admin", "Manager"]),
});
const collaborator = z.object({
  employeeId: z.uuid(),
  name: z.string().min(1).max(80),
  responsibility: z.string().min(1).max(300),
});
export const taskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  orderId: z.string().max(80).optional(),
  owner: z.string().max(80),
  ownerId: z.uuid().optional(),
  leadResponsibility: z.string().max(300).optional(),
  collaborators: z.array(collaborator).max(20).optional(),
  due: z.string().max(20),
  progress: z.number().int().min(0).max(100),
  tone: z.string().max(40),
  completed: z.boolean(),
  completedAt: z.number().int().optional(),
  status: z.enum(["Not started", "In progress", "Blocked", "Completed"]),
});
const address = z.object({
  line1: z.string().max(200),
  line2: z.string().max(200).optional(),
  city: z.string().max(100),
  state: z.string().max(100),
  pincode: z.string().max(16),
});
const lineItem = z.object({
  id: z.string().max(160),
  productId: z.string().max(160),
  sku: z.string().max(160),
  name: z.string().max(300),
  imageUrl: z.url().optional(),
  quantity: z.number().int().positive(),
  unitPricePaise: z.number().int().nonnegative(),
  totalPricePaise: z.number().int().nonnegative(),
  variant: z.string().max(160).optional(),
  customization: z.record(z.string(), z.unknown()).optional(),
});
export const orderCustomFieldValueSchema = z.union([
  z.string().max(5_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
  z.null(),
]);
export const orderSchema = z.object({
  id: z.string().min(1).max(80),
  createdAt: z.number().int().optional(),
  source: z.enum(["Desk", "Frames 41"]).optional(),
  externalOrderId: z.string().max(160).optional(),
  externalOrderNumber: z.string().max(160).optional(),
  importPayloadHash: z.string().length(64).optional(),
  customer: z.string().trim().min(1).max(160),
  customerMobile: z.string().max(32).optional(),
  customerEmail: z.email().optional(),
  item: z.string().trim().min(1).max(500),
  value: z.string().max(80),
  advanceAmount: z.number().nonnegative().optional(),
  advancePaymentMethod: z.enum(["Cash", "UPI", "Split", "Razorpay"]).optional(),
  shippingAddress: address.optional(),
  lineItems: z.array(lineItem).max(100).optional(),
  subtotalPaise: z.number().int().nonnegative().optional(),
  discountPaise: z.number().int().nonnegative().optional(),
  shippingPaise: z.number().int().nonnegative().optional(),
  totalPaise: z.number().int().nonnegative().optional(),
  paidPaise: z.number().int().nonnegative().optional(),
  balanceDuePaise: z.number().int().nonnegative().optional(),
  currency: z.literal("INR").optional(),
  paymentProvider: z.literal("Razorpay").optional(),
  paymentReference: z.string().max(200).optional(),
  paymentMethod: z.string().max(80).optional(),
  partialPayment: z.boolean().optional(),
  placedAt: z.iso.datetime().optional(),
  paidAt: z.iso.datetime().optional(),
  promisedDeliveryAt: z.iso.datetime().optional(),
  commerceStatus: z.string().max(80).optional(),
  deadline: z.string().max(20).optional(),
  assignedEmployeeId: z.uuid().optional(),
  assignedEmployeeName: z.string().max(80).optional(),
  status: z.string().min(1).max(80),
  color: z.string().min(1).max(40),
  customFields: z
    .record(z.string().min(1).max(80), orderCustomFieldValueSchema)
    .optional(),
});
export const paymentSchema = z.object({
  id: z.string().min(1).max(160),
  orderId: z.string().max(80).optional(),
  source: z.enum(["Manual", "Advance", "Commerce"]).optional(),
  customer: z.string().min(1).max(160),
  cashAmount: z.number().nonnegative(),
  upiAmount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  method: z.enum(["Cash", "UPI", "Split", "Razorpay"]),
  upiReference: z.string().max(200),
  createdAt: z.number().int(),
});

export const workspaceSchema = z
  .object({
    employees: z.array(employeeSchema).max(100),
    staff: z.array(staffSchema).max(100),
    tasks: z.array(taskSchema).max(10_000),
    orders: z.array(orderSchema).max(10_000),
    payments: z.array(paymentSchema).max(10_000),
  })
  .superRefine((workspace, context) => {
    const names = [...workspace.employees, ...workspace.staff].map((user) =>
      user.name.toLocaleLowerCase(),
    );
    if (new Set(names).size !== names.length)
      context.addIssue({
        code: "custom",
        message: "Account names must be unique.",
        path: ["employees"],
      });
  });
