import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";

describe("GET /api/health handler", () => {
  it("returns a real HTTP Response with fixed JSON and status 200", async () => {
    const response = GET();
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("does not cache the liveness response", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
