import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // CLI only. Migrations and introspection need a session connection (port 5432);
    // the transaction pooler the app runs on cannot execute DDL. The runtime
    // connection string is passed to PrismaClient in lib/db/client.ts.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
