# Phase 10 E-Commerce listing category

Migration `ecommerce.0003_listing_category` adds an optional `category` text field to each tenant-owned listing. It is blank by default for existing listings and limited to 80 characters. Categories are not separate records in this phase; admins manage the value when creating each listing. The public storefront derives filter options from currently visible, active listings for that tenant. No category CRUD endpoints or cross-module WMS schema changes are introduced.
