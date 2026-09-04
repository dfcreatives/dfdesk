"use client";

import Image from "next/image";
import {
  useEffect,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUpRight,
  Banknote,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Eye,
  EyeOff,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import type {
  AttendanceRecord,
  Employee,
  IntegrationSyncState,
  Order,
  PaymentMethod,
  PaymentRecord,
  SessionUser,
  StaffMember,
  Task,
  Workspace,
} from "@/lib/fieldflow";
import {
  pathForSection,
  sectionFromPathname,
  type WorkspaceSection,
} from "@/lib/navigation";

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "My team", icon: Users },
  { label: "Tasks", icon: BriefcaseBusiness },
  { label: "Orders", icon: ShoppingBag },
  { label: "Collections", icon: WalletCards },
];
function normalizeTask(task: Task): Task {
  const status = task.status ?? (task.completed ? "Completed" : "Not started");
  return {
    ...task,
    status,
    completed: status === "Completed",
    progress: status === "Completed" ? 100 : status === "In progress" ? 50 : 0,
  };
}
const employees: Employee[] = [];
const tasks: Task[] = [];
const orders: Order[] = [];
const initialStaff: StaffMember[] = [];
type CollectionReportPeriod = "Daily" | "Weekly" | "Monthly" | "Yearly";
type AttendanceReportPeriod = "Daily" | "Weekly" | "Monthly";
type AttendanceDaySummary = {
  date: string;
  clockIn: number;
  clockOut: number | null;
  durationSeconds: number;
  hasOpenSession: boolean;
};
type TeamAttendanceRow = {
  employee: Employee;
  date: string | null;
  clockIn: number | null;
  clockOut: number | null;
  durationSeconds: number;
  hasOpenSession: boolean;
  manualStatus: "Present" | "Absent" | null;
};
type CollectionDetail = "Cash collections" | "UPI collections" | "Total collected" | "Outstanding";
const reportPeriodLabels: Record<CollectionReportPeriod, string> = {
  Daily: "Today",
  Weekly: "This week",
  Monthly: "This month",
  Yearly: "This year",
};

