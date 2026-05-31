import { PrismaClient } from "./generated/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const databaseUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === "production" && !databaseUrl) {
  throw new Error("CRITICAL: DATABASE_URL is not set. Production environment requires a valid database connection.");
}

const adapter = new PrismaLibSql({
  url: databaseUrl ?? "file:./dev.db",
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
