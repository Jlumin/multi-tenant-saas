import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import nodemailer from "nodemailer";
import { readAuthConfig } from "./config";
import { createAuth } from "./create-auth";

function initialize() {
  const config = readAuthConfig();
  const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseURL }), log: [] });
  const mailer = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    requireTLS: !["localhost", "127.0.0.1", "mailpit"].includes(config.smtp.host),
    ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.password } } : {}),
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
  });
  return createAuth(config, database, async message => { await mailer.sendMail({ ...message, from: config.smtp.from }); });
}

const globalAuth = globalThis as typeof globalThis & { saasAuth?: ReturnType<typeof initialize> };
export function getAuth() {
  return globalAuth.saasAuth ??= initialize();
}
