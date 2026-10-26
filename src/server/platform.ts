import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import nodemailer from "nodemailer";
import { readAuthConfig } from "./auth/config";

const shared = globalThis as typeof globalThis & { saasDatabase?: PrismaClient };
export function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  return shared.saasDatabase ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log: [] });
}

export async function deliverMail(message: { to: string; subject: string; text: string }) {
  const config = readAuthConfig();
  const mailer = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    requireTLS: !["localhost", "127.0.0.1", "mailpit"].includes(config.smtp.host),
    ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.password } } : {}),
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
  });
  await mailer.sendMail({ ...message, to: { name: "", address: message.to }, from: config.smtp.from });
}
