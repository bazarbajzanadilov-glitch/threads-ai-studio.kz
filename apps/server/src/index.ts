import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { HOST, PORT, UPLOADS_DIR } from "./config.js";
import { initDb, logEvent } from "./db/index.js";
import { authRouter, requireAuth } from "./routes/auth.js";
import { accountsRouter, oauthCallbackHandler } from "./routes/accounts.js";
import { postsRouter } from "./routes/posts.js";
import { uploadRouter } from "./routes/upload.js";
import { scheduleRouter } from "./routes/schedule.js";
import { logsRouter } from "./routes/logs.js";
import { systemRouter } from "./routes/system.js";
import { startPublisherDaemon, stopPublisherDaemon } from "./scheduler/publisher.js";
import { startTokenRefresherDaemon, stopTokenRefresherDaemon } from "./scheduler/token-refresher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(customDbPath?: string) {
  initDb(customDbPath);

  const app = express();

  // Basic middleware
  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());

  // Static uploads directory with open CORS for Meta Threads image crawlers
  app.use("/uploads", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=86400");
    next();
  }, express.static(UPLOADS_DIR));

  // Public / auth endpoints
  app.use("/api/auth", authRouter);

  // Accounts OAuth callback is public so Meta can redirect to it
  app.get("/api/accounts/oauth/callback", oauthCallbackHandler);

  // Protected API routes
  app.use("/api/accounts", requireAuth, accountsRouter);
  app.use("/api/posts", requireAuth, postsRouter);
  app.use("/api/upload", requireAuth, uploadRouter);
  app.use("/api/schedule", requireAuth, scheduleRouter);
  app.use("/api/logs", requireAuth, logsRouter);
  app.use("/api/system", requireAuth, systemRouter);

  // Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // Static serving for the built admin UI
  const adminDistPath = path.resolve(__dirname, "../../admin/dist");
  if (fs.existsSync(adminDistPath)) {
    app.use(express.static(adminDistPath));
    app.get("*", (req: Request, res: Response, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) {
        return next();
      }
      res.sendFile(path.join(adminDistPath, "index.html"));
    });
  }

  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: any) => {
    console.error("Unhandled error:", err);
    res.status(err.status || 500).json({
      error: {
        message: err.message || "Internal server error"
      }
    });
  });

  return app;
}

export function startServer() {
  const app = createApp();

  const server = app.listen(PORT, HOST, () => {
    console.log(`=======================================================`);
    console.log(`  Threads Auto-Publisher Server running`);
    console.log(`  Listening at: http://${HOST}:${PORT}`);
    console.log(`  Uploads directory: ${UPLOADS_DIR}`);
    console.log(`=======================================================`);

    logEvent({
      level: "info",
      category: "system",
      message: `Server started successfully on port ${PORT}`
    });

    // Start background background scheduler daemons
    startPublisherDaemon();
    startTokenRefresherDaemon();
  });

  const handleShutdown = (signal: string) => {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    stopPublisherDaemon();
    stopTokenRefresherDaemon();
    server.close(() => {
      console.log("HTTP server closed.");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  return server;
}

// Auto-start if invoked directly as main module
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  startServer();
}
