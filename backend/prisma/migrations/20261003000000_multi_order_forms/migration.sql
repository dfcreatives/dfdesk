-- A workspace starts with a default Frames 41 integration. Existing form
-- fields and orders stay attached to that default form during the migration.
INSERT INTO "desk"."integration_connections" (
  "id", "workspace_id", "client_key", "api_identity", "display_name",
  "enabled", "created_at", "updated_at"
)
SELECT gen_random_uuid(), workspace."id", 'frames41', 'frames41', 'Frames 41',
       true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "desk"."workspaces" AS workspace
ON CONFLICT ("workspace_id", "client_key") DO NOTHING;

CREATE TABLE "desk"."custom_order_forms" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "integration_connection_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "archived_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "custom_order_forms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_order_forms_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "desk"."workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "custom_order_forms_integration_connection_id_fkey"
    FOREIGN KEY ("integration_connection_id") REFERENCES "desk"."integration_connections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "desk"."custom_order_forms" (
  "id", "workspace_id", "integration_connection_id", "name", "is_default",
  "enabled", "created_at", "updated_at"
)
SELECT gen_random_uuid(), workspace."id", connection."id", 'Default form',
       true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "desk"."workspaces" AS workspace
JOIN "desk"."integration_connections" AS connection
  ON connection."workspace_id" = workspace."id"
 AND connection."client_key" = 'frames41';

CREATE INDEX "custom_order_forms_workspace_id_archived_at_name_idx"
  ON "desk"."custom_order_forms"("workspace_id", "archived_at", "name");
CREATE INDEX "custom_order_forms_integration_connection_id_enabled_archived_at_idx"
  ON "desk"."custom_order_forms"("integration_connection_id", "enabled", "archived_at");
CREATE UNIQUE INDEX "custom_order_forms_one_default_per_workspace_key"
  ON "desk"."custom_order_forms"("workspace_id") WHERE "is_default" = true;

ALTER TABLE "desk"."order_field_definitions" ADD COLUMN "form_id" UUID;
UPDATE "desk"."order_field_definitions" AS field
SET "form_id" = form."id"
FROM "desk"."custom_order_forms" AS form
WHERE form."workspace_id" = field."workspace_id" AND form."is_default" = true;
ALTER TABLE "desk"."order_field_definitions" ALTER COLUMN "form_id" SET NOT NULL;
ALTER TABLE "desk"."order_field_definitions"
  ADD CONSTRAINT "order_field_definitions_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "desk"."custom_order_forms"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "desk"."order_field_definitions_workspace_id_key_key";
CREATE UNIQUE INDEX "order_field_definitions_form_id_key_key"
  ON "desk"."order_field_definitions"("form_id", "key");

ALTER TABLE "desk"."orders"
  ADD COLUMN "custom_form_id" UUID,
  ADD COLUMN "integration_connection_id" UUID;
UPDATE "desk"."orders" AS order_row
SET "custom_form_id" = form."id"
FROM "desk"."custom_order_forms" AS form
WHERE form."workspace_id" = order_row."workspace_id" AND form."is_default" = true;
UPDATE "desk"."orders" AS order_row
SET "integration_connection_id" = connection."id"
FROM "desk"."integration_connections" AS connection
WHERE order_row."workspace_id" = connection."workspace_id"
  AND connection."client_key" = 'frames41'
  AND order_row."external_order_id" IS NOT NULL;
ALTER TABLE "desk"."orders"
  ADD CONSTRAINT "orders_custom_form_id_fkey"
    FOREIGN KEY ("custom_form_id") REFERENCES "desk"."custom_order_forms"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "orders_integration_connection_id_fkey"
    FOREIGN KEY ("integration_connection_id") REFERENCES "desk"."integration_connections"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
DROP INDEX "desk"."orders_workspace_id_external_order_id_key";
CREATE UNIQUE INDEX "orders_integration_connection_id_external_order_id_key"
  ON "desk"."orders"("integration_connection_id", "external_order_id");
