CREATE TYPE "desk"."OrderFieldType" AS ENUM (
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CURRENCY',
  'DATE',
  'PHONE',
  'EMAIL',
  'SELECT',
  'MULTI_SELECT',
  'CHECKBOX'
);

CREATE TABLE "desk"."order_field_definitions" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "type" "desk"."OrderFieldType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "placeholder" VARCHAR(160),
  "help_text" VARCHAR(300),
  "options" JSONB,
  "position" INTEGER NOT NULL DEFAULT 0,
  "show_in_list" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "order_field_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "desk"."order_custom_field_values" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "field_id" UUID NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "order_custom_field_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_field_definitions_workspace_id_key_key"
  ON "desk"."order_field_definitions"("workspace_id", "key");
CREATE INDEX "order_field_definitions_workspace_id_archived_at_position_idx"
  ON "desk"."order_field_definitions"("workspace_id", "archived_at", "position");
CREATE UNIQUE INDEX "order_custom_field_values_order_id_field_id_key"
  ON "desk"."order_custom_field_values"("order_id", "field_id");
CREATE INDEX "order_custom_field_values_field_id_idx"
  ON "desk"."order_custom_field_values"("field_id");

ALTER TABLE "desk"."order_field_definitions"
  ADD CONSTRAINT "order_field_definitions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "desk"."order_custom_field_values"
  ADD CONSTRAINT "order_custom_field_values_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "desk"."orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "desk"."order_custom_field_values"
  ADD CONSTRAINT "order_custom_field_values_field_id_fkey"
  FOREIGN KEY ("field_id") REFERENCES "desk"."order_field_definitions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
