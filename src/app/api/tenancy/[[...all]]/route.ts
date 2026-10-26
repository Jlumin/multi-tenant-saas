import { handleTenancy } from "../../../../server/tenancy/api";

export const runtime = "nodejs";
export const GET = handleTenancy;
export const POST = handleTenancy;
export const PATCH = handleTenancy;
