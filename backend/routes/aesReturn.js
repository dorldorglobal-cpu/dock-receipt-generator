/**
 * Public landing route for CBP AES WebLink `wl_success_url` / `wl_nosed_url`.
 * The user's browser is redirected here after they submit (or fail to submit)
 * the pre-filled filing in ACE AESDirect.
 *
 * No shared-password auth (see middleware/requireAuth OPEN_EXACT) — it's guarded
 * by the per-filing random `t` (returnToken) that only our own aes-weblink
 * response embedded in the URL.
 *
 * CBP does not document exactly which params it appends, so we read the ITN /
 * SRN / status defensively from any query or body key that looks right.
 */
const express = require("express");
const Order = require("../models/Order");
const AesConfig = require("../models/AesConfig");
const { applyItn, effectiveEnv } = require("../utils/aesWeblink");
const { inquireWeblink } = require("../utils/aesInquiry");

const router = express.Router();

const pick = (obj, keys) => {
  for (const k of keys) {
    for (const actual of Object.keys(obj || {})) {
      if (actual.toLowerCase() === k) return obj[actual];
    }
  }
  return "";
};

async function handle(req, res) {
  const q = { ...(req.query || {}), ...(req.body || {}) };
  const orderId = q.o || q.order || "";
  const token = q.t || q.token || "";
  const ok = String(q.ok || "1") !== "0";

  const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
     <body style="font-family:system-ui;padding:40px;max-width:520px;margin:auto">
     <h2>${title}</h2><p>${body}</p>
     <p style="color:#666">You can close this tab and return to DDG OPS.</p>`;

  try {
    if (!orderId || !token) return res.status(400).send(page("Missing reference", "This link is incomplete."));
    const order = await Order.findById(orderId);
    if (!order || !order.aesFiling || order.aesFiling.returnToken !== token) {
      return res.status(403).send(page("Not recognized", "This return link didn't match a known filing."));
    }

    const itnRaw = pick(q, ["itn", "internaltransactionnumber", "aesitn"]);
    let outcome = "";

    if (itnRaw && /^X\d{14,}$/i.test(String(itnRaw).trim())) {
      const r = applyItn(order, itnRaw, "weblink-return");
      order.aesFiling.status = "itn_received";
      outcome = r === "mismatch"
        ? `A different ITN (${String(itnRaw).toUpperCase()}) came back — kept the existing one. Check the order timeline.`
        : `ITN <strong>${String(itnRaw).toUpperCase()}</strong> saved to order ${order.refNumber}.`;
    } else if (ok) {
      if (order.aesFiling.status !== "itn_received") order.aesFiling.status = "accepted";
      order.aesFiling.lastError = "";
      order.timeline.push({ action: "AES Submitted", details: `Filing ${order.aesFiling.srn} submitted in ACE AESDirect. Awaiting ITN.`, createdAt: new Date() });
      outcome = "Filing submitted in ACE. The ITN will arrive by email and be pulled onto the order automatically.";

      // CBP redirects the user here without the ITN — try one immediate inquiry
      // so the order often has the ITN before the poller's next 15-min pass.
      try {
        const config = await AesConfig.getSingleton();
        if (config.filerId) {
          const { itn } = await inquireWeblink({ fid: config.filerId, srn: order.aesFiling.srn, env: effectiveEnv(config) });
          if (itn) {
            applyItn(order, itn, "weblink-return inquiry");
            outcome = `ITN <strong>${itn}</strong> saved to order ${order.refNumber}.`;
          }
        }
      } catch (e) { /* inquiry not configured / slow — the poller will get it */ }
    } else {
      order.aesFiling.status = "rejected";
      order.aesFiling.lastError = String(pick(q, ["error", "message", "reason"]) || "Rejected / not submitted in ACE.");
      order.timeline.push({ action: "AES Rejected", details: `Filing ${order.aesFiling.srn}: ${order.aesFiling.lastError}`, createdAt: new Date() });
      outcome = "ACE reported the filing was not completed. Open the order to review and re-file.";
    }

    await order.save();
    res.send(page(ok ? "AES filing received" : "AES filing not completed", outcome));
  } catch (err) {
    console.error("aes weblink-return error:", err.message);
    res.status(500).send(page("Something went wrong", "We couldn't record this filing. Check the order in DDG OPS."));
  }
}

router.get("/weblink-return", handle);
router.post("/weblink-return", handle);

module.exports = router;
