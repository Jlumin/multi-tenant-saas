import { readAuthConfig } from "./config";
import { createAuth } from "./create-auth";
import { deliverMail, getDatabase } from "../platform";

function initialize() {
  const config = readAuthConfig();
  return createAuth(config, getDatabase(), deliverMail);
}

const globalAuth = globalThis as typeof globalThis & { saasAuth?: ReturnType<typeof initialize> };
export function getAuth() {
  return globalAuth.saasAuth ??= initialize();
}
