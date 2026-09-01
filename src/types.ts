export interface Env {
  DB: D1Database;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  HASH_SECRET: string;
  SHORT_DOMAIN: string;
  RAW_RETENTION_DAYS: string;
}
