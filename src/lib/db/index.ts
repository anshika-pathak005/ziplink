// Creates and exports the environment-independent database connection.
// Communicates with any PostgreSQL instance (Local Windows PostgreSQL or Cloud Neon/Supabase)
// using DATABASE_URL via Drizzle ORM.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env["DATABASE_URL"];

export const db = databaseUrl
  ? drizzle(postgres(databaseUrl), { schema })
  : null;

export { schema };
