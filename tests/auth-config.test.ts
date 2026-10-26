import { describe, expect, it } from "vitest";
import { readAuthConfig } from "../src/server/auth/config";

const env = {
  BETTER_AUTH_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "Test-only-not-used-outside-unit-suite-47219383",
  DATABASE_URL: "postgresql://test:test@localhost/test", SMTP_HOST: "localhost", SMTP_PORT: "1025", SMTP_FROM: "noreply@example.test",
};

describe("authentication configuration", () => {
  it("allows loopback development without inventing Google credentials", () => {
    expect(readAuthConfig(env).google).toBeUndefined();
  });
  it("requires configuration and rejects weak or placeholder secrets", () => {
    expect(() => readAuthConfig({})).toThrow();
    expect(() => readAuthConfig({ ...env, BETTER_AUTH_SECRET: "short" })).toThrow();
    expect(() => readAuthConfig({ ...env, BETTER_AUTH_SECRET: "change-me-placeholder-12345678901234567890" })).toThrow();
  });
  it("rejects insecure remote URLs and origins containing paths or credentials", () => {
    for (const url of ["http://example.com", "https://example.com/path", "https://user:pass@example.com", "https://example.com?foo=bar"]) {
      expect(() => readAuthConfig({ ...env, BETTER_AUTH_URL: url })).toThrow();
    }
  });
  it("rejects incomplete Google and SMTP credentials", () => {
    expect(() => readAuthConfig({ ...env, GOOGLE_CLIENT_ID: "test-client" })).toThrow();
    expect(() => readAuthConfig({ ...env, SMTP_USER: "test" })).toThrow();
  });
  it("only enables Google when both configured", () => {
    expect(readAuthConfig({ ...env, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-only" }).google?.clientId).toBe("test-client");
  });
});
