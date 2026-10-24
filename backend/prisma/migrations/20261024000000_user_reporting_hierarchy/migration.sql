ALTER TABLE "desk"."users"
ADD COLUMN "reports_to_id" UUID;

ALTER TABLE "desk"."users"
ADD CONSTRAINT "users_reports_to_id_fkey"
FOREIGN KEY ("reports_to_id") REFERENCES "desk"."users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_workspace_id_reports_to_id_role_idx"
ON "desk"."users"("workspace_id", "reports_to_id", "role");
