import { betterAuth } from "better-auth/minimal";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthConfig } from "./config";

export type DeliverMail = (message: { to: string; subject: string; text: string }) => Promise<void>;

export function createAuth(config: AuthConfig, database: PrismaClient, deliver: DeliverMail) {
  return betterAuth({
    appName: "Multi-tenant SaaS",
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    database: prismaAdapter(database, { provider: "postgresql", transaction: true }),
    logger: { disabled: true },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: config.baseURL.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    rateLimit: { enabled: true, window: 60, max: 20, storage: "memory" },
    session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 60, cookieCache: { enabled: false }, storeSessionInDatabase: true },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    account: { encryptOAuthTokens: true, storeStateStrategy: "database", storeAccountCookie: false, accountLinking: { enabled: false, disableImplicitLinking: true } },
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      requireEmailVerification: true, autoSignIn: false, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => deliver({ to: user.email, subject: "重設密碼", text: `請使用此連結重設密碼：${url}` }),
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => deliver({ to: user.email, subject: "驗證電子郵件", text: `請使用此連結驗證電子郵件：${url}` }),
    },
    socialProviders: config.google ? { google: { ...config.google, requireEmailVerification: true } } : {},
  });
}
