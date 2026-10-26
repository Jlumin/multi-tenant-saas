import { afterEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn());
vi.mock("../src/server/auth/runtime", () => ({ getAuth: () => ({ handler }) }));
import { handleAuth } from "../src/server/auth/handler";

afterEach(() => { vi.restoreAllMocks(); handler.mockReset(); });

describe("public auth route boundary", () => {
  it("does not expose account linking, access tokens or arbitrary library endpoints", async () => {
    for (const path of ["link-social", "get-access-token", "delete-user", "update-user"]) {
      expect((await handleAuth(new Request(`http://localhost/api/auth/${path}`, { method: "POST" }))).status).toBe(404);
    }
    expect(handler).not.toHaveBeenCalled();
  });
  it("preserves verification/reset redirects without logging tokens", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    handler.mockResolvedValue(Response.redirect("http://localhost/reset-password?token=secret-fixture-token", 302));
    const response = await handleAuth(new Request("http://localhost/api/auth/reset-password/secret-fixture-token?callbackURL=/reset-password"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("token=secret-fixture-token");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(log.mock.calls.flat().join(" ")).not.toContain("secret-fixture-token");
  });
  it("returns a sanitized 503 if configuration or the auth service fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    handler.mockRejectedValue(new Error("private database URL"));
    const response = await handleAuth(new Request("http://localhost/api/auth/get-session"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database URL");
  });
});