function getAttendancePeriodRange(
  timestamp: number,
  period: AttendanceReportPeriod,
) {
  const start = new Date(timestamp);
  start.setHours(0, 0, 0, 0);
  if (period === "Weekly") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (period === "Monthly") {
    start.setDate(1);
  }
  const end = new Date(start);
  if (period === "Daily") end.setDate(end.getDate() + 1);
  else if (period === "Weekly") end.setDate(end.getDate() + 7);
  else end.setMonth(end.getMonth() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

function summarizeAttendanceRecords(
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
        if (record.clockOut !== null) {
          existing.clockOut = Math.max(existing.clockOut ?? 0, record.clockOut);
        }
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

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error((body as { error?: string } | null)?.error ?? "Request failed.");
  }
  return body as T;
}

function withoutPassword<T extends { password?: string }>(value: T): Omit<T, "password"> {
  const copy = { ...value };
  delete copy.password;
  return copy;
}
function formatRupees(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
function formatPaise(amount: number | undefined) {
  return formatRupees((amount ?? 0) / 100);
}
function customizationImageUrls(value: Record<string, unknown> | undefined) {
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
    if (entry && typeof entry === "object") {
      Object.entries(entry as Record<string, unknown>).forEach(([nestedKey, nestedValue]) =>
        visit(nestedValue, nestedKey),
      );
    }
  };
  visit(value);
  return [...urls].slice(0, 12);
}
function parseRupeesInput(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}
function formatDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function resolveOrderDeadline(manualDeadline: string, orderCreatedAt: number) {
  const deadline = manualDeadline
    ? new Date(`${manualDeadline}T12:00:00`)
    : new Date(orderCreatedAt);
  deadline.setHours(12, 0, 0, 0);
  if (!manualDeadline) deadline.setDate(deadline.getDate() + 2);
  if (deadline.getDay() === 0) deadline.setDate(deadline.getDate() + 1);
  return formatDateInputValue(deadline);
}

export default function FieldflowApp({
  initialSection,
}: {
  initialSection: WorkspaceSection;
}) {
  const pathname = usePathname();
  const activeNav: string = sectionFromPathname(pathname) ?? initialSection;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [employeeData, setEmployeeData] = useState<Employee[]>(employees);
  const [attendanceNow, setAttendanceNow] = useState(0);
  const [showAttendanceReport, setShowAttendanceReport] = useState(false);
  const [attendanceReportPeriod, setAttendanceReportPeriod] =
    useState<AttendanceReportPeriod>("Weekly");
  const [showTeamAttendanceReport, setShowTeamAttendanceReport] = useState(false);
  const [teamAttendancePeriod, setTeamAttendancePeriod] =
    useState<AttendanceReportPeriod>("Daily");
  const [teamAttendanceError, setTeamAttendanceError] = useState("");
  const [markingAttendanceFor, setMarkingAttendanceFor] = useState<string | null>(
    null,
  );
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [paymentOrderId, setPaymentOrderId] = useState("");
  const [paymentCustomer, setPaymentCustomer] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [cashPaymentAmount, setCashPaymentAmount] = useState("");
  const [upiPaymentAmount, setUpiPaymentAmount] = useState("");
  const [upiReference, setUpiReference] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [collectionReportPeriod, setCollectionReportPeriod] =
    useState<CollectionReportPeriod>("Weekly");
  const [expandedCollection, setExpandedCollection] =
    useState<CollectionDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [taskData, setTaskData] = useState<Task[]>(tasks);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTaskAssignment, setEditingTaskAssignment] =
    useState<Task | null>(null);
  const [assigningOrder, setAssigningOrder] = useState<Order | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskLeadResponsibility, setTaskLeadResponsibility] = useState("");
  const [taskCollaborators, setTaskCollaborators] = useState<
    Record<string, string>
  >({});
  const [taskDue, setTaskDue] = useState("");
  const [taskFormError, setTaskFormError] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskStatus, setTaskStatus] = useState<Task["status"]>("Not started");
  const [draggedTaskTitle, setDraggedTaskTitle] = useState<string | null>(null);
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragOverEmployeeId, setDragOverEmployeeId] = useState<string | null>(
    null,
  );
  const [orderData, setOrderData] = useState<Order[]>(orders);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [orderCustomer, setOrderCustomer] = useState("");
  const [orderCustomerMobile, setOrderCustomerMobile] = useState("");
  const [orderItem, setOrderItem] = useState("");
  const [orderValue, setOrderValue] = useState("");
  const [orderAdvanceAmount, setOrderAdvanceAmount] = useState("");
  const [orderAdvanceMethod, setOrderAdvanceMethod] = useState<"Cash" | "UPI">(
    "UPI",
  );
  const [orderDeadline, setOrderDeadline] = useState("");
  const [orderStatus, setOrderStatus] = useState("Pending");
  const [orderError, setOrderError] = useState("");
  const [integrationSync, setIntegrationSync] =
    useState<IntegrationSyncState | null>(null);
  const [integrationSyncLoading, setIntegrationSyncLoading] = useState(false);
  const [integrationSyncError, setIntegrationSyncError] = useState("");
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [employeeRole, setEmployeeRole] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [staffData, setStaffData] = useState<StaffMember[]>(initialStaff);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<StaffMember["role"]>("Manager");
  const [staffPassword, setStaffPassword] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountCurrentPassword, setAccountCurrentPassword] = useState("");
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [accountConfirmPassword, setAccountConfirmPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [showAccountCredentials, setShowAccountCredentials] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const currentRole: "Admin" | "Manager" =
    currentUser?.role === "Manager" ? "Manager" : "Admin";
  const canManageEmployees = currentUser?.role === "Manager";
  const currentUserInitials =
    currentUser?.name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "";

  function navigateTo(section: WorkspaceSection) {
    if (section !== "Settings") setShowAccountCredentials(false);
    setNotificationsOpen(false);
    const targetPath = pathForSection(section);
    if (activeNav === "Overview" && section !== "Overview") {
      window.history.pushState(null, "", targetPath);
    } else {
      window.history.replaceState(null, "", targetPath);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyWorkspace(workspace: Workspace) {
    setEmployeeData(workspace.employees);
    setStaffData(workspace.staff);
    setTaskData(workspace.tasks.map(normalizeTask));
    setOrderData(workspace.orders);
    setPaymentRecords(workspace.payments);
  }

  useEffect(() => {
    let cancelled = false;
    apiRequest<{
      user: SessionUser | null;
      setupRequired: boolean;
      workspace: Workspace | null;
    }>("/api/auth/session")
      .then((response) => {
        if (cancelled) return;
        setCurrentUser(response.user);
        setAccountName(
          response.user?.role === "Admin" || response.user?.role === "Manager"
            ? response.user.name
            : "",
        );
        setSetupRequired(response.setupRequired);
        setIsSetupMode(response.setupRequired);
        if (response.workspace) applyWorkspace(response.workspace);
        setAttendanceNow(Date.now());
        if (!response.user && window.location.pathname !== "/") {
          window.history.replaceState(null, "", "/");
        } else if (response.user && window.location.pathname === "/") {
          window.history.replaceState(null, "", "/overview");
        } else if (
          response.user &&
          window.location.pathname !== "/overview"
        ) {
          const requestedPath = window.location.pathname;
          window.history.replaceState(null, "", "/overview");
          window.history.pushState(null, "", requestedPath);
        }
      })
      .catch(() => {
        if (!cancelled) setLoginError("The Desk server is unavailable.");
      })
      .finally(() => {
        if (!cancelled) setIsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || !currentUser || accountSaving) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const workspace: Workspace = {
        employees: employeeData,
        staff: staffData,
        tasks: taskData,
        orders: orderData,
        payments: paymentRecords,
      };
      apiRequest<{ workspace: Workspace }>("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
        signal: controller.signal,
      })
        .then(() => {
          setSyncError("");
          setEmployeeData((current) =>
            current.some((employee) => employee.password)
              ? current.map(withoutPassword)
              : current,
          );
          setStaffData((current) =>
            current.some((member) => member.password)
              ? current.map(withoutPassword)
              : current,
          );
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") setSyncError(error.message);
        });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    currentUser,
    employeeData,
    accountSaving,
    isHydrated,
    orderData,
    paymentRecords,
    staffData,
    taskData,
  ]);

  useEffect(() => {
    if (!isHydrated || !currentUser || currentUser.role === "Employee") return;
    let cancelled = false;
    const refreshWorkspace = () => {
      if (document.visibilityState !== "visible") return;
      apiRequest<{ workspace: Workspace }>("/api/workspace", { cache: "no-store" })
        .then(({ workspace }) => {
          if (!cancelled) applyWorkspace(workspace);
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(refreshWorkspace, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentUser, isHydrated]);

  useEffect(() => {
    const canRefreshTeam =
      currentUser?.role === "Manager" || currentUser?.role === "Admin";
    if (!canRefreshTeam || (activeNav !== "Overview" && !showTeamAttendanceReport)) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const refreshTeamAttendance = () => {
      apiRequest<{ workspace: Workspace }>("/api/workspace", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(({ workspace }) => {
          if (cancelled) return;
          const serverEmployees = new Map(
            workspace.employees.map((employee) => [employee.id, employee]),
          );
          setEmployeeData((current) => {
            let changed = false;
            const next = current.map((employee) => {
              const serverEmployee = serverEmployees.get(employee.id);
              if (!serverEmployee) return employee;
              const attendanceChanged =
                employee.attendanceSeconds !== serverEmployee.attendanceSeconds ||
                employee.attendanceStartedAt !==
                  serverEmployee.attendanceStartedAt ||
                employee.active !== serverEmployee.active ||
                employee.hours !== serverEmployee.hours ||
                JSON.stringify(employee.attendanceRecords ?? []) !==
                  JSON.stringify(serverEmployee.attendanceRecords ?? []) ||
                JSON.stringify(employee.manualAttendance ?? []) !==
                  JSON.stringify(serverEmployee.manualAttendance ?? []);
              if (!attendanceChanged) return employee;
              changed = true;
              return {
                ...employee,
                attendanceSeconds: serverEmployee.attendanceSeconds,
                attendanceStartedAt: serverEmployee.attendanceStartedAt,
                attendanceRecords: serverEmployee.attendanceRecords,
                manualAttendance: serverEmployee.manualAttendance,
                active: serverEmployee.active,
                hours: serverEmployee.hours,
              };
            });
            return changed ? next : current;
          });
          setAttendanceNow(Date.now());
        })
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            // The next interval or window focus will retry without interrupting work.
          }
        });
    };

    refreshTeamAttendance();
    const interval = window.setInterval(refreshTeamAttendance, 5_000);
    window.addEventListener("focus", refreshTeamAttendance);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshTeamAttendance);
    };
  }, [activeNav, currentUser?.role, showTeamAttendanceReport]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeNotifications = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".notification-center")) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("mousedown", closeNotifications);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeNotifications);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  function savePayment() {
    const cashAmount =
      paymentMethod === "Cash"
        ? parseRupeesInput(paymentAmount)
        : paymentMethod === "Split"
          ? parseRupeesInput(cashPaymentAmount)
          : 0;
    const upiAmount =
      paymentMethod === "UPI"
        ? parseRupeesInput(paymentAmount)
        : paymentMethod === "Split"
          ? parseRupeesInput(upiPaymentAmount)
          : 0;
    const total = cashAmount + upiAmount;
    if (!paymentCustomer.trim()) {
      setPaymentError("Enter the customer name.");
      return;
    }
    if (
      total <= 0 ||
      (paymentMethod === "Split" && (!cashAmount || !upiAmount))
    ) {
      setPaymentError(
        paymentMethod === "Split"
          ? "Enter both the cash and UPI amounts."
          : "Enter a valid payment amount.",
      );
      return;
    }
    setPaymentRecords((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        orderId: paymentOrderId || undefined,
        source: "Manual",
        customer: paymentCustomer.trim(),
        cashAmount,
        upiAmount,
        total,
        method: paymentMethod,
        upiReference: upiReference.trim(),
        createdAt: Date.now(),
      },
    ]);
    setPaymentError("");
    setPaymentSaved(true);
    window.setTimeout(() => {
      setShowPayment(false);
      setPaymentSaved(false);
      setPaymentOrderId("");
      setPaymentCustomer("");
      setPaymentAmount("");
      setCashPaymentAmount("");
      setUpiPaymentAmount("");
      setUpiReference("");
      setPaymentMethod("UPI");
    }, 1300);
  }

  function openMetricWorkspace(workspace: WorkspaceSection) {
    navigateTo(workspace);
  }

  function handleMetricKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    workspace: WorkspaceSection,
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openMetricWorkspace(workspace);
  }

  useEffect(() => {
    if (
      !employeeData.some((employee) => employee.attendanceStartedAt) &&
      !staffData.some((member) => member.attendanceStartedAt)
    )
      return;
    const updateAttendanceNow = () => setAttendanceNow(Date.now());
    updateAttendanceNow();
    const timer = window.setInterval(updateAttendanceNow, 1000);
    return () => window.clearInterval(timer);
  }, [employeeData, staffData]);

  useEffect(() => {
    const updateCurrentTime = () => setAttendanceNow(Date.now());
    const timer = window.setInterval(updateCurrentTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function formatAttendance(seconds: number) {
    return `${Math.floor(seconds / 3600)
      .toString()
      .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
      .toString()
      .padStart(2, "0")}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0")}`;
  }

  function getLocalDateKey(timestamp: number) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatClockTime(timestamp: number | null) {
    if (!timestamp) return "--";
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(timestamp);
  }

  function formatAttendanceDate(dateKey: string) {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${dateKey}T00:00:00`));
  }

  function getDailyAttendanceSeconds(
    person: Employee | StaffMember | null | undefined,
    dateKey: string,
  ) {
    if (!person) return 0;
    return (person.attendanceRecords ?? [])
      .filter((record) => record.date === dateKey)
      .reduce((total, record) => {
        const duration = record.clockOut
          ? record.durationSeconds
          : attendanceNow
            ? Math.max(0, Math.floor((attendanceNow - record.clockIn) / 1000))
            : 0;
        return total + duration;
      }, 0);
  }

  function updateAttendanceEntry<T extends Employee | StaffMember>(
    person: T,
    now: number,
  ): T {
    if (person.attendanceStartedAt) {
      const sessionSeconds = Math.max(
        0,
        Math.floor((now - person.attendanceStartedAt) / 1000),
      );
      const totalSeconds = (person.attendanceSeconds ?? 0) + sessionSeconds;
      return {
        ...person,
        attendanceSeconds: totalSeconds,
        attendanceStartedAt: null,
        attendanceRecords: (person.attendanceRecords ?? []).map((record) =>
          record.clockOut === null
            ? {
                ...record,
                clockOut: now,
                durationSeconds: sessionSeconds,
              }
            : record,
        ),
        ...(person && "hours" in person
          ? { hours: formatAttendance(totalSeconds), active: false }
          : {}),
      };
    }
    return {
      ...person,
      attendanceStartedAt: now,
      attendanceRecords: [
        ...(person.attendanceRecords ?? []),
        {
          id: crypto.randomUUID(),
          date: getLocalDateKey(now),
          clockIn: now,
          clockOut: null,
          durationSeconds: 0,
        },
      ],
      ...(person && "active" in person ? { active: true } : {}),
    };
  }

  function toggleAttendance() {
    if (!currentUser) return;
    const now = Date.now();
    setAttendanceNow(now);
    if (currentUser.role === "Employee") {
      setEmployeeData((current) =>
        current.map((item) =>
          item.id === currentUser.id
            ? {
                ...updateAttendanceEntry(item, now),
                manualAttendance: (item.manualAttendance ?? []).filter(
                  (entry) => entry.date !== getLocalDateKey(now),
                ),
              }
            : item,
        ),
      );
      return;
    }
    setStaffData((current) =>
      current.map((member) =>
        member.id === currentUser.id
          ? updateAttendanceEntry(member, now)
          : member,
      ),
    );
  }

  async function markManualAttendance(
    employeeId: string,
    date: string,
    status: "Absent" | null,
  ) {
    if (currentUser?.role !== "Manager") return;
    setTeamAttendanceError("");
    setMarkingAttendanceFor(employeeId);
    try {
      const response = await apiRequest<{ workspace: Workspace }>(
        "/api/attendance/manual",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, date, status }),
        },
      );
      applyWorkspace(response.workspace);
    } catch (error) {
      setTeamAttendanceError(
        error instanceof Error ? error.message : "Unable to mark attendance.",
      );
    } finally {
      setMarkingAttendanceFor(null);
    }
  }

  function openEmployeeForm(employee?: Employee) {
    if (!canManageEmployees) return;
    setEditingEmployee(employee ?? null);
    setEmployeeName(employee?.name ?? "");
    setEmployeeRole(employee?.role ?? "");
    setEmployeePassword(employee?.password ?? "");
    setShowEmployeeForm(true);
  }

  function saveEmployee() {
    if (!canManageEmployees) return;
    const name = employeeName.trim();
    const role = employeeRole.trim();
    if (!name || !role || (!editingEmployee && !employeePassword.trim()))
      return;
    const initials = name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const employee: Employee = {
      name,
      role,
      initials,
      color: "user",
      hours: "0h 00m",
      attendanceSeconds: 0,
      attendanceStartedAt: null,
      attendanceRecords: [],
      manualAttendance: [],
      task: "0%",
      active: false,
      id: editingEmployee?.id ?? crypto.randomUUID(),
      password: employeePassword,
    };
    setEmployeeData((current) =>
      editingEmployee
        ? current.map((item) =>
            item.name === editingEmployee.name
              ? {
                  ...employee,
                  hours: item.hours,
                  attendanceSeconds: item.attendanceSeconds,
                  attendanceStartedAt: item.attendanceStartedAt,
                  attendanceRecords: item.attendanceRecords,
                  manualAttendance: item.manualAttendance,
                  task: item.task,
                  active: item.active,
                  password: employee.password || item.password,
                }
              : item,
          )
        : [...current, employee],
    );
    setShowEmployeeForm(false);
    setEmployeeName("");
    setEmployeeRole("");
    setEmployeePassword("");
    setEditingEmployee(null);
  }

  function deleteEmployee(name: string) {
    if (!canManageEmployees) return;
    if (window.confirm(`Delete ${name}?`)) {
      const employee = employeeData.find((entry) => entry.name === name);
      setEmployeeData((current) =>
        current.filter((entry) => entry.name !== name),
      );
      if (employee) {
        setTaskData((current) =>
          current.map((task) => ({
            ...task,
            ...(task.ownerId === employee.id
              ? { owner: "Unassigned", ownerId: undefined }
              : {}),
            collaborators: task.collaborators?.filter(
              (collaborator) => collaborator.employeeId !== employee.id,
            ),
          })),
        );
      }
    }
  }

  function openStaffForm(member?: StaffMember) {
    setEditingStaff(member ?? null);
    setStaffName(member?.name ?? "");
    setStaffRole(member?.role ?? "Manager");
    setStaffPassword(member?.password ?? "");
    setShowStaffForm(true);
  }

  function saveStaff() {
    const name = staffName.trim();
    if (!name || (!editingStaff && !staffPassword.trim())) return;
    const member: StaffMember = {
      id: editingStaff?.id ?? crypto.randomUUID(),
      name,
      role: staffRole,
      password: staffPassword,
      attendanceSeconds: editingStaff?.attendanceSeconds ?? 0,
      attendanceStartedAt: editingStaff?.attendanceStartedAt ?? null,
      attendanceRecords: editingStaff?.attendanceRecords ?? [],
    };
    setStaffData((current) => {
      return editingStaff
        ? current.map((item) => (item.id === editingStaff.id ? member : item))
        : [...current, member];
    });
    setShowStaffForm(false);
    setEditingStaff(null);
    setStaffName("");
    setStaffPassword("");
  }

  function deleteStaff(id: string) {
    if (window.confirm("Delete this admin or manager?"))
      setStaffData((current) => current.filter((member) => member.id !== id));
  }

  async function login() {
    if (!loginName.trim() || !loginPassword) return;
    setLoginError("");
    try {
      const response = await apiRequest<{
        user: SessionUser;
        workspace: Workspace;
      }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loginName, password: loginPassword }),
      });
      applyWorkspace(response.workspace);
      setCurrentUser(response.user);
      setAccountName(response.user.name);
      setLoginPassword("");
      navigateTo("Overview");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
    }
  }

  async function createFirstAdmin() {
    const name = loginName.trim();
    if (!name || !loginPassword.trim()) return;
    setLoginError("");
    try {
      const response = await apiRequest<{
        user: SessionUser;
        workspace: Workspace;
      }>("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: loginPassword }),
      });
      applyWorkspace(response.workspace);
      setCurrentUser(response.user);
      setAccountName(response.user.name);
      setSetupRequired(false);
      setIsSetupMode(false);
      setLoginName("");
      setLoginPassword("");
      navigateTo("Overview");
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : "Unable to create the workspace.",
      );
    }
  }

  async function logout() {
    try {
      await apiRequest<null>("/api/auth/logout", { method: "POST" });
    } finally {
      setCurrentUser(null);
      setEmployeeData([]);
      setStaffData([]);
      setTaskData([]);
      setOrderData([]);
      setPaymentRecords([]);
      window.history.replaceState(null, "", "/");
    }
  }

  async function saveAccountCredentials() {
    if (!currentUser || currentUser.role === "Employee" || accountSaving) return;
    const name = accountName.trim();
    setAccountError("");
    setAccountMessage("");

    if (!name || !accountCurrentPassword) {
      setAccountError("Login name and current password are required.");
      return;
    }
    if (accountNewPassword && accountNewPassword.length < 8) {
      setAccountError("New password must contain at least 8 characters.");
      return;
    }
    if (accountNewPassword !== accountConfirmPassword) {
      setAccountError("New password and confirmation do not match.");
      return;
    }

    setAccountSaving(true);
    try {
      const response = await apiRequest<{
        user: SessionUser;
        workspace: Workspace;
      }>("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          currentPassword: accountCurrentPassword,
          newPassword: accountNewPassword,
        }),
      });
      applyWorkspace(response.workspace);
      setCurrentUser(response.user);
      setAccountName(response.user.name);
      setAccountCurrentPassword("");
      setAccountNewPassword("");
      setAccountConfirmPassword("");
      setAccountMessage("Login credentials updated successfully.");
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Unable to update account.",
      );
    } finally {
      setAccountSaving(false);
    }
  }

  function saveTask() {
    if (
      currentUser?.role !== "Manager" ||
      !taskTitle.trim() ||
      !taskOwner ||
      !taskDue
    )
      return;
    const employee = employeeData.find((item) => item.id === taskOwner);
    if (!employee) return;
    const collaborators = Object.entries(taskCollaborators).map(
      ([employeeId, responsibility]) => {
        const collaborator = employeeData.find(
          (item) => item.id === employeeId,
        );
        return collaborator
          ? {
              employeeId,
              name: collaborator.name,
              responsibility: responsibility.trim(),
            }
          : null;
      },
    );
    if (
      !taskLeadResponsibility.trim() ||
      collaborators.some(
        (collaborator) => !collaborator?.responsibility,
      )
    ) {
      setTaskFormError("Describe the work assigned to each selected employee.");
      return;
    }
    const task: Task = {
      ...(editingTaskAssignment ?? {}),
      title: taskTitle.trim(),
      orderId: editingTaskAssignment?.orderId ?? assigningOrder?.id,
      owner: employee.name,
      ownerId: employee.id,
      leadResponsibility: taskLeadResponsibility.trim(),
      collaborators: collaborators.filter(
        (collaborator): collaborator is NonNullable<typeof collaborator> =>
          collaborator !== null,
      ),
      due: taskDue,
      progress: editingTaskAssignment?.progress ?? 0,
      tone: editingTaskAssignment?.tone ?? "blue",
      completed: editingTaskAssignment?.completed ?? false,
      status: editingTaskAssignment?.status ?? "Not started",
    };
    setTaskData((current) => {
      if (editingTaskAssignment) {
        return current.map((entry) =>
          entry.title === editingTaskAssignment.title &&
          entry.orderId === editingTaskAssignment.orderId
            ? task
            : entry,
        );
      }
      const existingOrderTask = assigningOrder
        ? current.find((entry) => entry.orderId === assigningOrder.id)
        : null;
      return existingOrderTask
        ? current.map((entry) =>
            entry.orderId === assigningOrder?.id ? task : entry,
          )
        : [...current, task];
    });
    const linkedOrderId = task.orderId;
    if (linkedOrderId) {
      setOrderData((current) =>
        current.map((order) =>
          order.id === linkedOrderId
            ? {
                ...order,
                assignedEmployeeId: employee.id,
                assignedEmployeeName: employee.name,
                status:
                  task.status === "Completed" ? "Completed" : "In progress",
                color: task.status === "Completed" ? "green" : "orange",
              }
            : order,
        ),
      );
    }
    closeTaskForm();
  }

  function resetTaskForm() {
    setTaskTitle("");
    setTaskOwner("");
    setTaskLeadResponsibility("");
    setTaskCollaborators({});
    setTaskDue("");
    setTaskFormError("");
    setEditingTaskAssignment(null);
    setAssigningOrder(null);
  }

  function closeTaskForm() {
    setShowTaskForm(false);
    resetTaskForm();
  }

  function openNewTaskForm() {
    resetTaskForm();
    setShowTaskForm(true);
  }

  function openTaskAssignment(task: Task) {
    if (currentUser?.role !== "Manager") return;
    setEditingTaskAssignment(task);
    setAssigningOrder(null);
    setTaskTitle(task.title);
    setTaskOwner(task.ownerId ?? "");
    setTaskLeadResponsibility(task.leadResponsibility ?? "");
    setTaskCollaborators(
      Object.fromEntries(
        (task.collaborators ?? []).map((collaborator) => [
          collaborator.employeeId,
          collaborator.responsibility,
        ]),
      ),
    );
    setTaskDue(task.due === "Not set" ? "" : task.due);
    setTaskFormError("");
    setShowTaskForm(true);
  }

  function openOrderAssignment(order: Order) {
    if (currentUser?.role !== "Manager") return;
    setEditingTaskAssignment(null);
    setAssigningOrder(order);
    setTaskTitle(`${order.id} · ${order.item}`);
    setTaskOwner("");
    setTaskLeadResponsibility("");
    setTaskCollaborators({});
    setTaskDue(order.deadline ?? "");
    setTaskFormError("");
    setShowTaskForm(true);
  }

  function toggleTask(title: string) {
    setTaskData((current) =>
      current.map((task) =>
        task.title === title
          ? {
              ...task,
              completed: !task.completed,
              completedAt: task.completed ? undefined : Date.now(),
              progress: task.completed ? 82 : 100,
              status: task.completed ? "In progress" : "Completed",
            }
          : task,
      ),
    );
  }

  function openTask(task: Task) {
    if (currentUser?.role === "Manager") {
      openTaskAssignment(task);
      return;
    }
    if (
      currentUser?.role !== "Employee" ||
      (task.ownerId !== currentUser.id &&
        task.owner !== currentUser.name &&
        !task.collaborators?.some(
          (collaborator) => collaborator.employeeId === currentUser.id,
        ))
    )
      return;
    setSelectedTask(task);
    setTaskStatus(
      task.status ?? (task.completed ? "Completed" : "Not started"),
    );
  }

  function updateTaskStatus() {
    if (!selectedTask || currentUser?.role !== "Employee") return;
    const isTaskLead =
      selectedTask.ownerId === currentUser.id ||
      selectedTask.owner === currentUser.name;
    if (taskStatus === "Completed" && !isTaskLead) return;
    const completed = taskStatus === "Completed";
    setTaskData((current) =>
      current.map((task) =>
        task.title === selectedTask.title
          ? {
              ...task,
              status: taskStatus,
              completed,
              completedAt: completed
                ? task.completedAt ?? Date.now()
                : undefined,
              progress:
                taskStatus === "Completed"
                  ? 100
                  : taskStatus === "In progress"
                    ? 50
                    : 0,
            }
          : task,
      ),
    );
    if (selectedTask.orderId) {
      setOrderData((current) =>
        current.map((order) =>
          order.id === selectedTask.orderId
            ? {
                ...order,
                status: completed ? "Completed" : "In progress",
                color: completed ? "green" : "orange",
              }
            : order,
        ),
      );
    }
    setSelectedTask(null);
  }

  function reassignTask(taskTitle: string, employee: Employee) {
    if (currentUser?.role !== "Manager") return;
    const linkedOrderId = taskData.find(
      (task) => task.title === taskTitle,
    )?.orderId;
    setTaskData((current) =>
      current.map((task) =>
        task.title === taskTitle
          ? {
              ...task,
              owner: employee.name,
              ownerId: employee.id,
              collaborators: task.collaborators?.filter(
                (collaborator) => collaborator.employeeId !== employee.id,
              ),
            }
          : task,
      ),
    );
    if (linkedOrderId) {
      setOrderData((current) =>
        current.map((order) =>
          order.id === linkedOrderId
            ? {
                ...order,
                assignedEmployeeId: employee.id,
                assignedEmployeeName: employee.name,
              }
            : order,
        ),
      );
    }
    setDraggedTaskTitle(null);
    setDraggedOrderId(null);
    setDragOverEmployeeId(null);
  }

  function assignOrderToEmployee(orderId: string, employee: Employee) {
    if (currentUser?.role !== "Manager") return;
    const order = orderData.find((entry) => entry.id === orderId);
    if (!order) return;
    setOrderData((current) =>
      current.map((entry) =>
        entry.id === orderId
          ? {
              ...entry,
              assignedEmployeeId: employee.id,
              assignedEmployeeName: employee.name,
              status: "In progress",
              color: "orange",
            }
          : entry,
      ),
    );
    setTaskData((current) => {
      const existingTask = current.find((task) => task.orderId === orderId);
      if (existingTask) {
        return current.map((task) =>
          task.orderId === orderId
            ? {
                ...task,
                owner: employee.name,
                ownerId: employee.id,
                collaborators: task.collaborators?.filter(
                  (collaborator) => collaborator.employeeId !== employee.id,
                ),
              }
            : task,
        );
      }
      return [
        ...current,
        {
          title: `${order.id} · ${order.item}`,
          orderId: order.id,
          owner: employee.name,
          ownerId: employee.id,
          due: order.deadline ?? "Not set",
          progress: 0,
          tone: "blue",
          completed: false,
          status: "Not started",
        },
      ];
    });
    setDraggedOrderId(null);
    setDraggedTaskTitle(null);
    setDragOverEmployeeId(null);
  }

  function unassignTask(taskTitle: string) {
    if (currentUser?.role !== "Manager") return;
    const task = taskData.find((entry) => entry.title === taskTitle);
    if (!task) return;
    setTaskData((current) =>
      current.map((entry) =>
        entry.title === taskTitle
          ? { ...entry, owner: "Unassigned", ownerId: undefined }
          : entry,
      ),
    );
    if (task.orderId) {
      setOrderData((current) =>
        current.map((order) =>
          order.id === task.orderId
            ? {
                ...order,
                assignedEmployeeId: undefined,
                assignedEmployeeName: undefined,
                status: "Pending",
                color: "orange",
              }
            : order,
        ),
      );
    }
    setDraggedTaskTitle(null);
    setDraggedOrderId(null);
    setDragOverEmployeeId(null);
  }

  function getTouchDropTarget(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    return element
      ?.closest<HTMLElement>("[data-task-drop-target]")
      ?.dataset.taskDropTarget;
  }

  function trackTouchDrop(clientX: number, clientY: number) {
    setDragOverEmployeeId(getTouchDropTarget(clientX, clientY) ?? null);
  }

  function finishTaskTouchDrag(
    taskTitle: string,
    clientX: number,
    clientY: number,
  ) {
    const target = getTouchDropTarget(clientX, clientY);
    if (target === "pending") {
      unassignTask(taskTitle);
      return;
    }
    const employee = employeeData.find((entry) => entry.id === target);
    if (employee) reassignTask(taskTitle, employee);
    else {
      setDraggedTaskTitle(null);
      setDragOverEmployeeId(null);
    }
  }

  function finishOrderTouchDrag(
    orderId: string,
    clientX: number,
    clientY: number,
  ) {
    const target = getTouchDropTarget(clientX, clientY);
    const employee = employeeData.find((entry) => entry.id === target);
    if (employee) assignOrderToEmployee(orderId, employee);
    else {
      setDraggedOrderId(null);
      setDragOverEmployeeId(null);
    }
  }

  function openOrderForm(order?: Order) {
    setEditingOrder(order ?? null);
    setOrderCustomer(order?.customer ?? "");
    setOrderCustomerMobile(order?.customerMobile ?? "");
    setOrderItem(order?.item ?? "");
    setOrderValue(order?.value.replace(/[^\d.]/g, "") ?? "");
    setOrderAdvanceAmount(
      order?.advanceAmount ? String(order.advanceAmount) : "",
    );
    const savedAdvancePayment = order
      ? paymentRecords.find(
          (payment) => payment.orderId === order.id && payment.source === "Advance",
        )
      : undefined;
    const savedMethod = order?.advancePaymentMethod ?? savedAdvancePayment?.method;
    setOrderAdvanceMethod(savedMethod === "Cash" ? "Cash" : "UPI");
    setOrderDeadline(order?.deadline ?? "");
    setOrderStatus(order?.status ?? "Pending");
    setOrderError("");
    setIntegrationSync(null);
    setIntegrationSyncError("");
    setShowOrderForm(true);
    if (order?.source === "Frames 41" && currentUser?.role !== "Employee") {
      setIntegrationSyncLoading(true);
      apiRequest<{ sync: IntegrationSyncState | null }>(
        `/api/v1/integrations/status/${encodeURIComponent(order.id)}`,
        { cache: "no-store" },
      )
        .then(({ sync }) => setIntegrationSync(sync))
        .catch((error: Error) => setIntegrationSyncError(error.message))
        .finally(() => setIntegrationSyncLoading(false));
    }
  }

  function saveOrder() {
    const customer = orderCustomer.trim();
    const customerMobile = orderCustomerMobile.trim();
    const mobileDigits = customerMobile.replace(/\D/g, "");
    const item = orderItem.trim();
    const amount = parseRupeesInput(orderValue);
    const advanceAmount = parseRupeesInput(orderAdvanceAmount);
    if (!customer || !customerMobile || !item || !amount) {
      setOrderError("Enter the customer, mobile number, item, and order value.");
      return;
    }
    if (mobileDigits.length < 10 || mobileDigits.length > 15) {
      setOrderError("Enter a valid customer mobile number.");
      return;
    }
    if (!advanceAmount) {
      setOrderError("An advance payment is required to create the order.");
      return;
    }
    if (advanceAmount > amount) {
      setOrderError("Advance payment cannot exceed the total order value.");
      return;
    }
    const statusColor =
      orderStatus === "Completed"
        ? "green"
        : orderStatus === "Cancelled"
          ? "pink"
          : "orange";
    const createdAt = editingOrder?.createdAt ?? Date.now();
    const resolvedDeadline = resolveOrderDeadline(orderDeadline, createdAt);
    const order: Order = editingOrder?.source === "Frames 41"
      ? {
          ...editingOrder,
          deadline: resolvedDeadline,
          status: orderStatus,
          color: statusColor,
        }
      : {
      id: editingOrder?.id ?? `#FF-${String(Date.now()).slice(-5)}`,
      createdAt,
      customer,
      customerMobile,
      item,
      value: formatRupees(amount),
      advanceAmount,
      advancePaymentMethod: orderAdvanceMethod,
      deadline: resolvedDeadline,
      assignedEmployeeId: editingOrder?.assignedEmployeeId,
      assignedEmployeeName: editingOrder?.assignedEmployeeName,
      status: orderStatus,
      color: statusColor,
    };
    setOrderData((current) =>
      editingOrder
        ? current.map((entry) => (entry.id === editingOrder.id ? order : entry))
        : [order, ...current],
    );
    const advancePaymentId = `advance-${order.id}`;
    if (order.source !== "Frames 41") setPaymentRecords((current) => {
      const existingPayment = current.find(
        (payment) => payment.id === advancePaymentId,
      );
      const advancePayment: PaymentRecord = {
        id: advancePaymentId,
        orderId: order.id,
        source: "Advance",
        customer,
        cashAmount: orderAdvanceMethod === "Cash" ? advanceAmount : 0,
        upiAmount: orderAdvanceMethod === "UPI" ? advanceAmount : 0,
        total: advanceAmount,
        method: orderAdvanceMethod,
        upiReference: "",
        createdAt: existingPayment?.createdAt ?? createdAt,
      };
      return existingPayment
        ? current.map((payment) =>
            payment.id === advancePaymentId ? advancePayment : payment,
          )
        : [...current, advancePayment];
    });
    if (editingOrder) {
      setTaskData((current) =>
        current.map((task) =>
          task.orderId === editingOrder.id
            ? { ...task, due: resolvedDeadline }
            : task,
        ),
      );
    }
    setShowOrderForm(false);
    setEditingOrder(null);
    setOrderCustomer("");
    setOrderCustomerMobile("");
    setOrderItem("");
    setOrderValue("");
    setOrderAdvanceAmount("");
    setOrderAdvanceMethod("UPI");
    setOrderDeadline("");
    setOrderStatus("Pending");
    setOrderError("");
  }

  async function retryFramesSync() {
    if (!editingOrder) return;
    setIntegrationSyncLoading(true);
    setIntegrationSyncError("");
    try {
      const response = await apiRequest<{ sync: IntegrationSyncState | null }>(
        `/api/v1/integrations/status/${encodeURIComponent(editingOrder.id)}`,
        { method: "POST" },
      );
      setIntegrationSync(response.sync);
    } catch (error) {
      setIntegrationSyncError(error instanceof Error ? error.message : "Unable to retry sync.");
    } finally {
      setIntegrationSyncLoading(false);
    }
  }

  function deleteOrder(order: Order) {
    if (!window.confirm(`Delete order ${order.id}?`)) return;
    setOrderData((current) =>
      current.filter((entry) => entry.id !== order.id),
    );
    setTaskData((current) =>
      current.filter((task) => task.orderId !== order.id),
    );
    setPaymentRecords((current) =>
      current.filter(
        (payment) =>
          !(payment.orderId === order.id && payment.source === "Advance"),
      ),
    );
  }

  const visibleEmployees = employeeData.filter((employee) =>
    `${employee.name} ${employee.role}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );
  const visibleStaff = staffData.filter((member) =>
    `${member.name} ${member.role}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );
  const visibleTasks = taskData.filter(
    (task) =>
      (currentUser?.role !== "Employee" ||
        task.ownerId === currentUser.id ||
        task.owner === currentUser.name ||
        task.collaborators?.some(
          (collaborator) => collaborator.employeeId === currentUser.id,
        )) &&
      `${task.title} ${task.owner} ${(task.collaborators ?? []).map((collaborator) => collaborator.name).join(" ")}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );
  const visibleOrders = orderData.filter((order) =>
    `${order.customer} ${order.customerMobile ?? ""} ${order.id} ${order.item}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );
  const recentOrders = [...orderData]
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    .slice(0, 5);
  const reportStart = new Date(attendanceNow);
  reportStart.setHours(0, 0, 0, 0);
  if (collectionReportPeriod === "Weekly") {
    const daysFromMonday = (reportStart.getDay() + 6) % 7;
    reportStart.setDate(reportStart.getDate() - daysFromMonday);
  } else if (collectionReportPeriod === "Monthly") {
    reportStart.setDate(1);
  } else if (collectionReportPeriod === "Yearly") {
    reportStart.setMonth(0, 1);
  }
  const reportEnd = new Date(reportStart);
  if (collectionReportPeriod === "Daily") {
    reportEnd.setDate(reportEnd.getDate() + 1);
  } else if (collectionReportPeriod === "Weekly") {
    reportEnd.setDate(reportEnd.getDate() + 7);
  } else if (collectionReportPeriod === "Monthly") {
    reportEnd.setMonth(reportEnd.getMonth() + 1);
  } else {
    reportEnd.setFullYear(reportEnd.getFullYear() + 1);
  }
  const reportingPaymentRecords = paymentRecords.filter(
    (payment) =>
      payment.createdAt >= reportStart.getTime() &&
      payment.createdAt < reportEnd.getTime(),
  );
  const reportingOrders = orderData.filter(
    (order) =>
      (order.createdAt ?? 0) >= reportStart.getTime() &&
      (order.createdAt ?? 0) < reportEnd.getTime(),
  );
  const reportingTasks = taskData.filter((task) => {
    if (task.completedAt) {
      return (
        task.completedAt >= reportStart.getTime() &&
        task.completedAt < reportEnd.getTime()
      );
    }
    const dueAt = Date.parse(`${task.due}T23:59:59`);
    return (
      Number.isFinite(dueAt) &&
      dueAt >= reportStart.getTime() &&
      dueAt < reportEnd.getTime()
    );
  });
  const reportingCompletedTasks = reportingTasks.filter(
    (task) => task.completed,
  );
  const reportCashCollectedAmount = reportingPaymentRecords.reduce(
    (total, payment) => total + payment.cashAmount,
    0,
  );
  const reportUpiCollectedAmount = reportingPaymentRecords.reduce(
    (total, payment) => total + payment.upiAmount,
    0,
  );
  const outstandingOrderAmount = orderData.reduce(
    (total, order) =>
      total +
      Math.max(
        0,
        parseRupeesInput(order.value) - (order.advanceAmount ?? 0),
      ),
    0,
  );
  const collectionDetailRows =
    expandedCollection === "Outstanding"
      ? orderData
          .map((order) => ({
            id: order.id,
            orderId: order.id,
            customer: order.customer,
            meta: order.item,
            amount: Math.max(
              0,
              parseRupeesInput(order.value) - (order.advanceAmount ?? 0),
            ),
          }))
          .filter((entry) => entry.amount > 0)
      : reportingPaymentRecords
          .filter((payment) =>
            expandedCollection === "Cash collections"
              ? payment.cashAmount > 0
              : expandedCollection === "UPI collections"
                ? payment.upiAmount > 0
                : true,
          )
          .map((payment) => ({
            id: payment.id,
            orderId:
              payment.orderId ??
              orderData.find(
                (order) =>
                  order.customer.toLowerCase() === payment.customer.toLowerCase(),
              )?.id ??
              "Manual payment",
            customer: payment.customer,
            meta: `${payment.source === "Advance" ? "Order advance · " : ""}${payment.method} · ${new Intl.DateTimeFormat("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }).format(payment.createdAt)}`,
            amount:
              expandedCollection === "Cash collections"
                ? payment.cashAmount
                : expandedCollection === "UPI collections"
                  ? payment.upiAmount
                  : payment.total,
          }));
  const splitPaymentTotal =
    parseRupeesInput(cashPaymentAmount) +
    parseRupeesInput(upiPaymentAmount);
  const signedInEmployee =
    currentUser?.role === "Employee"
      ? employeeData.find(
          (employee) =>
            employee.id === currentUser.id ||
            employee.name === currentUser.name,
        )
      : null;
  const signedInStaff =
    currentUser?.role !== "Employee"
      ? staffData.find(
          (member) =>
            member.id === currentUser?.id || member.name === currentUser?.name,
        )
      : null;
  const currentAttendancePerson = signedInEmployee ?? signedInStaff;
  const currentDateTime = new Date(attendanceNow);
  const currentHour = currentDateTime.getHours();
  const greeting =
    currentHour < 5
      ? "Good night"
      : currentHour < 12
        ? "Good morning"
        : currentHour < 17
          ? "Good afternoon"
          : currentHour < 21
            ? "Good evening"
            : "Good night";
  const formattedCurrentDate = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(currentDateTime);
  const currentUserIsClockedIn = Boolean(
    currentAttendancePerson?.attendanceStartedAt,
  );
  const todayKey = getLocalDateKey(attendanceNow);
  const currentAttendanceSeconds = getDailyAttendanceSeconds(
    currentAttendancePerson,
    todayKey,
  );
  const displayedHoursSeconds = (currentAttendancePerson?.attendanceRecords ?? [])
    .filter((record) => record.clockIn >= reportStart.getTime())
    .reduce(
      (total, record) =>
        total +
        (record.clockOut
          ? record.durationSeconds
          : Math.max(0, Math.floor((attendanceNow - record.clockIn) / 1000))),
      0,
    );
  const currentAttendanceRecord = [
    ...(currentAttendancePerson?.attendanceRecords ?? []),
  ]
    .reverse()
    .find((record) => record.date === todayKey);
  const selectedEmployeeData = employeeData.find(
    (employee) => employee.name === selectedEmployee,
  );
  const selectedAttendanceRecords = [
    ...(selectedEmployeeData?.attendanceRecords ?? []),
  ].reverse();
  const weekStart = new Date(attendanceNow);
  const dayFromMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dayFromMonday);
  const attendanceWeek = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const dateKey = getLocalDateKey(date.getTime());
    return {
      dateKey,
      label: date.toLocaleDateString("en-IN", { weekday: "short" }),
      seconds: getDailyAttendanceSeconds(currentAttendancePerson, dateKey),
    };
  });
  const attendanceReportStart = new Date(attendanceNow);
  attendanceReportStart.setHours(0, 0, 0, 0);
  if (attendanceReportPeriod === "Weekly") {
    const daysFromMonday = (attendanceReportStart.getDay() + 6) % 7;
    attendanceReportStart.setDate(
      attendanceReportStart.getDate() - daysFromMonday,
    );
  } else if (attendanceReportPeriod === "Monthly") {
    attendanceReportStart.setDate(1);
  }
  const attendanceReportEnd = new Date(attendanceReportStart);
  if (attendanceReportPeriod === "Daily") {
    attendanceReportEnd.setDate(attendanceReportEnd.getDate() + 1);
  } else if (attendanceReportPeriod === "Weekly") {
    attendanceReportEnd.setDate(attendanceReportEnd.getDate() + 7);
  } else {
    attendanceReportEnd.setMonth(attendanceReportEnd.getMonth() + 1);
  }
  const attendanceReportRecords = (
    currentAttendancePerson?.attendanceRecords ?? []
  )
    .filter(
      (record) =>
        record.clockIn >= attendanceReportStart.getTime() &&
        record.clockIn < attendanceReportEnd.getTime(),
    )
    .sort((left, right) => right.clockIn - left.clockIn);
  const attendanceReportTotalSeconds = attendanceReportRecords.reduce(
    (total, record) =>
      total +
      (record.clockOut
        ? record.durationSeconds
        : Math.max(0, Math.floor((attendanceNow - record.clockIn) / 1000))),
    0,
  );
  const attendanceReportDays = Array.from(
    attendanceReportRecords.reduce(
      (days, record) => {
        const existing = days.get(record.date) ?? {
          date: record.date,
          clockIn: record.clockIn,
          clockOut: record.clockOut,
          durationSeconds: 0,
          hasOpenSession: false,
        };
        existing.clockIn = Math.min(existing.clockIn, record.clockIn);
        existing.hasOpenSession ||= record.clockOut === null;
        if (record.clockOut !== null) {
          existing.clockOut = Math.max(existing.clockOut ?? 0, record.clockOut);
        }
        existing.durationSeconds += record.clockOut
          ? record.durationSeconds
          : Math.max(0, Math.floor((attendanceNow - record.clockIn) / 1000));
        days.set(record.date, existing);
        return days;
      },
      new Map<
        string,
        {
          date: string;
          clockIn: number;
          clockOut: number | null;
          durationSeconds: number;
          hasOpenSession: boolean;
        }
      >(),
    ).values(),
  ).sort((left, right) => right.clockIn - left.clockIn);
  const attendanceReportWorkedDays = attendanceReportDays.length;
  const attendanceReportAverageSeconds = attendanceReportWorkedDays
    ? Math.floor(attendanceReportTotalSeconds / attendanceReportWorkedDays)
    : 0;
  const canViewTeamAttendance =
    currentUser?.role === "Admin" || currentUser?.role === "Manager";
  const canMarkTeamAttendance =
    currentUser?.role === "Manager" && teamAttendancePeriod === "Daily";
  const teamAttendanceRange = getAttendancePeriodRange(
    attendanceNow,
    teamAttendancePeriod,
  );
  const teamAttendanceRows = employeeData.flatMap<TeamAttendanceRow>(
    (employee) => {
      const days = summarizeAttendanceRecords(
        employee.attendanceRecords ?? [],
        teamAttendanceRange.start,
        teamAttendanceRange.end,
        attendanceNow,
      );
      const daysByDate = new Map(days.map((day) => [day.date, day]));
      const manualByDate = new Map(
        (employee.manualAttendance ?? [])
          .filter((entry) => {
            const timestamp = new Date(`${entry.date}T00:00:00`).getTime();
            return (
              timestamp >= teamAttendanceRange.start &&
              timestamp < teamAttendanceRange.end
            );
          })
          .map((entry) => [entry.date, entry.status]),
      );
      const dates = new Set([...daysByDate.keys(), ...manualByDate.keys()]);
      if (teamAttendancePeriod === "Daily") dates.add(todayKey);
      if (!dates.size) {
        return [
          {
            employee,
            date: null,
            clockIn: null,
            clockOut: null,
            durationSeconds: 0,
            hasOpenSession: false,
            manualStatus: null,
          },
        ];
      }
      return [...dates]
        .sort((left, right) => right.localeCompare(left))
        .map((date) => {
          const day = daysByDate.get(date);
          return {
            employee,
            date,
            clockIn: day?.clockIn ?? null,
            clockOut: day?.clockOut ?? null,
            durationSeconds: day?.durationSeconds ?? 0,
            hasOpenSession: day?.hasOpenSession ?? false,
            manualStatus: manualByDate.get(date) ?? null,
          };
        });
    },
  );
  const teamAttendanceRecordedEmployees = new Set(
    teamAttendanceRows
      .filter((row) => row.clockIn !== null || row.manualStatus !== null)
      .map((row) => row.employee.id),
  ).size;
  const teamAttendanceTotalSeconds = teamAttendanceRows.reduce(
    (total, row) => total + row.durationSeconds,
    0,
  );
  const activeTeamMembers = employeeData.filter(
    (employee) => employee.attendanceStartedAt,
  ).length;
  const teamTodayAverageSeconds = employeeData.length
    ? Math.floor(
        employeeData.reduce(
          (total, employee) =>
            total + getDailyAttendanceSeconds(employee, todayKey),
          0,
        ) / employeeData.length,
      )
    : 0;
  const selectedTaskIsLead = Boolean(
    selectedTask &&
      currentUser &&
      (selectedTask.ownerId === currentUser.id ||
        selectedTask.owner === currentUser.name),
  );
  const selectedTaskResponsibility = selectedTask
    ? selectedTaskIsLead
      ? selectedTask.leadResponsibility
      : selectedTask.collaborators?.find(
          (collaborator) => collaborator.employeeId === currentUser?.id,
        )?.responsibility
    : undefined;
  function averageClockTime(timestamps: Array<number | null>) {
    const validTimestamps = timestamps
      .filter((timestamp): timestamp is number => typeof timestamp === "number");
    if (!validTimestamps.length) return "--";
    const averageMinutes = Math.round(
      validTimestamps.reduce((total, timestamp) => {
        const date = new Date(timestamp);
        return total + date.getHours() * 60 + date.getMinutes();
      }, 0) / validTimestamps.length,
    );
    const averageDate = new Date();
    averageDate.setHours(
      Math.floor(averageMinutes / 60),
      averageMinutes % 60,
      0,
      0,
    );
    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(averageDate);
  }
  const taskBoardEmployees =
    currentUser?.role === "Employee"
      ? signedInEmployee
        ? [signedInEmployee]
        : []
      : employeeData;
  const pendingAssignmentOrders = orderData.filter(
    (order) =>
      !order.assignedEmployeeId &&
      order.status !== "Cancelled" &&
      `${order.id} ${order.customer} ${order.item}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );
  const unassignedTasks = taskData.filter(
    (task) =>
      !task.ownerId &&
      !task.orderId &&
      `${task.title} ${task.status} ${task.due}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );
  const employeeNavigation = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Tasks", icon: BriefcaseBusiness },
    { label: "Reports", icon: CircleDollarSign },
  ];
  const contextItems =
    activeNav === "Tasks"
      ? visibleTasks.map((task) => ({
          label: task.title,
          meta: task.collaborators?.length
            ? `${task.owner} + ${task.collaborators.length}`
            : task.owner,
          value: `${task.progress}%`,
          detail: task.status ?? (task.completed ? "Completed" : task.due),
        }))
      : activeNav === "Orders"
        ? visibleOrders.map((order) => ({
            label: order.customer,
            meta: order.id,
            value: order.value,
            detail: order.status,
          }))
          : activeNav === "People" || activeNav === "My team"
            ? visibleEmployees.map((employee) => ({
                label: employee.name,
                meta: employee.role,
                value: formatAttendance(
                  getDailyAttendanceSeconds(employee, todayKey),
                ),
                detail: employee.active ? "Active today" : "Away today",
            }))
          : activeNav === "Staff"
            ? visibleStaff.map((member) => ({
                label: member.name,
                meta: member.role,
                value: formatAttendance(
                  getDailyAttendanceSeconds(member, todayKey),
                ),
                detail: member.attendanceStartedAt
                  ? "Logged in"
                  : "Not logged in",
              }))
            : activeNav === "Reports"
              ? [
                  {
                    label: "My hours",
                    meta: reportPeriodLabels[collectionReportPeriod],
                    value: formatAttendance(displayedHoursSeconds),
                    detail: `${collectionReportPeriod} attendance`,
                  },
                  {
                    label: "Tasks completed",
                    meta: reportPeriodLabels[collectionReportPeriod],
                    value: `${reportingCompletedTasks.length}`,
                    detail: `${reportingTasks.length} tasks in period`,
                  },
                  {
                    label: "Orders created",
                    meta: reportPeriodLabels[collectionReportPeriod],
                    value: `${reportingOrders.length}`,
                    detail: `${collectionReportPeriod} orders`,
                  },
                  {
                    label: "Total collected",
                    meta: reportPeriodLabels[collectionReportPeriod],
                    value: formatRupees(
                      reportCashCollectedAmount + reportUpiCollectedAmount,
                    ),
                    detail: `${reportingPaymentRecords.length} payments`,
                  },
                ]
              : activeNav === "Settings"
                ? [
                    {
                      label: "Signed-in account",
                      meta: currentUser?.name ?? "",
                      value: currentUser?.role ?? "",
                      detail: "Active session",
                    },
                    {
                      label: "Workspace",
                      meta: "DF Solutions",
                      value: "Local",
                      detail: "Browser storage enabled",
                    },
                  ]
                : activeNav === "Collections"
                  ? [
                      {
                        label: "Cash collections",
                        meta: `${collectionReportPeriod} report`,
                        value: formatRupees(reportCashCollectedAmount),
                        detail: `${reportingPaymentRecords.filter((payment) => payment.cashAmount > 0).length} receipts`,
                      },
                      {
                        label: "UPI collections",
                        meta: `${collectionReportPeriod} report`,
                        value: formatRupees(reportUpiCollectedAmount),
                        detail: `${reportingPaymentRecords.filter((payment) => payment.upiAmount > 0).length} receipts`,
                      },
                      {
                        label: "Total collected",
                        meta: `${collectionReportPeriod} report`,
                        value: formatRupees(
                          reportCashCollectedAmount +
                            reportUpiCollectedAmount,
                        ),
                        detail: `${reportingPaymentRecords.length} payments`,
                      },
                      {
                        label: "Outstanding",
                        meta: `Across ${orderData.length} orders`,
                        value: formatRupees(outstandingOrderAmount),
                        detail: orderData.length
                          ? "Remaining order balances"
                          : "No orders yet",
                      },
                    ]
                  : activeNav === "Products"
                    ? []
                    : [
                        {
                          label: "Workspace health",
                          meta: "All systems",
                          value: "Ready",
                          detail: "Awaiting records",
                        },
                      ];

  if (!isHydrated) {
    return (
      <main className="login-page login-loading">
        <section className="login-card loading-card" aria-live="polite">
          <Image
            className="brand-logo loading-logo"
            src="/df-desk-logo.svg"
            alt="Desk"
            width={990}
            height={240}
            loading="eager"
          />
          <p>Connecting to Desk…</p>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="login-page">
        <section className="login-form-panel">
          <form
            className="login-card"
            onSubmit={(event) => {
              event.preventDefault();
              void (isSetupMode ? createFirstAdmin() : login());
            }}
          >
            <div className="brand login-brand">
              <Image
                className="brand-logo login-logo"
                src="/df-desk-logo.svg"
                alt="Desk"
                width={990}
                height={240}
                priority
              />
            </div>
            <div className="login-heading">
              <h1>{isSetupMode ? "Create your workspace" : "Welcome back"}</h1>
              <p>
                {isSetupMode
                  ? "Create the first administrator account for Desk."
                  : "Enter your details to sign in to Desk."}
              </p>
            </div>
            <label className="input-label">
              {isSetupMode ? "Administrator name" : "Login name"}
              <span className="login-input-shell">
                <UserRound size={18} aria-hidden="true" />
                <input
                  className="form-input"
                  value={loginName}
                  onChange={(event) => {
                    setLoginName(event.target.value);
                    setLoginError("");
                  }}
                  placeholder="Enter your full name"
                  autoComplete="username"
                  autoFocus
                />
              </span>
            </label>
            <label className="input-label">
              Password
              <span className="login-input-shell">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  className="form-input"
                  type={showLoginPassword ? "text" : "password"}
                  value={loginPassword}
                  onChange={(event) => {
                    setLoginPassword(event.target.value);
                    setLoginError("");
                  }}
                  placeholder="Enter your password"
                  autoComplete={isSetupMode ? "new-password" : "current-password"}
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  onClick={() => setShowLoginPassword((visible) => !visible)}
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
                >
                  {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {loginError && <p className="login-error">{loginError}</p>}
            <button className="button button-primary login-submit" type="submit">
              {isSetupMode ? "Create Admin account" : "Sign in"}
            </button>
            {isSetupMode ? (
              <button
                className="reset-workspace"
                type="button"
                onClick={() => {
                  setIsSetupMode(false);
                  setLoginError("");
                }}
              >
                Back to sign in
              </button>
            ) : (
              <>
                <small className="login-hint">
                  Use the account provided by your Admin or Manager.
                </small>
                {setupRequired && (
                  <button
                    className="reset-workspace"
                    type="button"
                    onClick={() => {
                      setIsSetupMode(true);
                      setLoginError("");
                    }}
                  >
                    Create the first account
                  </button>
                )}
              </>
            )}
          </form>
        </section>
        <aside className="login-visual" aria-label="Desk operations workspace">
          <div className="login-visual-copy">
            <span>DF Solutions · Desk</span>
            <h2>Run your operations with confidence.</h2>
            <p>
              Keep your people, tasks, orders, attendance, and collections in
              one clear workspace.
            </p>
          </div>
        </aside>
      </main>
    );
  }

  const attendancePanel = (
    <div className="panel attendance-panel">
      <div className="panel-heading">
        <button
          className="attendance-heading-button"
          onClick={() => setShowAttendanceReport(true)}
        >
          <span>
          <h2>My attendance</h2>
          <p>Your time at a glance</p>
          </span>
          <ArrowUpRight size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Open attendance report"
          onClick={() => setShowAttendanceReport(true)}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div className="attendance-clock">
        <div className="clock-ring">
          <span>Today</span>
          <strong>{formatAttendance(currentAttendanceSeconds)}</strong>
          <small>
            {currentUserIsClockedIn ? "hours logged" : "not logged in"}
          </small>
        </div>
      </div>
      <div className="attendance-detail">
        <div>
          <span className="detail-label">
            <i className="dot green-dot" />
            Logged in
          </span>
          <strong>
            {formatClockTime(currentAttendanceRecord?.clockIn ?? null)}
          </strong>
        </div>
        <div>
          <span className="detail-label">
            <i className="dot grey-dot" />
            Logged out
          </span>
          <strong>
            {formatClockTime(currentAttendanceRecord?.clockOut ?? null)}
          </strong>
        </div>
      </div>
      <button
        className={`button attendance-button ${currentUserIsClockedIn ? "button-dark" : "button-primary"}`}
        onClick={toggleAttendance}
      >
        <span className="live-pip" />
        {currentUserIsClockedIn ? "Log out" : "Log in"}
      </button>
      <div className="week-strip">
        {attendanceWeek.map((day) => (
          <span
            className={day.dateKey === todayKey ? "today" : ""}
            key={day.dateKey}
          >
            {day.label}
            <b>{day.seconds ? (day.seconds / 3600).toFixed(1) : "—"}</b>
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className={`app-shell ${currentUser.role === "Employee" ? "employee-view" : ""}`}
    >
      {syncError && (
        <div className="sync-error" role="alert">
          Could not save changes: {syncError}
        </div>
      )}
      <div
        className={`mobile-overlay ${mobileMenuOpen ? "open" : ""}`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside className={`sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <Image
            className="brand-logo sidebar-logo"
            src="/df-desk-logo.svg"
            alt="Desk"
            width={990}
            height={240}
            loading="eager"
          />
        </div>
        <div className="workspace-switcher">
          <span className="workspace-dot" />
          <span>
            <strong>DF Solutions</strong>
            <small>Operations workspace</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {(currentUser.role === "Employee"
            ? employeeNavigation
            : navigation
          ).map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${activeNav === label ? "active" : ""}`}
              onClick={() => {
                navigateTo(label as WorkspaceSection);
                setMobileMenuOpen(false);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
          {currentUser.role !== "Employee" && (
            <>
              <p className="nav-label nav-label-spaced">Manage</p>
              <button
                className="nav-item"
                onClick={() => {
                  navigateTo("People");
                  setMobileMenuOpen(false);
                }}
              >
                <Users size={17} />
                <span>People</span>
              </button>
              <button
                className="nav-item"
                onClick={() => {
                  navigateTo("Staff");
                  setMobileMenuOpen(false);
                }}
              >
                <ShieldCheck size={17} />
                <span>Admins &amp; managers</span>
              </button>
              <button
                className="nav-item"
                onClick={() => {
                  navigateTo("Products");
                  setMobileMenuOpen(false);
                }}
              >
                <PackageCheck size={17} />
                <span>Products</span>
              </button>
              <button
                className="nav-item"
                onClick={() => {
                  navigateTo("Reports");
                  setMobileMenuOpen(false);
                }}
              >
                <CircleDollarSign size={17} />
                <span>Reports</span>
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${activeNav === "Settings" ? "active" : ""}`}
            onClick={() => {
              navigateTo("Settings");
              setMobileMenuOpen(false);
            }}
          >
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <button
            className="nav-item sidebar-logout"
            onClick={() => {
              setMobileMenuOpen(false);
              void logout();
            }}
          >
            <LogOut size={17} />
            <span>Log out</span>
          </button>
          <div className="user-mini">
            <span className="avatar avatar-user">{currentUserInitials}</span>
            <span>
              <strong>{currentUser.name}</strong>
              <small>{currentUser.role}</small>
            </span>
            <MoreHorizontal size={16} />
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Image
              className="mobile-menu-logo"
              src="/df-desk-short-logo.svg"
              alt=""
              width={480}
              height={230}
            />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{activeNav}</strong>
          </div>
          <div className="top-actions">
            <div className="signed-in-user">
              <span>Signed in as</span>
              <strong>{currentUser.name}</strong>
              <small>{currentUser.role}</small>
              <button onClick={logout}>Log out</button>
            </div>
            <div className="search-box">
              <Search size={16} />
              <input
                placeholder="Search anything"
                aria-label="Search anything"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <span>⌘ K</span>
            </div>
            {currentUser.role !== "Employee" && (
              <div className="notification-center">
                <button
                  className="icon-button notification"
                  aria-label="Recent order notifications"
                  aria-expanded={notificationsOpen}
                  aria-controls="recent-order-notifications"
                  onClick={() => setNotificationsOpen((open) => !open)}
                >
                  <Bell size={18} />
                  {recentOrders.length > 0 && <i aria-hidden="true" />}
                </button>
                {notificationsOpen && (
                  <div
                    className="notification-popover"
                    id="recent-order-notifications"
                    role="dialog"
                    aria-label="Recent orders"
                  >
                    <div className="notification-popover-heading">
                      <div>
                        <strong>Recent orders</strong>
                        <small>Newest customer orders</small>
                      </div>
                      <span>{recentOrders.length}</span>
                    </div>
                    <div className="notification-order-list">
                      {recentOrders.length ? (
                        recentOrders.map((order) => (
                          <button
                            className="notification-order"
                            key={order.id}
                            onClick={() => {
                              setNotificationsOpen(false);
                              navigateTo("Orders");
                              openOrderForm(order);
                            }}
                          >
                            <span className="notification-order-topline">
                              <strong>{order.customer}</strong>
                              <small>{order.status}</small>
                            </span>
                            <span>{order.item}</span>
                            <span className="notification-order-meta">
                              <small>{order.id}</small>
                              <strong>{order.value}</strong>
                            </span>
                            <time>
                              {order.createdAt
                                ? new Intl.DateTimeFormat("en-IN", {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }).format(order.createdAt)
                                : "Recently added"}
                            </time>
                          </button>
                        ))
                      ) : (
                        <p className="notification-empty">No recent orders yet.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button className="help-button">?</button>
          </div>
        </header>
        {activeNav === "Tasks" ? (
          <div className="page-wrap task-board-page">
            <section className="task-board-header">
              <div>
                <p className="eyebrow">Team workload</p>
                <h1>Employee tasks</h1>
                <p className="subcopy">
                  {currentUser.role === "Manager"
                    ? "Drag a task to another employee to reassign it."
                    : "Tasks grouped by assigned employee."}
                </p>
              </div>
              {currentUser.role === "Manager" && (
                <button
                  className="button button-primary"
                  onClick={openNewTaskForm}
                >
                  <Plus size={16} />
                  Add task
                </button>
              )}
            </section>
            {taskBoardEmployees.length ||
            (currentUser.role !== "Employee" &&
              (pendingAssignmentOrders.length || unassignedTasks.length)) ? (
              <section className="task-bento-grid" aria-label="Employee tasks">
                {currentUser.role !== "Employee" && (
                  <article
                    className={`task-employee-card pending-assignment-card ${dragOverEmployeeId === "pending" ? "drag-over" : ""}`}
                    data-task-drop-target="pending"
                    onDragOver={(event) => {
                      if (
                        currentUser.role !== "Manager" ||
                        !draggedTaskTitle
                      )
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverEmployeeId("pending");
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node))
                        setDragOverEmployeeId(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const taskTitle =
                        draggedTaskTitle ||
                        event.dataTransfer.getData("text/plain");
                      if (taskTitle) unassignTask(taskTitle);
                    }}
                  >
                    <div className="task-employee-heading">
                      <span className="pending-assignment-icon">
                        <ShoppingBag size={16} />
                      </span>
                      <div>
                        <strong>Pending to Assign</strong>
                        <small>New customer orders</small>
                      </div>
                      <b>
                        {pendingAssignmentOrders.length +
                          unassignedTasks.length}
                      </b>
                    </div>
                    <div className="task-card-list">
                      {unassignedTasks.map((task) => (
                        <div
                          className={`bento-task pending-order-task ${draggedTaskTitle === task.title ? "is-dragging" : ""}`}
                          draggable={currentUser.role === "Manager"}
                          key={task.title}
                          onTouchStart={() => {
                            if (currentUser.role !== "Manager") return;
                            setDraggedTaskTitle(task.title);
                            setDraggedOrderId(null);
                          }}
                          onTouchMove={(event) => {
                            if (currentUser.role !== "Manager") return;
                            event.preventDefault();
                            const touch = event.touches[0];
                            if (touch)
                              trackTouchDrop(touch.clientX, touch.clientY);
                          }}
                          onTouchEnd={(event) => {
                            if (currentUser.role !== "Manager") return;
                            const touch = event.changedTouches[0];
                            if (touch)
                              finishTaskTouchDrag(
                                task.title,
                                touch.clientX,
                                touch.clientY,
                              );
                          }}
                          onTouchCancel={() => {
                            setDraggedTaskTitle(null);
                            setDragOverEmployeeId(null);
                          }}
                          onDragStart={(event) => {
                            setDraggedTaskTitle(task.title);
                            setDraggedOrderId(null);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", task.title);
                          }}
                          onDragEnd={() => {
                            setDraggedTaskTitle(null);
                            setDragOverEmployeeId(null);
                          }}
                          onClick={() => openTaskAssignment(task)}
                        >
                          <div className="bento-task-top">
                            <strong>{task.title}</strong>
                            <span className="work-status status-not-started">
                              Unassigned
                            </span>
                          </div>
                          <small>Task · Due {task.due}</small>
                          <div className="bento-task-progress">
                            <span className="progress-track">
                              <span
                                className={`progress-fill ${task.tone}-fill`}
                                style={{ width: `${task.progress}%` }}
                              />
                            </span>
                            <b>{task.progress}%</b>
                          </div>
                        </div>
                      ))}
                      {pendingAssignmentOrders.length ? (
                        pendingAssignmentOrders.map((order) => (
                          <div
                            className={`bento-task pending-order-task ${draggedOrderId === order.id ? "is-dragging" : ""}`}
                            draggable={currentUser.role === "Manager"}
                            key={order.id}
                            onTouchStart={() => {
                              if (currentUser.role !== "Manager") return;
                              setDraggedOrderId(order.id);
                              setDraggedTaskTitle(null);
                            }}
                            onTouchMove={(event) => {
                              if (currentUser.role !== "Manager") return;
                              event.preventDefault();
                              const touch = event.touches[0];
                              if (touch)
                                trackTouchDrop(touch.clientX, touch.clientY);
                            }}
                            onTouchEnd={(event) => {
                              if (currentUser.role !== "Manager") return;
                              const touch = event.changedTouches[0];
                              if (touch)
                                finishOrderTouchDrag(
                                  order.id,
                                  touch.clientX,
                                  touch.clientY,
                                );
                            }}
                            onTouchCancel={() => {
                              setDraggedOrderId(null);
                              setDragOverEmployeeId(null);
                            }}
                            onDragStart={(event) => {
                              setDraggedOrderId(order.id);
                              setDraggedTaskTitle(null);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "application/x-fieldflow-order",
                                order.id,
                              );
                            }}
                            onDragEnd={() => {
                              setDraggedOrderId(null);
                              setDragOverEmployeeId(null);
                            }}
                            onClick={() => openOrderAssignment(order)}
                          >
                            <div className="bento-task-top">
                              <strong>{order.item}</strong>
                              <span className="work-status status-not-started">
                                Pending
                              </span>
                            </div>
                            <small>
                              {order.id} · {order.customer} · Due{" "}
                              {order.deadline
                                ? formatAttendanceDate(order.deadline)
                                : "Not set"}
                            </small>
                            <div className="pending-order-value">
                              <span>Order value</span>
                              <strong>{order.value}</strong>
                            </div>
                          </div>
                        ))
                      ) : !unassignedTasks.length ? (
                        <div className="task-drop-empty">
                          {draggedTaskTitle
                            ? "Drop here to move task back to pending"
                            : "No work pending assignment"}
                        </div>
                      ) : null}
                    </div>
                  </article>
                )}
                {taskBoardEmployees.map((employee) => {
                  const employeeTasks = taskData.filter(
                    (task) =>
                      (task.ownerId === employee.id ||
                        task.owner === employee.name ||
                        task.collaborators?.some(
                          (collaborator) =>
                            collaborator.employeeId === employee.id,
                        )) &&
                      `${task.title} ${task.status} ${task.due}`
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase()),
                  );
                  return (
                    <article
                      className={`task-employee-card ${dragOverEmployeeId === employee.id ? "drag-over" : ""}`}
                      data-task-drop-target={employee.id}
                      key={employee.id}
                      onDragOver={(event) => {
                        if (currentUser.role !== "Manager") return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverEmployeeId(employee.id);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node))
                          setDragOverEmployeeId(null);
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const orderId =
                          draggedOrderId ||
                          event.dataTransfer.getData(
                            "application/x-fieldflow-order",
                          );
                        if (orderId) {
                          assignOrderToEmployee(orderId, employee);
                          return;
                        }
                        const taskTitle =
                          draggedTaskTitle ||
                          event.dataTransfer.getData("text/plain");
                        if (taskTitle) reassignTask(taskTitle, employee);
                      }}
                    >
                      <div className="task-employee-heading">
                        <span className={`avatar avatar-${employee.color}`}>
                          {employee.initials}
                        </span>
                        <div>
                          <strong>{employee.name}</strong>
                          <small>{employee.role}</small>
                        </div>
                        <b>{employeeTasks.length}</b>
                      </div>
                      <div
                        className="task-card-list"
                        data-task-count={Math.min(employeeTasks.length, 4)}
                      >
                        {employeeTasks.length ? (
                          employeeTasks.map((task) => (
                            <div
                              className={`bento-task ${draggedTaskTitle === task.title ? "is-dragging" : ""}`}
                              draggable={currentUser.role === "Manager"}
                              key={task.title}
                              onTouchStart={() => {
                                if (currentUser.role !== "Manager") return;
                                setDraggedTaskTitle(task.title);
                                setDraggedOrderId(null);
                              }}
                              onTouchMove={(event) => {
                                if (currentUser.role !== "Manager") return;
                                event.preventDefault();
                                const touch = event.touches[0];
                                if (touch)
                                  trackTouchDrop(touch.clientX, touch.clientY);
                              }}
                              onTouchEnd={(event) => {
                                if (currentUser.role !== "Manager") return;
                                const touch = event.changedTouches[0];
                                if (touch)
                                  finishTaskTouchDrag(
                                    task.title,
                                    touch.clientX,
                                    touch.clientY,
                                  );
                              }}
                              onTouchCancel={() => {
                                setDraggedTaskTitle(null);
                                setDragOverEmployeeId(null);
                              }}
                              onDragStart={(event) => {
                                setDraggedTaskTitle(task.title);
                                setDraggedOrderId(null);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  task.title,
                                );
                              }}
                              onDragEnd={() => {
                                setDraggedTaskTitle(null);
                                setDraggedOrderId(null);
                                setDragOverEmployeeId(null);
                              }}
                              onClick={() => openTask(task)}
                            >
                              <div className="bento-task-top">
                                <strong>{task.title}</strong>
                                <span
                                  className={`work-status status-${task.status.toLowerCase().replace(" ", "-")}`}
                                >
                                  {task.status}
                                </span>
                              </div>
                              <small>Due {task.due}</small>
                              <small className="task-share-label">
                                {task.ownerId === employee.id ||
                                task.owner === employee.name
                                  ? `Lead${task.leadResponsibility ? ` · ${task.leadResponsibility}` : ""}`
                                  : `Collaborator · ${task.collaborators?.find((collaborator) => collaborator.employeeId === employee.id)?.responsibility ?? "Shared work"}`}
                              </small>
                              <div className="bento-task-progress">
                                <span className="progress-track">
                                  <span
                                    className={`progress-fill ${task.tone}-fill`}
                                    style={{ width: `${task.progress}%` }}
                                  />
                                </span>
                                <b>{task.progress}%</b>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="task-drop-empty">
                            {draggedTaskTitle || draggedOrderId
                              ? `Drop to assign to ${employee.name}`
                              : "No assigned tasks"}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            ) : (
              <section className="panel task-board-empty">
                <Users size={22} />
                <strong>No employees available</strong>
                <small>Add employees before assigning tasks.</small>
              </section>
            )}
          </div>
        ) : activeNav === "Orders" ? (
          <div className="page-wrap orders-crud-page">
            <section className="orders-crud-header">
              <div>
                <p className="eyebrow">Order management</p>
                <h1>Orders</h1>
                <p className="subcopy">
                  Create, review, update, and delete customer orders.
                </p>
              </div>
              <button
                className="button button-primary"
                onClick={() => openOrderForm()}
              >
                <Plus size={16} />
                Create order
              </button>
            </section>
            <section className="panel orders-crud-panel">
              <div className="orders-crud-summary">
                <div>
                  <strong>{visibleOrders.length} orders</strong>
                  <small>Matching the current search</small>
                </div>
              </div>
              <div className="orders-crud-table">
                <div className="orders-crud-row orders-crud-table-head">
                  <span>Order</span>
                  <span>Customer</span>
                  <span>Mobile</span>
                  <span>Item</span>
                  <span>Total</span>
                  <span>Advance</span>
                  <span>Balance</span>
                  <span>Deadline</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {visibleOrders.length ? (
                  visibleOrders.map((order) => (
                    <div className="orders-crud-row" key={order.id}>
                      <strong className="order-id-source">
                        {order.id}
                        {order.source === "Frames 41" && <small>Frames 41</small>}
                      </strong>
                      <span>{order.customer}</span>
                      <span>{order.customerMobile || "—"}</span>
                      <span>{order.item}</span>
                      <strong>{order.value}</strong>
                      <span className="advance-order-value">
                        <strong>
                          {order.paidPaise !== undefined
                            ? formatPaise(order.paidPaise)
                            : formatRupees(order.advanceAmount ?? 0)}
                        </strong>
                        <small>
                          {order.paymentMethod ?? order.advancePaymentMethod ?? "Not marked"}
                        </small>
                      </span>
                      <strong>
                        {order.balanceDuePaise !== undefined
                          ? formatPaise(order.balanceDuePaise)
                          : formatRupees(
                              Math.max(
                                0,
                                parseRupeesInput(order.value) -
                                  (order.advanceAmount ?? 0),
                              ),
                            )}
                      </strong>
                      <span>
                        {order.deadline
                          ? formatAttendanceDate(order.deadline)
                          : "—"}
                      </span>
                      <span className={`order-status ${order.color}`}>
                        {order.status}
                      </span>
                      <span className="row-actions">
                        <button
                          className="icon-button"
                          onClick={() => openOrderForm(order)}
                          aria-label={`${order.source === "Frames 41" ? "View" : "Edit"} ${order.id}`}
                        >
                          {order.source === "Frames 41" ? <Eye size={14} /> : <Pencil size={14} />}
                        </button>
                        {order.source !== "Frames 41" && (
                          <button
                            className="icon-button danger-button"
                            onClick={() => deleteOrder(order)}
                            aria-label={`Delete ${order.id}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="orders-crud-empty">
                    <ShoppingBag size={20} />
                    <strong>No orders found</strong>
                    <small>
                      Create your first order or change the search query.
                    </small>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
        <div className="page-wrap">
          {activeNav === "Overview" && (
          <section className="welcome-row">
            <div>
              <p className="eyebrow">{formattedCurrentDate}</p>
              <h1>
                {greeting},{" "}
                <span className="greeting-person">
                  {currentUser.name}{" "}
                  <span className="greeting-sparkle">✦</span>
                </span>
              </h1>
              <p className="subcopy">
                Here&apos;s what&apos;s moving across your workspace today.
              </p>
              <div className="employee-attendance-mobile">
                {attendancePanel}
              </div>
            </div>
            <div className="quick-actions">
              <label className="period-select">
                <CalendarDays size={16} />
                <select
                  aria-label="Dashboard report period"
                  value={collectionReportPeriod}
                  onChange={(event) =>
                    setCollectionReportPeriod(
                      event.target.value as CollectionReportPeriod,
                    )
                  }
                >
                  {(Object.keys(reportPeriodLabels) as CollectionReportPeriod[]).map(
                    (period) => (
                      <option key={period} value={period}>
                        {period} — {reportPeriodLabels[period]}
                      </option>
                    ),
                  )}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
              {currentUser.role !== "Employee" && (
                <button
                  className="button button-primary"
                  onClick={() => setShowPayment(true)}
                >
                  <Plus size={17} />
                  Record payment
                </button>
              )}
            </div>
          </section>
          )}
          {activeNav !== "Overview" && (
            <section className="panel context-panel">
              <div className="panel-heading">
                <div>
                  <h2>{activeNav} workspace</h2>
                  <p>{currentRole} access · live records for this area</p>
                </div>
                <div className="panel-actions">
                  {(activeNav === "People" || activeNav === "My team") &&
                    canManageEmployees && (
                      <button
                        className="button button-primary compact-button"
                        onClick={() => openEmployeeForm()}
                      >
                        <UserPlus size={15} />
                        Add employee
                      </button>
                    )}
                  {activeNav === "Tasks" && canManageEmployees && (
                    <button
                      className="button button-primary compact-button"
                      onClick={openNewTaskForm}
                    >
                      <Plus size={15} />
                      Add task
                    </button>
                  )}
                  {activeNav === "Staff" && (
                    <button
                      className="button button-primary compact-button"
                      onClick={() => openStaffForm()}
                    >
                      <UserPlus size={15} />
                      Add admin or manager
                    </button>
                  )}
                  {(activeNav === "Collections" || activeNav === "Reports") && (
                    <div
                      className="report-period-toggle"
                      aria-label="Collection report period"
                    >
                      {(
                        [
                          "Daily",
                          "Weekly",
                          "Monthly",
                          "Yearly",
                        ] as CollectionReportPeriod[]
                      ).map((period) => (
                        <button
                          className={
                            collectionReportPeriod === period
                              ? "selected"
                              : ""
                          }
                          key={period}
                          onClick={() => setCollectionReportPeriod(period)}
                        >
                          {period}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeNav === "Collections" &&
                    currentUser.role !== "Employee" && (
                      <button
                        className="button button-primary compact-button"
                        onClick={() => setShowPayment(true)}
                      >
                        <Plus size={15} />
                        Record payment
                      </button>
                    )}
                  <button
                    className="text-button"
                    onClick={() => navigateTo("Overview")}
                  >
                    Back to overview <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
              <div className="context-list">
                {contextItems.length ? (
                  contextItems.map((item) => (
                    <div
                      className="context-item-group"
                      key={`${item.label}-${item.meta}`}
                    >
                      <div
                        className={`context-item ${activeNav === "Tasks" && currentUser?.role === "Employee" ? "reviewable-task" : ""} ${activeNav === "Collections" ? "collection-summary-row" : ""}`}
                        role={activeNav === "Collections" ? "button" : undefined}
                        tabIndex={activeNav === "Collections" ? 0 : undefined}
                        aria-expanded={
                          activeNav === "Collections"
                            ? expandedCollection === item.label
                            : undefined
                        }
                        onClick={() => {
                          if (activeNav === "Collections") {
                            const detail = item.label as CollectionDetail;
                            setExpandedCollection((current) =>
                              current === detail ? null : detail,
                            );
                          }
                          if (
                            activeNav === "Tasks" &&
                            currentUser?.role === "Employee"
                          ) {
                            const task = taskData.find(
                              (taskItem) => taskItem.title === item.label,
                            );
                            if (task) openTask(task);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (
                            activeNav === "Collections" &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            const detail = item.label as CollectionDetail;
                            setExpandedCollection((current) =>
                              current === detail ? null : detail,
                            );
                          }
                        }}
                      >
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.meta}</small>
                        </div>
                        <span>
                          <strong>{item.value}</strong>
                          <small>{item.detail}</small>
                        </span>
                        {activeNav === "Collections" && (
                          <ChevronDown
                            className={
                              expandedCollection === item.label
                                ? "collection-chevron expanded"
                                : "collection-chevron"
                            }
                            size={15}
                          />
                        )}
                        {(activeNav === "People" || activeNav === "My team") &&
                          canManageEmployees && (
                          <span className="row-actions">
                            <button
                              className="icon-button"
                              onClick={() =>
                                openEmployeeForm(
                                  employeeData.find(
                                    (employee) => employee.name === item.label,
                                  ),
                                )
                              }
                              aria-label={`Edit ${item.label}`}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="icon-button danger-button"
                              onClick={() => deleteEmployee(item.label)}
                              aria-label={`Delete ${item.label}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </span>
                          )}
                        {activeNav === "Staff" && (
                          <span className="row-actions">
                          <button
                            className="icon-button"
                            onClick={() =>
                              openStaffForm(
                                staffData.find(
                                  (member) => member.name === item.label,
                                ),
                              )
                            }
                            aria-label={`Edit ${item.label}`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button danger-button"
                            onClick={() => {
                              const member = staffData.find(
                                (memberItem) => memberItem.name === item.label,
                              );
                              if (member) deleteStaff(member.id);
                            }}
                            aria-label={`Delete ${item.label}`}
                          >
                            <Trash2 size={14} />
                          </button>
                          </span>
                        )}
                      </div>
                      {activeNav === "Collections" &&
                        expandedCollection === item.label && (
                          <div className="collection-detail-panel">
                            <div className="collection-detail-head">
                              <span>Order</span>
                              <span>Customer</span>
                              <span>Details</span>
                              <span>Amount</span>
                            </div>
                            {collectionDetailRows.length ? (
                              collectionDetailRows.map((detail) => (
                                <div
                                  className="collection-detail-row"
                                  key={detail.id}
                                >
                                  <strong>{detail.orderId}</strong>
                                  <span>{detail.customer}</span>
                                  <small>{detail.meta}</small>
                                  <strong>{formatRupees(detail.amount)}</strong>
                                </div>
                              ))
                            ) : (
                              <p className="collection-detail-empty">
                                No details for this {collectionReportPeriod.toLowerCase()} report.
                              </p>
                            )}
                          </div>
                        )}
                    </div>
                  ))
                ) : (
                  <p className="empty-state">No records match your search.</p>
                )}
              </div>
              {activeNav === "Settings" &&
                currentUser.role !== "Employee" &&
                !showAccountCredentials && (
                  <div className="settings-account-trigger">
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={() => {
                        setAccountError("");
                        setAccountMessage("");
                        setShowAccountCredentials(true);
                      }}
                    >
                      <Pencil size={15} />
                      Update Credentials
                    </button>
                  </div>
                )}
              {activeNav === "Settings" &&
                currentUser.role !== "Employee" &&
                showAccountCredentials && (
                <form
                  className="settings-account-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAccountCredentials();
                  }}
                >
                  <div className="settings-account-heading">
                    <h3>Login credentials</h3>
                    <p>
                      Update your account name or password. Changes also appear
                      in Admins &amp; managers.
                    </p>
                  </div>
                  <div className="settings-account-grid">
                    <label className="input-label">
                      Login name
                      <input
                        className="form-input"
                        value={accountName}
                        onChange={(event) => {
                          setAccountName(event.target.value);
                          setAccountError("");
                          setAccountMessage("");
                        }}
                        autoComplete="name"
                        maxLength={80}
                      />
                    </label>
                    <label className="input-label">
                      Current password
                      <input
                        className="form-input"
                        type="password"
                        value={accountCurrentPassword}
                        onChange={(event) => {
                          setAccountCurrentPassword(event.target.value);
                          setAccountError("");
                          setAccountMessage("");
                        }}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="input-label">
                      New password
                      <input
                        className="form-input"
                        type="password"
                        value={accountNewPassword}
                        onChange={(event) => {
                          setAccountNewPassword(event.target.value);
                          setAccountError("");
                          setAccountMessage("");
                        }}
                        placeholder="Leave blank to keep current password"
                        autoComplete="new-password"
                        minLength={8}
                      />
                    </label>
                    <label className="input-label">
                      Confirm new password
                      <input
                        className="form-input"
                        type="password"
                        value={accountConfirmPassword}
                        onChange={(event) => {
                          setAccountConfirmPassword(event.target.value);
                          setAccountError("");
                          setAccountMessage("");
                        }}
                        placeholder="Repeat the new password"
                        autoComplete="new-password"
                        minLength={8}
                      />
                    </label>
                  </div>
                  {accountError && (
                    <p className="settings-account-message error" role="alert">
                      {accountError}
                    </p>
                  )}
                  {accountMessage && (
                    <p className="settings-account-message success" role="status">
                      {accountMessage}
                    </p>
                  )}
                  <button
                    className="button button-primary settings-account-submit"
                    type="submit"
                    disabled={accountSaving}
                  >
                    {accountSaving ? "Saving…" : "Save login credentials"}
                  </button>
                  <button
                    className="button button-secondary settings-account-cancel"
                    type="button"
                    disabled={accountSaving}
                    onClick={() => {
                      setShowAccountCredentials(false);
                      setAccountName(currentUser.name);
                      setAccountCurrentPassword("");
                      setAccountNewPassword("");
                      setAccountConfirmPassword("");
                      setAccountError("");
                      setAccountMessage("");
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </section>
          )}
          {activeNav === "Overview" && (
          <>
          <div className="overview-primary-grid">
            <section className="employee-attendance-top employee-attendance-desktop">
              {attendancePanel}
            </section>
          <section className="metric-grid" aria-label="Workspace summary">
            <div
              className="metric-card metric-highlight metric-card-link"
              role="button"
              tabIndex={0}
              aria-label="Open reports"
              onClick={() => openMetricWorkspace("Reports")}
              onKeyDown={(event) => handleMetricKeyDown(event, "Reports")}
            >
              <div className="metric-top">
                <span className="metric-icon sun">
                  <Clock3 size={17} />
                </span>
                <span className="trend">—</span>
              </div>
              <p>Hours logged · {reportPeriodLabels[collectionReportPeriod]}</p>
              <strong>{formatAttendance(displayedHoursSeconds)}</strong>
              <small>
                {displayedHoursSeconds > 0
                  ? `${collectionReportPeriod} logged time`
                  : "No hours logged yet"}
              </small>
            </div>
            <div
              className="metric-card metric-card-link"
              role="button"
              tabIndex={0}
              aria-label="Open tasks"
              onClick={() => openMetricWorkspace("Tasks")}
              onKeyDown={(event) => handleMetricKeyDown(event, "Tasks")}
            >
              <div className="metric-top">
                <span className="metric-icon green">
                  <Check size={17} />
                </span>
                <span className="trend positive">+12.2%</span>
              </div>
              <p>Tasks completed</p>
              <strong>
                {reportingCompletedTasks.length}
                <span> / {reportingTasks.length}</span>
              </strong>
              <small>Live completion rate</small>
              <div className="progress-track">
                <div
                  className="progress-fill green-fill"
                  style={{
                    width: reportingTasks.length
                      ? `${(reportingCompletedTasks.length / reportingTasks.length) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
            {currentUser.role === "Employee" && (
              <div className="metric-card employee-attendance-card">
                <div className="metric-top">
                  <span className="metric-icon sun">
                    <Clock3 size={17} />
                  </span>
                  <span className="trend">Today</span>
                </div>
                <p>Attendance</p>
                <strong>{formatAttendance(currentAttendanceSeconds)}</strong>
                <small>
                  {currentUserIsClockedIn
                    ? "Logged in today"
                    : "Not logged in yet"}
                </small>
                <button
                  className="button button-dark employee-clock-button"
                  onClick={toggleAttendance}
                >
                  {currentUserIsClockedIn ? "Log out" : "Log in"}
                </button>
              </div>
            )}
            <div
              className="metric-card metric-card-link"
              role="button"
              tabIndex={0}
              aria-label="Open orders"
              onClick={() => openMetricWorkspace("Orders")}
              onKeyDown={(event) => handleMetricKeyDown(event, "Orders")}
            >
              <div className="metric-top">
                <span className="metric-icon blue">
                  <ShoppingBag size={17} />
                </span>
                <span className="trend positive">+3 new</span>
              </div>
              <p>Active orders</p>
              <strong>{reportingOrders.length.toString().padStart(2, "0")}</strong>
              <small>{reportPeriodLabels[collectionReportPeriod]}</small>
              <div className="mini-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div
              className="metric-card metric-card-link"
              role="button"
              tabIndex={0}
              aria-label="Open collections"
              onClick={() => openMetricWorkspace("Collections")}
              onKeyDown={(event) => handleMetricKeyDown(event, "Collections")}
            >
              <div className="metric-top">
                <span className="metric-icon purple">
                  <Banknote size={17} />
                </span>
                <span className="trend negative">Live total</span>
              </div>
              <p>Collected · {reportPeriodLabels[collectionReportPeriod]}</p>
              <strong>
                {formatRupees(
                  reportCashCollectedAmount + reportUpiCollectedAmount,
                )}
              </strong>
              <small>₹0 still outstanding</small>
              <div className="progress-track">
                <div
                  className="progress-fill purple-fill"
                  style={{ width: "0%" }}
                />
              </div>
            </div>
          </section>
          </div>
          <section className="content-grid overview-team-grid">
            <div className="panel team-panel">
              <div className="panel-heading">
                <div>
                  <h2>Team pulse</h2>
                  <p>
                    {selectedEmployee
                      ? `${selectedEmployee} selected`
                      : "Live view of your people this week"}
                  </p>
                </div>
                {canViewTeamAttendance && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setTeamAttendanceError("");
                      setShowTeamAttendanceReport(true);
                    }}
                  >
                    View all <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
              <div className="team-summary">
                <div>
                  <strong>
                    {activeTeamMembers} of {employeeData.length}
                  </strong>
                  <small>currently active</small>
                </div>
                <div className="summary-divider" />
                <div>
                  <strong>{formatAttendance(teamTodayAverageSeconds)}</strong>
                  <small>average attendance</small>
                </div>
                <div className="team-avatars"></div>
              </div>
              <div className="employee-list">
                {visibleEmployees.map((employee) => (
                  <button
                    className={`employee-row ${selectedEmployee === employee.name ? "selected-row" : ""}`}
                    key={employee.name}
                    onClick={() =>
                      setSelectedEmployee(
                        selectedEmployee === employee.name
                          ? null
                          : employee.name,
                      )
                    }
                  >
                    <span className={`avatar avatar-${employee.color}`}>
                      {employee.initials}
                    </span>
                    <span className="employee-name">
                      <strong>{employee.name}</strong>
                      <small>{employee.role}</small>
                    </span>
                    <span className="employee-hours">
                      <strong>
                        {formatAttendance(
                          getDailyAttendanceSeconds(employee, todayKey),
                        )}
                      </strong>
                      <small>today</small>
                    </span>
                    <span className="employee-task">
                      <span className="task-line">
                        <span>Tasks</span>
                        <strong>{employee.task}</strong>
                      </span>
                      <span className="progress-track">
                        <span
                          className={`progress-fill ${employee.color}-fill`}
                          style={{ width: employee.task }}
                        />
                      </span>
                    </span>
                    <span
                      className={`status-dot ${employee.active ? "is-active" : "is-away"}`}
                    />
                  </button>
                ))}
              </div>
              {selectedEmployeeData && (
                <div className="attendance-history">
                  <div className="attendance-history-heading">
                    <div>
                      <strong>Attendance history</strong>
                      <small>{selectedEmployeeData.name}</small>
                    </div>
                    <span className="attendance-history-total">
                      <small>Today</small>
                      <strong>
                        {formatAttendance(
                          getDailyAttendanceSeconds(
                            selectedEmployeeData,
                            todayKey,
                          ),
                        )}
                      </strong>
                    </span>
                  </div>
                  {selectedAttendanceRecords.length ? (
                    selectedAttendanceRecords.map((record) => (
                      <div className="attendance-history-row" key={record.id}>
                        <span>
                          <small>Date</small>
                          <strong>{formatAttendanceDate(record.date)}</strong>
                        </span>
                        <span>
                          <small>Logged in</small>
                          <strong>{formatClockTime(record.clockIn)}</strong>
                        </span>
                        <span>
                          <small>Logged out</small>
                          <strong>{formatClockTime(record.clockOut)}</strong>
                        </span>
                        <span>
                          <small>Duration</small>
                          <strong>
                            {formatAttendance(
                              record.clockOut
                                ? record.durationSeconds
                                : Math.max(
                                    0,
                                    Math.floor(
                                      (attendanceNow - record.clockIn) / 1000,
                                    ),
                                  ),
                            )}
                          </strong>
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="attendance-history-empty">
                      No attendance recorded yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
          <section className="content-grid lower-grid">
            <div className="panel tasks-panel">
              <div className="panel-heading">
                <div>
                  <h2>Priority tasks</h2>
                  <p>What needs your team&apos;s attention</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigateTo("Tasks")}
                >
                  See tasks <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="task-table">
                <div className="table-head">
                  <span>Task</span>
                  <span>Assigned To</span>
                  <span>Due</span>
                  <span>Status</span>
                  <span>Progress</span>
                </div>
                {visibleTasks.map((task) => (
                  <div
                    className={`task-row ${currentUser?.role === "Employee" ? "reviewable-task" : ""}`}
                    key={task.title}
                    onClick={() => openTask(task)}
                  >
                    <div className="task-title">
                      <button
                        className={`task-check ${task.completed ? "checked" : ""}`}
                        onClick={() => toggleTask(task.title)}
                        aria-label={`Mark ${task.title} ${task.completed ? "open" : "complete"}`}
                      >
                        {task.completed && <Check size={11} />}
                      </button>
                      <strong>{task.title}</strong>
                    </div>
                    <span className="owner-cell">
                      <span className="mini-avatar">
                        {task.owner
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </span>
                      <span>
                        {task.owner}
                        {task.collaborators?.length
                          ? ` +${task.collaborators.length}`
                          : ""}
                      </span>
                    </span>
                    <span className="due-cell">{task.due}</span>
                    <span
                      className={`work-status status-${(task.status ?? (task.completed ? "Completed" : "Not started")).toLowerCase().replace(" ", "-")}`}
                    >
                      {task.status ??
                        (task.completed ? "Completed" : "Not started")}
                    </span>
                    <div
                      className="progress-cell"
                      aria-label={`${task.progress}% complete`}
                    >
                      <div className="progress-track">
                        <div
                          className={`progress-fill ${task.tone}-fill`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <strong>{task.progress}%</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel orders-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent orders</h2>
                  <p>Latest activity across sales</p>
                </div>
                <button className="icon-button">
                  <SlidersHorizontal size={17} />
                </button>
              </div>
              <div className="order-list">
                {visibleOrders.map((order) => (
                  <button
                    className="order-row"
                    key={order.id}
                    onClick={() => navigateTo("Orders")}
                  >
                    <span className={`order-icon ${order.color}`}>
                      <ShoppingBag size={16} />
                    </span>
                    <span className="order-info">
                      <strong>{order.customer}</strong>
                      <small>
                        {order.id} · {order.item}
                      </small>
                    </span>
                    <span className="order-value">
                      <strong>{order.value}</strong>
                      <span className={`order-status ${order.color}`}>
                        {order.status}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="orders-footer"
                onClick={() => navigateTo("Orders")}
              >
                View order pipeline <ArrowUpRight size={15} />
              </button>
            </div>
          </section>
          <div className="footer-note">
            <ShieldCheck size={15} />
            <span>All workspace data is synced and up to date</span>
            <span className="footer-time">Last synced just now</span>
          </div>
          </>
          )}
        </div>
        )}
      </main>
      {showAttendanceReport && (
        <div
          className="modal-backdrop attendance-report-backdrop"
          role="presentation"
          onClick={() => setShowAttendanceReport(false)}
        >
          <div
            className="payment-modal attendance-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Personal attendance</span>
                <h2 id="attendance-report-title">My attendance report</h2>
                <p>Clock times and hours worked for the selected period.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowAttendanceReport(false)}
                aria-label="Close attendance report"
              >
                <X size={18} />
              </button>
            </div>
            <div className="attendance-report-tabs" role="group" aria-label="Attendance report period">
              {(["Daily", "Weekly", "Monthly"] as AttendanceReportPeriod[]).map(
                (period) => (
                  <button
                    className={attendanceReportPeriod === period ? "selected" : ""}
                    key={period}
                    onClick={() => setAttendanceReportPeriod(period)}
                  >
                    {period}
                  </button>
                ),
              )}
            </div>
            <div className="attendance-report-summary">
              <div>
                <small>Total hours</small>
                <strong>{formatAttendance(attendanceReportTotalSeconds)}</strong>
              </div>
              <div>
                <small>Average hours / day</small>
                <strong>{formatAttendance(attendanceReportAverageSeconds)}</strong>
              </div>
              <div>
                <small>Average clock in</small>
                <strong>
                  {averageClockTime(
                    attendanceReportDays.map((day) => day.clockIn),
                  )}
                </strong>
              </div>
              <div>
                <small>Average clock out</small>
                <strong>
                  {averageClockTime(
                    attendanceReportDays.map((day) =>
                      day.hasOpenSession ? null : day.clockOut,
                    ),
                  )}
                </strong>
              </div>
            </div>
            <div className="attendance-report-table-wrap">
              <div className="attendance-report-table">
                <div className="attendance-report-row attendance-report-head">
                  <span>Date</span>
                  <span>Clock in</span>
                  <span>Clock out</span>
                  <span>Hours worked</span>
                </div>
                {attendanceReportDays.length ? (
                  attendanceReportDays.map((day) => (
                    <div className="attendance-report-row" key={day.date}>
                      <strong>{formatAttendanceDate(day.date)}</strong>
                      <span>{formatClockTime(day.clockIn)}</span>
                      <span>
                        {!day.hasOpenSession && day.clockOut
                          ? formatClockTime(day.clockOut)
                          : "Currently working"}
                      </span>
                      <strong>
                        {formatAttendance(day.durationSeconds)}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="attendance-report-empty">
                    No attendance was recorded for this {attendanceReportPeriod.toLowerCase()} period.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showTeamAttendanceReport && canViewTeamAttendance && (
        <div
          className="modal-backdrop attendance-report-backdrop"
          role="presentation"
          onClick={() => setShowTeamAttendanceReport(false)}
        >
          <div
            className="payment-modal attendance-report-modal team-attendance-report-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-attendance-report-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="team-attendance-report-title">Team attendance report</h2>
                <p>
                  Every employee&apos;s clock times and hours for {reportPeriodLabels[
                    teamAttendancePeriod
                  ].toLowerCase()}.
                </p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowTeamAttendanceReport(false)}
                aria-label="Close team attendance report"
              >
                <X size={18} />
              </button>
            </div>
            <div
              className="attendance-report-tabs"
              role="group"
              aria-label="Team attendance report period"
            >
              {(["Daily", "Weekly", "Monthly"] as AttendanceReportPeriod[]).map(
                (period) => (
                  <button
                    className={teamAttendancePeriod === period ? "selected" : ""}
                    key={period}
                    onClick={() => {
                      setTeamAttendanceError("");
                      setTeamAttendancePeriod(period);
                    }}
                  >
                    {period}
                  </button>
                ),
              )}
            </div>
            <div className="attendance-report-summary">
              <div>
                <small>Team members</small>
                <strong>{employeeData.length}</strong>
              </div>
              <div>
                <small>Active now</small>
                <strong>{activeTeamMembers}</strong>
              </div>
              <div>
                <small>Attendance recorded</small>
                <strong>
                  {teamAttendanceRecordedEmployees} / {employeeData.length}
                </strong>
              </div>
              <div>
                <small>Total hours</small>
                <strong>{formatAttendance(teamAttendanceTotalSeconds)}</strong>
              </div>
            </div>
            {teamAttendanceError && (
              <p className="team-attendance-error" role="alert">
                {teamAttendanceError}
              </p>
            )}
            <div className="attendance-report-table-wrap">
              <div
                className={`attendance-report-table team-attendance-table ${canMarkTeamAttendance ? "manager-controls" : ""}`}
              >
                <div className="attendance-report-row attendance-report-head">
                  <span>Employee</span>
                  <span>Date</span>
                  <span>Status</span>
                  <span>Clock in</span>
                  <span>Clock out</span>
                  <span>Hours worked</span>
                  {canMarkTeamAttendance && <span>Manual mark</span>}
                </div>
                {teamAttendanceRows.length ? (
                  teamAttendanceRows.map((row) => {
                    const displayedStatus =
                      row.clockIn !== null
                        ? "Present"
                        : row.manualStatus ?? "Not marked";
                    return (
                      <div
                        className="attendance-report-row"
                        key={`${row.employee.id}-${row.date ?? "empty"}`}
                      >
                        <span className="team-attendance-person">
                          <span className={`avatar avatar-${row.employee.color}`}>
                            {row.employee.initials}
                          </span>
                          <span>
                            <strong>{row.employee.name}</strong>
                            <small>{row.employee.role}</small>
                          </span>
                        </span>
                        <strong>
                          {row.date ? formatAttendanceDate(row.date) : "--"}
                        </strong>
                        <span
                          className={`attendance-status attendance-status-${displayedStatus.toLowerCase().replace(" ", "-")}`}
                        >
                          {displayedStatus}
                        </span>
                        <span>
                          {row.clockIn !== null
                            ? formatClockTime(row.clockIn)
                            : "--"}
                        </span>
                        <span>
                          {row.hasOpenSession
                            ? "Currently working"
                            : row.clockOut !== null
                              ? formatClockTime(row.clockOut)
                              : "--"}
                        </span>
                        <strong>{formatAttendance(row.durationSeconds)}</strong>
                        {canMarkTeamAttendance && row.date && row.clockIn !== null && (
                          <span className="attendance-auto-mark">Auto present</span>
                        )}
                        {canMarkTeamAttendance &&
                          row.date &&
                          row.clockIn === null && (
                          <span className="manual-attendance-actions">
                            <button
                              className={
                                displayedStatus === "Absent" ? "selected absent" : ""
                              }
                              type="button"
                              aria-pressed={displayedStatus === "Absent"}
                              aria-label={
                                displayedStatus === "Absent"
                                  ? `Undo absent mark for ${row.employee.name}`
                                  : `Mark ${row.employee.name} absent`
                              }
                              disabled={
                                markingAttendanceFor === row.employee.id ||
                                row.clockIn !== null
                              }
                              title={
                                row.clockIn !== null
                                  ? "Clocked attendance cannot be marked absent"
                                  : undefined
                              }
                              onClick={() =>
                                void markManualAttendance(
                                  row.employee.id,
                                  row.date!,
                                  displayedStatus === "Absent" ? null : "Absent",
                                )
                              }
                            >
                              Absent
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="attendance-report-empty">
                    No employees are available for this report.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {selectedTask && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSelectedTask(null)}
        >
          <div
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-task-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Employee workspace</span>
                <h2 id="review-task-title">Review task</h2>
                <p>Update the current status of your assigned work.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setSelectedTask(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="task-review-summary">
              <strong>{selectedTask.title}</strong>
              <small>Due {selectedTask.due}</small>
              <span className="task-assignment-role">
                {selectedTaskIsLead ? "Task lead" : "Collaborator"}
              </span>
              {selectedTaskResponsibility && (
                <p>
                  <small>Your responsibility</small>
                  {selectedTaskResponsibility}
                </p>
              )}
            </div>
            <span className="input-label">Task status</span>
            <div className="status-options">
              {(
                [
                  "Not started",
                  "In progress",
                  "Blocked",
                  "Completed",
                ] as Task["status"][]
              ).map((status) => (
                <button
                  key={status}
                  className={taskStatus === status ? "selected" : ""}
                  onClick={() => setTaskStatus(status)}
                  disabled={status === "Completed" && !selectedTaskIsLead}
                  title={
                    status === "Completed" && !selectedTaskIsLead
                      ? "Only the task lead can complete shared work"
                      : undefined
                  }
                >
                  {status}
                </button>
              ))}
            </div>
            <button
              className="button button-primary modal-submit"
              onClick={updateTaskStatus}
            >
              <Check size={16} />
              Save status
            </button>
          </div>
        </div>
      )}
      {showTaskForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeTaskForm}
        >
          <div
            className="payment-modal task-assignment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Manager access</span>
                <h2 id="task-title">
                  {editingTaskAssignment
                    ? "Edit task assignment"
                    : assigningOrder
                      ? "Assign pending order"
                      : "Assign a task"}
                </h2>
                <p>
                  Choose the lead and split responsibilities across collaborators.
                </p>
              </div>
              <button
                className="icon-button"
                onClick={closeTaskForm}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <label className="input-label">
              Task title
              <input
                className="form-input"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="e.g. Prepare client quotation"
                autoFocus
                readOnly={Boolean(assigningOrder)}
              />
            </label>
            <label className="input-label">
              Assign to
              <select
                className="form-input"
                value={taskOwner}
                onChange={(event) => {
                  const nextOwner = event.target.value;
                  setTaskOwner(nextOwner);
                  setTaskCollaborators((current) => {
                    if (!(nextOwner in current)) return current;
                    const next = { ...current };
                    delete next[nextOwner];
                    return next;
                  });
                  setTaskFormError("");
                }}
              >
                <option value="">Choose an employee</option>
                {employeeData.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
            {taskOwner && (
              <label className="input-label">
                Lead responsibility
                <input
                  className="form-input"
                  value={taskLeadResponsibility}
                  onChange={(event) => {
                    setTaskLeadResponsibility(event.target.value);
                    setTaskFormError("");
                  }}
                  placeholder="e.g. Coordinate the work and final quality check"
                />
              </label>
            )}
            {taskOwner &&
              employeeData.some((employee) => employee.id !== taskOwner) && (
              <fieldset className="task-collaborator-fieldset">
                <legend>Collaborators (optional)</legend>
                <p>Select everyone sharing this task and describe their part.</p>
                <div className="task-collaborator-list">
                  {employeeData
                    .filter((employee) => employee.id !== taskOwner)
                    .map((employee) => {
                      const selected = employee.id in taskCollaborators;
                      return (
                        <div className="task-collaborator-row" key={employee.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(event) => {
                                setTaskCollaborators((current) => {
                                  if (event.target.checked) {
                                    return { ...current, [employee.id]: "" };
                                  }
                                  const next = { ...current };
                                  delete next[employee.id];
                                  return next;
                                });
                                setTaskFormError("");
                              }}
                            />
                            <span className={`avatar avatar-${employee.color}`}>
                              {employee.initials}
                            </span>
                            <span>
                              <strong>{employee.name}</strong>
                              <small>{employee.role}</small>
                            </span>
                          </label>
                          {selected && (
                            <input
                              className="form-input"
                              value={taskCollaborators[employee.id]}
                              onChange={(event) => {
                                setTaskCollaborators((current) => ({
                                  ...current,
                                  [employee.id]: event.target.value,
                                }));
                                setTaskFormError("");
                              }}
                              placeholder={`What will ${employee.name.split(" ")[0]} handle?`}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>
              </fieldset>
            )}
            <label className="input-label">
              Due date
              <input
                className="form-input"
                type="date"
                value={taskDue}
                onChange={(event) => setTaskDue(event.target.value)}
              />
            </label>
            {taskFormError && <p className="task-form-error">{taskFormError}</p>}
            <button
              className="button button-primary modal-submit"
              onClick={saveTask}
            >
              {editingTaskAssignment || assigningOrder ? (
                <Check size={16} />
              ) : (
                <Plus size={16} />
              )}
              {editingTaskAssignment || assigningOrder
                ? "Save assignment"
                : "Assign task"}
            </button>
          </div>
        </div>
      )}
      {showStaffForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowStaffForm(false)}
        >
          <div
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Workspace access</span>
                <h2 id="staff-title">
                  {editingStaff ? "Edit staff member" : "Add admin or manager"}
                </h2>
                <p>Enter the name and access level for this staff member.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowStaffForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <label className="input-label">
              Full name
              <input
                className="form-input"
                value={staffName}
                onChange={(event) => setStaffName(event.target.value)}
                placeholder="Enter full name"
                autoFocus
              />
            </label>
            <label className="input-label">
              Login password
              <input
                className="form-input"
                type="password"
                value={staffPassword}
                onChange={(event) => setStaffPassword(event.target.value)}
                placeholder={
                  editingStaff
                    ? "Leave unchanged or enter new password"
                    : "Create login password"
                }
              />
            </label>
            <span className="input-label">Access level</span>
            <div className="method-toggle">
              <button
                className={staffRole === "Admin" ? "selected" : ""}
                onClick={() => setStaffRole("Admin")}
              >
                <ShieldCheck size={16} />
                Admin
              </button>
              <button
                className={staffRole === "Manager" ? "selected" : ""}
                onClick={() => setStaffRole("Manager")}
              >
                <Users size={16} />
                Manager
              </button>
            </div>
            <button
              className="button button-primary modal-submit"
              onClick={saveStaff}
            >
              {editingStaff ? (
                <>
                  <Check size={16} />
                  Save changes
                </>
              ) : (
                <>
                  <UserPlus size={16} />
                  Create staff member
                </>
              )}
            </button>
          </div>
        </div>
      )}
      {showEmployeeForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowEmployeeForm(false)}
        >
          <div
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="employee-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">{currentRole} access</span>
                <h2 id="employee-title">
                  {editingEmployee ? "Edit employee" : "Add employee"}
                </h2>
                <p>Manage employee access and workspace details.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowEmployeeForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <label className="input-label">
              Full name
              <input
                className="form-input"
                value={employeeName}
                onChange={(event) => setEmployeeName(event.target.value)}
                placeholder="e.g. Ananya Rao"
                autoFocus
              />
            </label>
            <label className="input-label">
              Role or department
              <input
                className="form-input"
                value={employeeRole}
                onChange={(event) => setEmployeeRole(event.target.value)}
                placeholder="e.g. Production lead"
              />
            </label>
            <label className="input-label">
              Login password
              <input
                className="form-input"
                type="password"
                value={employeePassword}
                onChange={(event) => setEmployeePassword(event.target.value)}
                placeholder={
                  editingEmployee
                    ? "Leave unchanged or enter new password"
                    : "Create employee password"
                }
              />
            </label>
            <button
              className="button button-primary modal-submit"
              onClick={saveEmployee}
            >
              {editingEmployee ? (
                <>
                  <Check size={16} />
                  Save changes
                </>
              ) : (
                <>
                  <UserPlus size={16} />
                  Create employee
                </>
              )}
            </button>
          </div>
        </div>
      )}
      {showOrderForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowOrderForm(false)}
        >
          <div
            className={`payment-modal ${editingOrder?.source === "Frames 41" ? "commerce-order-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Order management</span>
                <h2 id="order-form-title">
                  {editingOrder?.source === "Frames 41"
                    ? "Review website order"
                    : editingOrder
                      ? "Edit order"
                      : "Create order"}
                </h2>
                <p>Enter the customer and order details.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowOrderForm(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            {editingOrder?.source === "Frames 41" && (
              <section className="commerce-order-details">
                <div className="commerce-order-banner">
                  <span>Frames 41 order</span>
                  <strong>{editingOrder.externalOrderNumber}</strong>
                  <small>
                    Commerce details are read-only. Assignment, deadline, and Desk status remain editable.
                  </small>
                </div>
                <div className="commerce-detail-grid">
                  <div>
                    <small>Email</small>
                    <strong>{editingOrder.customerEmail || "—"}</strong>
                  </div>
                  <div>
                    <small>Payment</small>
                    <strong>{editingOrder.paymentMethod || "Razorpay"}</strong>
                    <span>{editingOrder.paymentReference}</span>
                  </div>
                  <div>
                    <small>Paid</small>
                    <strong>{formatPaise(editingOrder.paidPaise)}</strong>
                  </div>
                  <div>
                    <small>Balance due</small>
                    <strong>{formatPaise(editingOrder.balanceDuePaise)}</strong>
                  </div>
                  <div>
                    <small>Subtotal</small>
                    <strong>{formatPaise(editingOrder.subtotalPaise)}</strong>
                  </div>
                  <div>
                    <small>Discount</small>
                    <strong>{formatPaise(editingOrder.discountPaise)}</strong>
                  </div>
                  <div>
                    <small>Shipping</small>
                    <strong>{formatPaise(editingOrder.shippingPaise)}</strong>
                  </div>
                  <div>
                    <small>Order total</small>
                    <strong>{formatPaise(editingOrder.totalPaise)}</strong>
                  </div>
                  <div>
                    <small>Promised delivery</small>
                    <strong>
                      {editingOrder.promisedDeliveryAt
                        ? formatAttendanceDate(editingOrder.promisedDeliveryAt.slice(0, 10))
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <small>Payment type</small>
                    <strong>{editingOrder.partialPayment ? "50% advance" : "Paid in full"}</strong>
                  </div>
                </div>
                {editingOrder.shippingAddress && (
                  <div className="commerce-address">
                    <small>Delivery address</small>
                    <strong>
                      {editingOrder.shippingAddress.line1}
                      {editingOrder.shippingAddress.line2
                        ? `, ${editingOrder.shippingAddress.line2}`
                        : ""}
                    </strong>
                    <span>
                      {editingOrder.shippingAddress.city}, {editingOrder.shippingAddress.state} – {editingOrder.shippingAddress.pincode}
                    </span>
                  </div>
                )}
                <div className="commerce-line-items">
                  <small>Items and customization</small>
                  {editingOrder.lineItems?.map((lineItem) => (
                    <article key={lineItem.id}>
                      {lineItem.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={lineItem.imageUrl} alt="" />
                      )}
                      <div>
                        <strong>{lineItem.name}</strong>
                        <span>{lineItem.sku} · Qty {lineItem.quantity}</span>
                        {lineItem.variant && <span>Variant: {lineItem.variant}</span>}
                        {lineItem.customization && Object.keys(lineItem.customization).length > 0 && (
                          <>
                            <div className="commerce-customization-assets">
                              {customizationImageUrls(lineItem.customization).map((url) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={url} src={url} alt={`${lineItem.name} customization`} />
                              ))}
                            </div>
                            <pre>{JSON.stringify(lineItem.customization, null, 2)}</pre>
                          </>
                        )}
                      </div>
                      <b>{formatPaise(lineItem.totalPricePaise)}</b>
                    </article>
                  ))}
                </div>
                <div className={`integration-sync integration-sync-${integrationSync?.status?.toLowerCase() ?? "idle"}`}>
                  <span>Frames status sync</span>
                  <strong>
                    {integrationSyncLoading
                      ? "Checking…"
                      : integrationSync?.status ?? "No status update queued"}
                  </strong>
                  {integrationSync?.lastError && <small>{integrationSync.lastError}</small>}
                  {integrationSync?.status === "FAILED" && (
                    <button className="button" onClick={retryFramesSync} disabled={integrationSyncLoading}>
                      Retry sync
                    </button>
                  )}
                  {integrationSyncError && <small>{integrationSyncError}</small>}
                </div>
              </section>
            )}
            <label className="input-label">
              Customer
              <input
                className="form-input"
                disabled={editingOrder?.source === "Frames 41"}
                value={orderCustomer}
                onChange={(event) => {
                  setOrderCustomer(event.target.value);
                  setOrderError("");
                }}
                placeholder="Customer name"
              />
            </label>
            <label className="input-label">
              Customer mobile number
              <input
                className="form-input"
                type="tel"
                disabled={editingOrder?.source === "Frames 41"}
                value={orderCustomerMobile}
                onChange={(event) => {
                  setOrderCustomerMobile(event.target.value);
                  setOrderError("");
                }}
                placeholder="Mobile number"
                inputMode="tel"
              />
            </label>
            <label className="input-label">
              Item
              <input
                className="form-input"
                disabled={editingOrder?.source === "Frames 41"}
                value={orderItem}
                onChange={(event) => {
                  setOrderItem(event.target.value);
                  setOrderError("");
                }}
                placeholder="Product or service"
              />
            </label>
            <label className="input-label">
              Deadline (optional)
              <input
                className="form-input"
                type="date"
                min={todayKey}
                value={orderDeadline}
                onChange={(event) => {
                  const value = event.target.value;
                  setOrderDeadline(
                    value ? resolveOrderDeadline(value, Date.now()) : "",
                  );
                  setOrderError("");
                }}
              />
              <small className="form-help">
                Defaults to two days after the order date. Sunday deadlines move
                to Monday.
              </small>
            </label>
            <label className="input-label">
              Order value
              <input
                className="form-input"
                disabled={editingOrder?.source === "Frames 41"}
                value={orderValue}
                onChange={(event) => {
                  setOrderValue(event.target.value);
                  setOrderError("");
                }}
                placeholder="Amount in Rupees"
                inputMode="decimal"
              />
            </label>
            <label className="input-label">
              Advance payment
              <input
                className="form-input"
                disabled={editingOrder?.source === "Frames 41"}
                value={orderAdvanceAmount}
                onChange={(event) => {
                  setOrderAdvanceAmount(event.target.value);
                  setOrderError("");
                }}
                placeholder="Amount in Rupees"
                inputMode="decimal"
              />
            </label>
            <span className="input-label">Advance payment method</span>
            <div
              className="method-toggle advance-method-toggle"
              aria-label="Advance payment method"
            >
              {(["UPI", "Cash"] as const).map((method) => (
                <button
                  type="button"
                  disabled={editingOrder?.source === "Frames 41"}
                  key={method}
                  className={orderAdvanceMethod === method ? "selected" : ""}
                  onClick={() => setOrderAdvanceMethod(method)}
                >
                  {method === "UPI" ? (
                    <CreditCard size={16} />
                  ) : (
                    <Banknote size={16} />
                  )}
                  {method}
                </button>
              ))}
            </div>
            <div className="advance-payment-summary">
              <span>Remaining balance</span>
              <strong>
                {formatRupees(
                  Math.max(
                    0,
                    parseRupeesInput(orderValue) -
                      parseRupeesInput(orderAdvanceAmount),
                  ),
                )}
              </strong>
            </div>
            <span className="input-label">Status</span>
            <div className="method-toggle order-status-toggle">
              {(["Pending", "In progress", "Completed", "Cancelled"] as const).map(
                (status) => (
                  <button
                    key={status}
                    className={orderStatus === status ? "selected" : ""}
                    onClick={() => setOrderStatus(status)}
                  >
                    {status}
                  </button>
                ),
              )}
            </div>
            {orderError && <p className="payment-error">{orderError}</p>}
            <button
              className="button button-primary modal-submit"
              onClick={saveOrder}
            >
              {editingOrder ? <Pencil size={15} /> : <Plus size={16} />}
              {editingOrder ? "Update order" : "Create order"}
            </button>
          </div>
        </div>
      )}
      {showPayment && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowPayment(false)}
        >
          <div
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-kicker">Collections</span>
                <h2 id="payment-title">Record payment</h2>
                <p>Record cash, UPI, or a split payment.</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowPayment(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <label className="input-label">
              Order (optional)
              <select
                className="form-input"
                value={paymentOrderId}
                onChange={(event) => {
                  const orderId = event.target.value;
                  const order = orderData.find((entry) => entry.id === orderId);
                  setPaymentOrderId(orderId);
                  if (order) setPaymentCustomer(order.customer);
                  setPaymentError("");
                }}
              >
                <option value="">Manual payment</option>
                {orderData.map((order) => (
                  <option value={order.id} key={order.id}>
                    {order.id} · {order.customer}
                  </option>
                ))}
              </select>
            </label>
            <label className="input-label">
              Customer
              <input
                className="form-input"
                value={paymentCustomer}
                onChange={(event) => {
                  setPaymentCustomer(event.target.value);
                  if (
                    orderData.find((order) => order.id === paymentOrderId)
                      ?.customer !== event.target.value
                  ) {
                    setPaymentOrderId("");
                  }
                  setPaymentError("");
                }}
                placeholder="Customer name"
              />
            </label>
            <span className="input-label">Payment method</span>
            <div className="method-toggle">
              {(["UPI", "Cash", "Split"] as PaymentMethod[]).map((method) => (
                <button
                  key={method}
                  className={paymentMethod === method ? "selected" : ""}
                  onClick={() => {
                    setPaymentMethod(method);
                    setPaymentError("");
                  }}
                >
                  {method === "UPI" ? (
                    <CreditCard size={16} />
                  ) : method === "Cash" ? (
                    <Banknote size={16} />
                  ) : (
                    <WalletCards size={16} />
                  )}
                  {method}
                </button>
              ))}
            </div>
            {paymentMethod === "Split" ? (
              <>
                <div className="split-payment-grid">
                  <label className="input-label">
                    Cash amount
                    <input
                      className="form-input"
                      value={cashPaymentAmount}
                      onChange={(event) => {
                        setCashPaymentAmount(event.target.value);
                        setPaymentError("");
                      }}
                      placeholder="Amount in Rupees"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="input-label">
                    UPI amount
                    <input
                      className="form-input"
                      value={upiPaymentAmount}
                      onChange={(event) => {
                        setUpiPaymentAmount(event.target.value);
                        setPaymentError("");
                      }}
                      placeholder="Amount in Rupees"
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <div className="split-payment-total">
                  <span>Total payment</span>
                  <strong>{formatRupees(splitPaymentTotal)}</strong>
                </div>
              </>
            ) : (
              <label className="input-label">
                Amount
                <input
                  className="form-input"
                  value={paymentAmount}
                  onChange={(event) => {
                    setPaymentAmount(event.target.value);
                    setPaymentError("");
                  }}
                  placeholder="Amount in rupees"
                  inputMode="decimal"
                />
              </label>
            )}
            {paymentMethod !== "Cash" && (
              <label className="input-label">
                UPI reference
                <input
                  className="form-input"
                  value={upiReference}
                  onChange={(event) => setUpiReference(event.target.value)}
                  placeholder="UPI reference number"
                />
              </label>
            )}
            {paymentError && <p className="payment-error">{paymentError}</p>}
            <button
              className="button button-primary modal-submit"
              onClick={savePayment}
            >
              {paymentSaved ? (
                <>
                  <Check size={16} />
                  Payment saved
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Save collection
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
