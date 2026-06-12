import { PrismaClient } from "./generated/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const databaseUrl = process.env.DATABASE_URL;

// During build, use fallback; at runtime, DATABASE_URL is required
const dbUrl =
  databaseUrl ??
  (process.env.NODE_ENV === "production"
    ? "file:./prisma/database.db"
    : "file:./dev.db");

const adapter = new PrismaLibSql({
  url: dbUrl,
});

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
