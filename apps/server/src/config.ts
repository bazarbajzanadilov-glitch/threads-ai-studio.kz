import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
export const HOST = process.env.HOST ?? "0.0.0.0";
const rawBaseUrl = process.env.BASE_URL?.trim();
export const BASE_URL = (rawBaseUrl && /^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : "https://thread.ai-studio.kz").replace(/\/$/, "");

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "bazarbajzanadilov@gmail.com";
export const SECOND_ADMIN_EMAIL = process.env.SECOND_ADMIN_EMAIL ?? "reli.sheets1@gmail.com";
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "admin_master_secret_2026";

export const ALLOWED_ADMIN_EMAILS = [
  ADMIN_EMAIL.trim().toLowerCase(),
  SECOND_ADMIN_EMAIL.trim().toLowerCase()
].filter(Boolean);

export const THREADS_APP_ID = process.env.THREADS_APP_ID ?? "";
export const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET ?? "";
export const THREADS_GRAPH_BASE_URL = process.env.THREADS_GRAPH_BASE_URL ?? "https://graph.threads.net";
export const THREADS_API_VERSION = process.env.THREADS_API_VERSION ?? "v24.0";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? path.join(DATA_DIR, "uploads"));
export const DB_PATH = path.resolve(process.env.DB_PATH ?? path.join(DATA_DIR, "threads.db"));
