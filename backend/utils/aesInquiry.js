/**
 * CBP AES WebLink Inquiry API — server-to-server status/ITN lookup for a
 * previously handed-off filing.
 *
 * POST form-encoded { FID, SRN } to:
 *   test → https://trade-test.cbp.dhs.gov/ace/aes/aesdirect-ui/secured/weblinkFilingInquiry
 *   prod → https://trade.cbp.dhs.gov/ace/aes/aesdirect-ui/secured/weblinkFilingInquiry
 *
 * The `/secured/` path almost certainly needs a CBP-issued client certificate
 * (obtained during WebLink certification). Provide it as PEM in AES_INQUIRY_CERT
 * / AES_INQUIRY_KEY. Without it this throws "inquiry not configured" and callers
 * (the poller, the manual button) log + skip rather than fail.
 */
const https = require("https");
const { URL } = require("url");

const TEST_URL = "https://trade-test.cbp.dhs.gov/ace/aes/aesdirect-ui/secured/weblinkFilingInquiry";
const PROD_URL = "https://trade.cbp.dhs.gov/ace/aes/aesdirect-ui/secured/weblinkFilingInquiry";

function inquiryAgent() {
  const cert = process.env.AES_INQUIRY_CERT;
  const key = process.env.AES_INQUIRY_KEY;
  if (!cert || !key) return null;
  return new https.Agent({
    cert: cert.replace(/\\n/g, "\n"),
    key: key.replace(/\\n/g, "\n"),
    keepAlive: false,
  });
}

function extractItn(text) {
  const m = String(text || "").match(/\bX\d{14,}\b/i);
  return m ? m[0].toUpperCase() : "";
}

function extractStatus(text) {
  const m = String(text || "").match(/"?status"?\s*[:=]\s*"?([A-Za-z _-]{2,40})/i);
  return m ? m[1].trim() : "";
}

/**
 * @returns {Promise<{ status, itn, raw }>}
 */
function inquireWeblink({ fid, srn, env } = {}) {
  return new Promise((resolve, reject) => {
    if (!fid || !srn) return reject(new Error("inquiry needs fid + srn"));
    const agent = inquiryAgent();
    if (!agent) return reject(new Error("inquiry not configured (AES_INQUIRY_CERT / AES_INQUIRY_KEY unset)"));

    const target = new URL((env === "prod" ? PROD_URL : TEST_URL));
    const body = new URLSearchParams({ FID: String(fid), SRN: String(srn) }).toString();

    const reqOpts = {
      method: "POST",
      hostname: target.hostname,
      path: target.pathname + target.search,
      agent,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json, text/plain, */*",
      },
      timeout: 20000,
    };

    const r = https.request(reqOpts, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => {
        if (resp.statusCode >= 400) return reject(new Error(`inquiry HTTP ${resp.statusCode}: ${data.slice(0, 200)}`));
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* not JSON */ }
        const itn = (parsed && (parsed.itn || parsed.ITN || parsed.internalTransactionNumber)) || extractItn(data);
        const status = (parsed && (parsed.status || parsed.filingStatus)) || extractStatus(data) || (itn ? "ITN" : "");
        resolve({ status: String(status || ""), itn: itn ? String(itn).toUpperCase() : "", raw: data.slice(0, 2000) });
      });
    });
    r.on("timeout", () => { r.destroy(new Error("inquiry timed out")); });
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

module.exports = { inquireWeblink, TEST_URL, PROD_URL };
