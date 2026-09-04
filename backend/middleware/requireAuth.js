/**
 * Route guard — every request needs a valid login token EXCEPT the open paths
 * below. Token is read from (in order): Authorization: Bearer header, an
 * "auth_token" cookie, or a "token" query param (needed for direct <a href>,
 * window.open, and <iframe> loads of backend PDFs where headers can't be set).
 *
 * Fails open ONLY when auth is not configured yet (no APP_PASSWORD_HASH /
 * JWT_SECRET in the environment) so a misconfigured deploy is obvious (the app
 * works but is unprotected) rather than bricked. Once both env vars are set,
 * it fails closed.
 */
const { verifyToken, authConfigured } = require("../lib/auth");

// Exact paths or path prefixes ("/x/" matches "/x/anything") that skip the guard
const OPEN_EXACT = new Set(["/", "/api/health", "/oauth2callback"]);
const OPEN_PREFIX = ["/api/auth/"];

function isOpen(p) {
  if (OPEN_EXACT.has(p)) return true;
  return OPEN_PREFIX.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre));
}

function readToken(req) {
  const hdr = req.headers.authorization || "";
  if (hdr.startsWith("Bearer ")) return hdr.slice(7).trim();
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (req.query && req.query.token) return String(req.query.token);
  return "";
}

module.exports = function requireAuth(req, res, next) {
  if (req.method === "OPTIONS" || isOpen(req.path)) return next();

  // Not set up yet — let requests through but shout in the logs.
  if (!authConfigured()) {
    if (!global.__authWarned) {
      console.warn("[auth] APP_PASSWORD_HASH / JWT_SECRET not set — API IS UNPROTECTED. Set both env vars.");
      global.__authWarned = true;
    }
    return next();
  }

  const data = verifyToken(readToken(req));
  if (!data) return res.status(401).json({ error: "Not authenticated" });
  req.auth = data;
  next();
};
