import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

// Prisma 7 connects through a driver adapter. The app talks to Supavisor in
// transaction mode (port 6543); `prisma migrate` uses DIRECT_URL instead, via
// prisma.config.ts, because a transaction pooler cannot run DDL.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing environment variable: DATABASE_URL");

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// One client per process. Next.js dev reloads the module graph on every edit, so
// without the global we would open a new pool on each hot reload and exhaust the
// Supavisor connection limit.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
