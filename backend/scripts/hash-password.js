/**
 * Generate the two auth secrets for the shared-password login.
 *
 *   node scripts/hash-password.js "correct horse battery staple"
 *
 * Prints APP_PASSWORD_HASH and a fresh JWT_SECRET. Paste both into the backend
 * host's environment variables (Render dashboard → Environment). Never commit them.
 */
const crypto = require("crypto");
const { hashPassword } = require("../lib/auth");

const password = process.argv.slice(2).join(" ").trim();
if (!password) {
  console.error('Usage: node scripts/hash-password.js "your shared passphrase"');
  process.exit(1);
}
// Policy: length does the heavy lifting. A 16+ char passphrase ("blue-harbor-
// cargo-lane") is accepted as-is; anything shorter must mix character classes.
const rules = [
  [password.length >= 12, "at least 12 characters"],
  [password.length >= 16 || /[A-Z]/.test(password), "one uppercase letter (or make it 16+ chars)"],
  [password.length >= 16 || /[a-z]/.test(password), "one lowercase letter (or make it 16+ chars)"],
  [password.length >= 16 || /[0-9]/.test(password), "one number (or make it 16+ chars)"],
];
const failed = rules.filter(([ok]) => !ok).map(([, msg]) => msg);
if (failed.length) {
  console.error("Password too weak. Needs: " + failed.join(", ") + ".");
  console.error('Tip: 4 random words beat symbols — e.g. "copper-vessel-brunswick-97".');
  process.exit(1);
}
if (!/[^A-Za-z0-9]/.test(password) && password.length < 16) {
  console.warn("Note: a symbol is recommended for shorter passwords (not required).\n");
}

console.log("\nAdd these to the backend environment (Render → Environment):\n");
console.log(`APP_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`JWT_SECRET=${crypto.randomBytes(32).toString("hex")}`);
console.log("\n(JWT_SECRET is regenerated each run — only keep one. Changing it later logs everyone out.)\n");
