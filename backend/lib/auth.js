/**
 * Shared-password auth — no external dependencies (uses Node's built-in crypto).
 *
 * Two secrets live in environment variables ONLY (never in code, never in git):
 *   APP_PASSWORD_HASH  — scrypt hash of the shared password, format "scrypt$<saltHex>$<hashHex>"
 *                        generate with:  node scripts/hash-password.js "your passphrase"
 *   JWT_SECRET         — random string used to sign login tokens (32+ bytes hex)
 *
 * The plaintext password is never stored anywhere. verifyPassword() can only
 * answer "does this match", it can't recover the password.
 */
const crypto = require("crypto");

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  return process.env.JWT_SECRET || "";
}

// ── Password hashing (scrypt) ────────────────────────────────────────────────
function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password) {
  const stored = process.env.APP_PASSWORD_HASH || "";
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  let actual;
  try {
    actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ── Signed tokens (JWT-style: base64url(payload).base64url(HMAC-SHA256)) ──────
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload = {}) {
  const secret = getSecret();
  if (!secret) throw new Error("JWT_SECRET is not set");
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const secret = getSecret();
  if (!token || !secret) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expectedSig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function authConfigured() {
  return !!(process.env.APP_PASSWORD_HASH && process.env.JWT_SECRET);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, authConfigured, TOKEN_TTL_MS };
