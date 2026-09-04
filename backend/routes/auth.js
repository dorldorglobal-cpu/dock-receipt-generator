const express = require("express");
const { verifyPassword, signToken, verifyToken, authConfigured } = require("../lib/auth");

const router = express.Router();

// ── Simple in-memory rate limiter for login attempts ────────────────────────
// 10 failed attempts per IP per 15 minutes, then 429 until the window resets.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const attempts = new Map(); // ip -> { fails, resetAt }

function rateState(ip) {
  const now = Date.now();
  let s = attempts.get(ip);
  if (!s || now > s.resetAt) {
    s = { fails: 0, resetAt: now + WINDOW_MS };
    attempts.set(ip, s);
  }
  return s;
}

// Occasionally sweep expired entries so the map can't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, s] of attempts) if (now > s.resetAt) attempts.delete(ip);
}, WINDOW_MS).unref?.();

// ── POST /api/auth/login  { password }  ->  { token }  (+ auth_token cookie) ─
router.post("/login", express.json(), (req, res) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const s = rateState(ip);
  if (s.fails >= MAX_FAILS) {
    const mins = Math.ceil((s.resetAt - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} min.` });
  }

  if (!authConfigured()) {
    return res.status(503).json({ error: "Login is not configured on the server yet." });
  }

  const { password } = req.body || {};
  if (!password || !verifyPassword(password)) {
    s.fails += 1;
    return res.status(401).json({ error: "Incorrect password." });
  }

  s.fails = 0;
  const token = signToken({ sub: "staff" });
  res.json({ token });
});

// ── GET /api/auth/verify — is my token still good? ──────────────────────────
router.get("/verify", (req, res) => {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  res.json({ ok: !!verifyToken(token), configured: authConfigured() });
});

module.exports = router;
