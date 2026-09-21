-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "desk";

-- CreateEnum
CREATE TYPE "desk"."UserRole" AS ENUM ('ADMIN', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "desk"."TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "desk"."OrderSource" AS ENUM ('DESK', 'FRAMES_41');

-- CreateEnum
CREATE TYPE "desk"."SyncStatus" AS ENUM ('NONE', 'PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "desk"."PaymentSource" AS ENUM ('MANUAL', 'ADVANCE', 'COMMERCE');

-- CreateEnum
CREATE TYPE "desk"."AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');

-- CreateTable
CREATE TABLE "desk"."workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."users" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "login_name" VARCHAR(80) NOT NULL,
    "normalized_name" VARCHAR(80) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "desk"."UserRole" NOT NULL,
    "job_title" VARCHAR(120),
    "initials" VARCHAR(4),
    "color" VARCHAR(32),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."sessions" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."attendance_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "clock_in" TIMESTAMPTZ(3) NOT NULL,
    "clock_out" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."manual_attendance" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "status" "desk"."AttendanceStatus" NOT NULL,
    "marked_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "manual_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID,
    "lead_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "lead_responsibility" VARCHAR(300),
    "status" "desk"."TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "tone" VARCHAR(40),
    "deadline" DATE,
    "completed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."task_assignees" (
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "responsibility" VARCHAR(300) NOT NULL,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateTable
CREATE TABLE "desk"."customers" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."orders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "assigned_user_id" UUID,
    "display_id" VARCHAR(80) NOT NULL,
    "source" "desk"."OrderSource" NOT NULL DEFAULT 'DESK',
    "external_order_id" VARCHAR(160),
    "external_order_number" VARCHAR(160),
    "import_payload_hash" CHAR(64),
    "item_summary" VARCHAR(500) NOT NULL,
    "status" VARCHAR(80) NOT NULL,
    "color" VARCHAR(40) NOT NULL,
    "commerce_status" VARCHAR(80),
    "promised_delivery_at" TIMESTAMPTZ(3),
    "deadline" DATE,
    "placed_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "subtotal_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_paise" BIGINT NOT NULL DEFAULT 0,
    "shipping_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL DEFAULT 0,
    "paid_paise" BIGINT NOT NULL DEFAULT 0,
    "balance_due_paise" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "sync_status" "desk"."SyncStatus" NOT NULL DEFAULT 'NONE',
    "sync_event_id" UUID,
    "sync_version" INTEGER,
    "sync_attempted_at" TIMESTAMPTZ(3),
    "sync_error" VARCHAR(500),
    "sync_payload" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."order_addresses" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(16) NOT NULL,

    CONSTRAINT "order_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "external_item_id" VARCHAR(160),
    "product_id" VARCHAR(160),
    "sku" VARCHAR(160),
    "name" VARCHAR(300) NOT NULL,
    "variant" VARCHAR(160),
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" BIGINT NOT NULL,
    "total_price_paise" BIGINT NOT NULL,
    "customization" JSONB,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."order_item_assets" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "order_item_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."payments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "order_id" UUID,
    "display_id" VARCHAR(160) NOT NULL,
    "customer_name" VARCHAR(160) NOT NULL,
    "source" "desk"."PaymentSource" NOT NULL,
    "method" VARCHAR(40) NOT NULL,
    "provider_reference" VARCHAR(200),
    "cash_paise" BIGINT NOT NULL DEFAULT 0,
    "upi_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_id" UUID,
    "old_status" VARCHAR(80),
    "new_status" VARCHAR(80) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."integration_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "client_key" VARCHAR(80) NOT NULL,
    "api_identity" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "base_url" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_healthy_at" TIMESTAMPTZ(3),
    "last_health_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."integration_inbox" (
    "event_id" UUID NOT NULL,
    "client_id" VARCHAR(80) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "aggregate_id" VARCHAR(160) NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "integration_inbox_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "desk"."audit_logs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(160) NOT NULL,
    "request_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desk"."migration_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_revision" BIGINT NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "counts" JSONB NOT NULL,
    "result" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "desk"."workspaces"("slug");

-- CreateIndex
CREATE INDEX "users_workspace_id_role_archived_at_idx" ON "desk"."users"("workspace_id", "role", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_workspace_id_normalized_name_key" ON "desk"."users"("workspace_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "desk"."sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "desk"."sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "attendance_sessions_user_id_work_date_idx" ON "desk"."attendance_sessions"("user_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "manual_attendance_user_id_work_date_key" ON "desk"."manual_attendance"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_status_archived_at_idx" ON "desk"."tasks"("workspace_id", "status", "archived_at");

-- CreateIndex
CREATE INDEX "tasks_order_id_idx" ON "desk"."tasks"("order_id");

-- CreateIndex
CREATE INDEX "task_assignees_user_id_idx" ON "desk"."task_assignees"("user_id");

-- CreateIndex
CREATE INDEX "customers_workspace_id_name_idx" ON "desk"."customers"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "orders_workspace_id_status_archived_at_idx" ON "desk"."orders"("workspace_id", "status", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_display_id_key" ON "desk"."orders"("workspace_id", "display_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_external_order_id_key" ON "desk"."orders"("workspace_id", "external_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_addresses_order_id_key" ON "desk"."order_addresses"("order_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "desk"."order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_item_assets_item_id_idx" ON "desk"."order_item_assets"("item_id");

-- CreateIndex
CREATE INDEX "payments_workspace_id_received_at_idx" ON "desk"."payments"("workspace_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_workspace_id_display_id_key" ON "desk"."payments"("workspace_id", "display_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "desk"."order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspace_id_client_key_key" ON "desk"."integration_connections"("workspace_id", "client_key");

-- CreateIndex
CREATE INDEX "integration_inbox_client_id_aggregate_id_idx" ON "desk"."integration_inbox"("client_id", "aggregate_id");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "desk"."audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "migration_runs_source_revision_source_checksum_key" ON "desk"."migration_runs"("source_revision", "source_checksum");

-- AddForeignKey
ALTER TABLE "desk"."users" ADD CONSTRAINT "users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "desk"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."attendance_sessions" ADD CONSTRAINT "attendance_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "desk"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."manual_attendance" ADD CONSTRAINT "manual_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "desk"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."manual_attendance" ADD CONSTRAINT "manual_attendance_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "desk"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."tasks" ADD CONSTRAINT "tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "desk"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "desk"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "desk"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."task_assignees" ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "desk"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."customers" ADD CONSTRAINT "customers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."orders" ADD CONSTRAINT "orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "desk"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."orders" ADD CONSTRAINT "orders_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "desk"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."order_addresses" ADD CONSTRAINT "order_addresses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "desk"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "desk"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."order_item_assets" ADD CONSTRAINT "order_item_assets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "desk"."order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."payments" ADD CONSTRAINT "payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "desk"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "desk"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."order_status_history" ADD CONSTRAINT "order_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "desk"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "desk"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "desk"."migration_runs" ADD CONSTRAINT "migration_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
