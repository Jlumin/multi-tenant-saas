export interface AuthConfig {
  baseURL: string;
  secret: string;
  databaseURL: string;
  google?: { clientId: string; clientSecret: string };
  smtp: { host: string; port: number; secure: boolean; from: string; user?: string; password?: string };
}

export function readAuthConfig(env: Readonly<Record<string, string | undefined>> = process.env): AuthConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing auth configuration: ${name}`);
    return value;
  };
  const baseURL = required("BETTER_AUTH_URL");
  const url = new URL(baseURL);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid auth origin");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("HTTPS required outside loopback");
  const secret = required("BETTER_AUTH_SECRET");
  if (secret.length < 32 || /example|change-me|placeholder/i.test(secret)) throw new Error("Strong auth secret required");
  const port = Number(required("SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP port");
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) throw new Error("Incomplete Google configuration");
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new Error("Incomplete SMTP authentication");
  const from = required("SMTP_FROM");
  if (/[\r\n]/.test(from) || !from.includes("@")) throw new Error("Invalid sender address");
  return {
    baseURL: url.origin, secret, databaseURL: required("DATABASE_URL"),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
    smtp: { host: required("SMTP_HOST"), port, secure: env.SMTP_SECURE === "1", from, user: env.SMTP_USER, password: env.SMTP_PASSWORD },
  };
}
