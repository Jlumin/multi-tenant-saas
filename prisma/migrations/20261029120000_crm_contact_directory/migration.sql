CREATE TABLE "crm_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "crm_contacts_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "crm_contacts_display_name_check" CHECK (length(btrim("display_name")) BETWEEN 1 AND 120),
    CONSTRAINT "crm_contacts_email_normalized_check" CHECK ("email" IS NULL OR ("email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 254)),
    CONSTRAINT "crm_contacts_phone_normalized_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{6,31}$'),
    CONSTRAINT "crm_contacts_notes_check" CHECK (length("notes") <= 2000),
    CONSTRAINT "crm_contacts_archive_state_check" CHECK (("is_active" AND "archived_at" IS NULL) OR (NOT "is_active" AND "archived_at" IS NOT NULL)),
    CONSTRAINT "crm_contacts_version_check" CHECK ("version" > 0),
    CONSTRAINT "crm_contacts_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
    CONSTRAINT "crm_contacts_tenant_id_email_key" UNIQUE ("tenant_id", "email"),
    CONSTRAINT "crm_contacts_tenant_id_phone_key" UNIQUE ("tenant_id", "phone")
);
CREATE INDEX "crm_contacts_tenant_id_is_active_created_at_idx" ON "crm_contacts"("tenant_id", "is_active", "created_at");
CREATE INDEX "crm_contacts_tenant_id_display_name_idx" ON "crm_contacts"("tenant_id", "display_name");
