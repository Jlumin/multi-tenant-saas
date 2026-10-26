CREATE TABLE "projects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000) NOT NULL DEFAULT '',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_name_nonempty" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "projects_version_positive" CHECK ("version" > 0),
  CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "projects_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "projects_tenant_id_id_key" ON "projects"("tenant_id", "id");
CREATE INDEX "projects_tenant_id_deleted_at_created_at_id_idx" ON "projects"("tenant_id", "deleted_at", "created_at", "id");

CREATE FUNCTION protect_project_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'project identity and deleted records are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_identity_guard BEFORE UPDATE ON "projects"
FOR EACH ROW EXECUTE FUNCTION protect_project_identity();
