import { createHmac, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";

const args = readArguments(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

const databasePath = requireArgument(args, "database");
const sessionId = requireArgument(args, "session");
const cookie = requireArgument(args, "cookie");
const secret = (args.secret || process.env.API2IMG_EDIT_SESSION_SECRET || "").trim();

if (!secret) {
  throw new Error(
    "API2IMG_EDIT_SESSION_SECRET is required. Prefer setting it in the environment."
  );
}

const ownerId = verifyVisitorCookie(cookie, secret);
const workspaceId = createVisitorWorkspaceId(ownerId, secret);
const database = new Database(databasePath);

try {
  const result = database.prepare(`
    UPDATE edit_sessions
    SET owner_id = ?, workspace_id = ?
    WHERE id = ? AND owner_id = 'legacy-frozen'
  `).run(ownerId, workspaceId, sessionId);

  if (result.changes !== 1) {
    throw new Error(
      "No frozen legacy session was claimed. Verify the database path and session ID, or confirm the session has not already been claimed."
    );
  }

  console.log(`Claimed legacy edit session ${sessionId}.`);
} finally {
  database.close();
}

function readArguments(values) {
  const result = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--help" || value === "-h") {
      result.help = true;
      continue;
    }

    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value}`);
    }

    const name = value.slice(2);
    const argumentValue = values[index + 1];

    if (!argumentValue || argumentValue.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }

    result[name] = argumentValue;
    index += 1;
  }

  return result;
}

function requireArgument(args, name) {
  const value = args[name]?.trim();

  if (!value) {
    throw new Error(`--${name} is required.`);
  }

  return value;
}

function verifyVisitorCookie(value, secret) {
  const cookieValue = value
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("api2img_edit_visitor="))
    ?.slice("api2img_edit_visitor=".length) ?? value;
  const decoded = decodeURIComponent(cookieValue);
  const parts = decoded.split(".");

  if (
    parts.length !== 3 ||
    parts[0] !== "v1" ||
    !/^[A-Za-z0-9_-]{32,}$/.test(parts[1] ?? "")
  ) {
    throw new Error("The supplied visitor cookie is malformed.");
  }

  const expected = signVisitorCookie(parts[1], secret);

  if (
    expected.length !== decoded.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(decoded))
  ) {
    throw new Error("The supplied visitor cookie signature is invalid.");
  }

  return parts[1];
}

function signVisitorCookie(ownerId, secret) {
  const payload = `v1.${ownerId}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function createVisitorWorkspaceId(ownerId, secret) {
  return `edit-workspace-${createHmac("sha256", secret)
    .update(`workspace:${ownerId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function printUsage() {
  console.log(`
Usage:
  API2IMG_EDIT_SESSION_SECRET=... node scripts/claim-legacy-edit-session.mjs \\
    --database <path-to-edit-sessions.sqlite> \\
    --session <legacy-session-id> \\
    --cookie <api2img_edit_visitor-cookie-value-or-header>

This tool only claims sessions whose owner_id is legacy-frozen.
`);
}
