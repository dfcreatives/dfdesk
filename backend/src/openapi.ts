const operations = {
  "/api/v1/health": { get: { operationId: "health", security: [] } },
  "/api/v1/ready": { get: { operationId: "ready", security: [] } },
  "/api/v1/auth/bootstrap": {
    post: { operationId: "bootstrap", security: [] },
  },
  "/api/v1/auth/login": { post: { operationId: "login", security: [] } },
  "/api/v1/auth/logout": { post: { operationId: "logout" } },
  "/api/v1/auth/session": { get: { operationId: "session", security: [] } },
  "/api/v1/auth/account": { patch: { operationId: "updateAccount" } },
  "/api/v1/users": {
    get: { operationId: "listUsers" },
    post: { operationId: "createUser" },
  },
  "/api/v1/users/{id}": {
    patch: { operationId: "updateUser" },
    delete: { operationId: "archiveUser" },
  },
  "/api/v1/attendance": { get: { operationId: "listAttendance" } },
  "/api/v1/attendance/clock-in": { post: { operationId: "clockIn" } },
  "/api/v1/attendance/clock-out": { post: { operationId: "clockOut" } },
  "/api/v1/attendance/manual/{userId}/{date}": {
    patch: { operationId: "markAttendance" },
  },
  "/api/v1/tasks": {
    get: { operationId: "listTasks" },
    post: { operationId: "createTask" },
  },
  "/api/v1/tasks/{id}": {
    get: { operationId: "getTask" },
    patch: { operationId: "updateTask" },
    delete: { operationId: "archiveTask" },
  },
  "/api/v1/tasks/{id}/assignees": { put: { operationId: "setTaskAssignees" } },
  "/api/v1/orders": {
    get: { operationId: "listOrders" },
    post: { operationId: "createOrder" },
  },
  "/api/v1/custom-orders": {
    post: { operationId: "createCustomOrder" },
  },
  "/api/v1/orders/{id}": {
    get: { operationId: "getOrder" },
    patch: { operationId: "updateOrder" },
  },
  "/api/v1/orders/{id}/status": { patch: { operationId: "updateOrderStatus" } },
  "/api/v1/orders/{id}/assignment": { patch: { operationId: "assignOrder" } },
  "/api/v1/order-fields": {
    get: { operationId: "listOrderFields" },
    post: { operationId: "createOrderField" },
  },
  "/api/v1/order-fields/{id}": {
    patch: { operationId: "updateOrderField" },
    delete: { operationId: "archiveOrderField" },
  },
  "/api/v1/payments": {
    get: { operationId: "listPayments" },
    post: { operationId: "createPayment" },
  },
  "/api/v1/reports/summary": { get: { operationId: "reportSummary" } },
  "/api/v1/integrations/connections": {
    get: { operationId: "integrationConnections" },
  },
  "/api/v1/integrations/orders/{id}/sync": {
    get: { operationId: "integrationSync" },
  },
  "/api/v1/integrations/orders/{id}/retry": {
    post: { operationId: "retryIntegrationSync" },
  },
  "/api/v1/integrations/orders/import": {
    post: { operationId: "importCommerceOrder", security: [{ hmac: [] }] },
  },
  "/api/v1/integrations/orders/custom": {
    post: { operationId: "submitCustomOrder", security: [{ hmac: [] }] },
  },
} as const;

export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "Desk API", version: "1.0.0" },
  paths: operations,
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "desk_session" },
      hmac: { type: "apiKey", in: "header", name: "x-df-signature" },
    },
  },
  security: [{ sessionCookie: [] }],
} as const;
