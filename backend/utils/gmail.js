async function getGmailAccessToken() {
  const params = [
    `client_id=${encodeURIComponent(process.env.GMAIL_CLIENT_ID)}`,
    `client_secret=${encodeURIComponent(process.env.GMAIL_CLIENT_SECRET)}`,
    `refresh_token=${encodeURIComponent(process.env.GMAIL_REFRESH_TOKEN)}`,
    `grant_type=refresh_token`,
  ].join("&");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error("[Gmail token error]", JSON.stringify(data));
    throw new Error(data.error_description || data.error || "Failed to get Gmail access token");
  }
  return data.access_token;
}

module.exports = { getGmailAccessToken };
