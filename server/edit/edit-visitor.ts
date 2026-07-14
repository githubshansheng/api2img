import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import type { RequestHandler } from "express";

export const EDIT_VISITOR_COOKIE_NAME = "api2img_edit_visitor";
export const EDIT_VISITOR_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type EditVisitor = {
  ownerId: string;
  workspaceId: string;
};

declare global {
  namespace Express {
    interface Request {
      editVisitor?: EditVisitor;
    }
  }
}

export function createEditVisitorMiddleware(): RequestHandler {
  const secret = resolveEditVisitorSecret();

  return (req, res, next) => {
    const ownerId = readSignedVisitorCookie(req.headers.cookie, secret) ??
      randomBytes(32).toString("base64url");
    const visitor = {
      ownerId,
      workspaceId: createVisitorWorkspaceId(ownerId, secret)
    };

    req.editVisitor = visitor;
    res.cookie(EDIT_VISITOR_COOKIE_NAME, signVisitorCookie(ownerId, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/edit-sessions",
      maxAge: EDIT_VISITOR_COOKIE_MAX_AGE_MS
    });
    next();
  };
}

export function requireEditVisitor(request: Express.Request) {
  if (!request.editVisitor) {
    throw new Error("EDIT_VISITOR_MISSING");
  }

  return request.editVisitor;
}

export function createVisitorWorkspaceId(ownerId: string, secret: string) {
  return `edit-workspace-${createHmac("sha256", secret)
    .update(`workspace:${ownerId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function resolveEditVisitorSecret() {
  const configured = process.env.API2IMG_EDIT_SESSION_SECRET?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "API2IMG_EDIT_SESSION_SECRET is required when NODE_ENV is production."
    );
  }

  return "api2img-edit-visitor-development-secret";
}

function readSignedVisitorCookie(cookieHeader: string | undefined, secret: string) {
  const encoded = cookieHeader
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${EDIT_VISITOR_COOKIE_NAME}=`))
    ?.slice(EDIT_VISITOR_COOKIE_NAME.length + 1);

  if (!encoded) {
    return undefined;
  }

  let value: string;

  try {
    value = decodeURIComponent(encoded);
  } catch {
    return undefined;
  }

  const parts = value.split(".");

  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]{32,}$/.test(parts[1]!)) {
    return undefined;
  }

  const expected = signVisitorCookie(parts[1]!, secret);

  if (expected.length !== value.length) {
    return undefined;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(value))
    ? parts[1]
    : undefined;
}

function signVisitorCookie(ownerId: string, secret: string) {
  const payload = `v1.${ownerId}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}
