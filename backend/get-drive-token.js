/**
 * ONE-TIME SETUP SCRIPT — run this once to get your Google Drive refresh token.
 *
 * Usage:
 *   node get-drive-token.js
 *
 * It will open your browser, ask you to sign in with the Google account that
 * owns your Drive folders, and then print the refresh token to paste into .env.
 */

const { google } = require("googleapis");
const http = require("http");
const url = require("url");
require("dotenv").config();

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error(
    "\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be in .env before running this script.\n"
  );
  process.exit(1);
}

const REDIRECT_PORT = 4001;
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope:       ["https://www.googleapis.com/auth/drive"],
  prompt:      "consent",   // force new refresh token every run
});

console.log("\n─────────────────────────────────────────────────────────");
console.log("  DDG Google Drive Authorization");
console.log("─────────────────────────────────────────────────────────");
console.log("\nOpen this URL in your browser and sign in with your Google account:\n");
console.log("  " + authUrl);
console.log("\nWaiting for authorization...\n");

// Try to auto-open browser
try {
  const { exec } = require("child_process");
  exec(`start "" "${authUrl}"`);
} catch (_) {}

// Local server to capture the OAuth callback
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code  = parsed.query.code;
  const error = parsed.query.error;

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2 style="color:red">Authorization denied: ${error}</h2>`);
    server.close();
    console.error("❌  Authorization denied:", error);
    process.exit(1);
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <html><body style="font-family:sans-serif;padding:40px">
      <h2 style="color:#22c55e">✅ Authorization successful!</h2>
      <p>You can close this tab and check your terminal for the refresh token.</p>
    </body></html>
  `);

  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.log("\n⚠️  No refresh token returned.");
      console.log("   Go to https://myaccount.google.com/permissions and revoke");
      console.log('   "DDG Drive Upload" access, then run this script again.\n');
      process.exit(1);
    }

    console.log("\n─────────────────────────────────────────────────────────");
    console.log("  ✅  SUCCESS — add these lines to backend/.env");
    console.log("─────────────────────────────────────────────────────────\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log("─────────────────────────────────────────────────────────\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌  Failed to exchange code for token:", err.message);
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`Listening for Google callback on http://localhost:${REDIRECT_PORT} ...`);
});
