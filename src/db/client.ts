import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env/server";
import * as schema from "./schema";

const globalDatabase = globalThis as unknown as {
  firstSeenSql?: ReturnType<typeof postgres>;
};

const sql =
  globalDatabase.firstSeenSql ??
  postgres(serverEnv().DATABASE_URL, {
    max: process.env.NODE_ENV === "production" ? 10 : 3,
    connect_timeout: 10,
    idle_timeout: 20,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalDatabase.firstSeenSql = sql;

export const db = drizzle(sql, { schema, casing: "snake_case" });
export { sql as databaseConnection };
