import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  ALLOWED_ADMIN_EMAILS,
  ADMIN_EMAIL,
  SESSION_SECRET
} from "../config.js";

export const authRouter = Router();

// Create HMAC session token with 7-day expiration
export function createSessionToken(email: string): string {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ email, expiresAt })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string): { email: string } | null {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;

    const expectedSig = crypto
      .createHmac("sha256", SESSION_SECRET)
      .update(payload)
      .digest("base64url");

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      expiresAt?: number;
    };

    if (!data.email || !data.expiresAt || data.expiresAt <= Date.now()) {
      return null;
    }

    if (!ALLOWED_ADMIN_EMAILS.includes(data.email.trim().toLowerCase())) {
      return null;
    }

    return { email: data.email };
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: { email: string };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Check authorization header or cookie
  const authHeader = req.headers.authorization;
  const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const tokenFromCookie = req.cookies?.admin_session as string | undefined;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) {
    res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Authentication required" } });
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: { code: "INVALID_SESSION", message: "Invalid or expired session" } });
    return;
  }

  (req as AuthenticatedRequest).user = session;
  next();
}

authRouter.post("/login", (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: { message: "Email and password are required" } });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const isEmailAllowed = ALLOWED_ADMIN_EMAILS.includes(normalizedEmail);
  const isPasswordValid = String(password) === SESSION_SECRET;

  if (!isEmailAllowed || !isPasswordValid) {
    res.status(401).json({ error: { message: "Invalid credentials" } });
    return;
  }

  const token = createSessionToken(normalizedEmail);

  // Set HTTP-only cookie
  res.cookie("admin_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    token,
    user: {
      email: normalizedEmail,
      role: "admin"
    }
  });
});

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  res.json({
    user: {
      email: user?.email ?? "",
      role: "admin"
    }
  });
});

authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("admin_session");
  res.json({ success: true });
});
