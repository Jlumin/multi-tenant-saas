# Phase 9 storefront content schema

Migration `platform_core.0005_storefront_content` adds two nullable-free, blank-allowed text fields to the existing tenant one-to-one branding record:

- `storefront_heading`: at most 120 characters.
- `storefront_description`: at most 240 characters.

Both default to the empty string for existing tenants. Public responses substitute generic display copy for blank values. No customer, order, inventory or image table is added.
