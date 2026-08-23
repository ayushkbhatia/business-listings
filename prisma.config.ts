// Next.js loads .env.local automatically; the Prisma CLI does not. Load it here
// so `prisma migrate` and `next dev` read the same connection strings.
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // .mts, not .ts: package.json has no "type": "module", so tsx treats a bare
    // .ts as CJS and a top-level await in the seed throws TransformError.
    seed: "tsx prisma/seed.mts",
  },
  datasource: {
    // CLI only. Migrations and introspection need the session pooler (5432);
    // the transaction pooler the app runs on cannot execute DDL. The runtime
    // connection string is passed to PrismaClient in lib/db/client.ts.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
