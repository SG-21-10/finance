import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Import everything exported from schema.ts
import * as schema from './schema';

if (!process.env.DRIZZLE_DATABASE_URL) {
  throw new Error('DRIZZLE_DATABASE_URL is not set');
}

// for query purposes
const queryClient = postgres(process.env.DRIZZLE_DATABASE_URL);

// Pass the imported schema object to the drizzle function
export const db = drizzle(queryClient, { schema });
