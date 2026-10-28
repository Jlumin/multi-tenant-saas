CREATE TABLE "hr_employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "staff_number" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_employees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hr_employees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_employees_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_employees_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_employees_staff_number_check" CHECK ("staff_number" IS NULL OR length(btrim("staff_number")) BETWEEN 1 AND 40),
    CONSTRAINT "hr_employees_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "hr_employees_tenant_id_id_key" ON "hr_employees"("tenant_id", "id");
CREATE UNIQUE INDEX "hr_employees_tenant_id_user_id_key" ON "hr_employees"("tenant_id", "user_id");
CREATE UNIQUE INDEX "hr_employees_tenant_id_staff_number_key" ON "hr_employees"("tenant_id", "staff_number");
CREATE INDEX "hr_employees_tenant_id_is_active_created_at_idx" ON "hr_employees"("tenant_id", "is_active", "created_at");

CREATE TABLE "hr_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "clock_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_out_at" TIMESTAMPTZ(3),
    "clock_in_key" VARCHAR(128) NOT NULL,
    "clock_out_key" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_attendance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hr_attendance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_attendance_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "hr_employees"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_attendance_tenant_id_id_key" UNIQUE ("tenant_id", "id"),
    CONSTRAINT "hr_attendance_clock_order_check" CHECK ("clock_out_at" IS NULL OR "clock_out_at" >= "clock_in_at"),
    CONSTRAINT "hr_attendance_clock_in_key_check" CHECK (length("clock_in_key") BETWEEN 8 AND 128),
    CONSTRAINT "hr_attendance_clock_out_key_check" CHECK ("clock_out_key" IS NULL OR length("clock_out_key") BETWEEN 8 AND 128),
    CONSTRAINT "hr_attendance_checkout_pair_check" CHECK (("clock_out_at" IS NULL) = ("clock_out_key" IS NULL))
);
CREATE UNIQUE INDEX "hr_attendance_tenant_id_clock_in_key_key" ON "hr_attendance"("tenant_id", "clock_in_key");
CREATE UNIQUE INDEX "hr_attendance_tenant_id_clock_out_key_key" ON "hr_attendance"("tenant_id", "clock_out_key");
CREATE UNIQUE INDEX "hr_attendance_one_open_per_employee" ON "hr_attendance"("tenant_id", "user_id") WHERE "clock_out_at" IS NULL;
CREATE INDEX "hr_attendance_tenant_id_user_id_clock_in_at_idx" ON "hr_attendance"("tenant_id", "user_id", "clock_in_at");

CREATE TABLE "hr_attendance_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "attendance_id" UUID NOT NULL,
    "field" VARCHAR(20) NOT NULL,
    "previous_at" TIMESTAMPTZ(3),
    "corrected_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_attendance_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hr_attendance_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_attendance_adjustments_tenant_id_attendance_id_fkey" FOREIGN KEY ("tenant_id", "attendance_id") REFERENCES "hr_attendance"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_attendance_adjustments_tenant_id_created_by_id_fkey" FOREIGN KEY ("tenant_id", "created_by_id") REFERENCES "memberships"("tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_attendance_adjustments_field_check" CHECK ("field" IN ('clock_in', 'clock_out')),
    CONSTRAINT "hr_attendance_adjustments_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500)
);
CREATE INDEX "hr_attendance_adjustments_tenant_id_attendance_id_field_cre_idx" ON "hr_attendance_adjustments"("tenant_id", "attendance_id", "field", "created_at");

CREATE TABLE "hr_tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Taipei',
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_tenant_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "hr_tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "hr_tenant_settings_timezone_check" CHECK (length("time_zone") BETWEEN 1 AND 64)
);

CREATE FUNCTION hr_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'HR attendance is append-only; use clock-out or a correction record' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW."id", NEW."tenant_id", NEW."user_id", NEW."clock_in_at", NEW."clock_in_key", NEW."created_at")
       IS DISTINCT FROM (OLD."id", OLD."tenant_id", OLD."user_id", OLD."clock_in_at", OLD."clock_in_key", OLD."created_at")
       OR OLD."clock_out_at" IS NOT NULL OR NEW."clock_out_at" IS NULL OR NEW."clock_out_key" IS NULL THEN
        RAISE EXCEPTION 'HR attendance may only be clocked out once' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "hr_attendance_guard_trigger" BEFORE UPDATE OR DELETE ON "hr_attendance" FOR EACH ROW EXECUTE FUNCTION hr_attendance_guard();

CREATE FUNCTION hr_attendance_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'HR attendance adjustments are append-only' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "hr_attendance_adjustments_guard_trigger" BEFORE UPDATE OR DELETE ON "hr_attendance_adjustments" FOR EACH ROW EXECUTE FUNCTION hr_attendance_adjustment_guard();
