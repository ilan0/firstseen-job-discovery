import { z } from "zod";

// PostgreSQL/PostgREST commonly serializes UTC as +00:00 while JavaScript
// Date uses Z. Both are equivalent ISO 8601 event timestamps.
export const eventDateTime = z.string().datetime({ offset: true });
