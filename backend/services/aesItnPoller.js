/**
 * Background job: pull the ITN back for AES filings that were handed off to ACE
 * AESDirect but don't have an ITN yet, via the WebLink Inquiry API.
 *
 * Enable with AES_ITN_POLLER=on. No-ops (with a log line) until the Inquiry API
 * client cert is configured — see backend/utils/aesInquiry.js.
 */
const Order = require("../models/Order");
const AesConfig = require("../models/AesConfig");
const { inquireWeblink } = require("../utils/aesInquiry");
const { applyItn, effectiveEnv } = require("../utils/aesWeblink");

const INTERVAL_MS = 15 * 60 * 1000;
const GIVEUP_DAYS = Number(process.env.AES_ITN_GIVEUP_DAYS || 10);

async function pollAesItns({ dryRun = false } = {}) {
  const config = await AesConfig.getSingleton();
  if (!config.filerId) { console.log("[aesItnPoller] no Filer ID configured — skipping"); return { checked: 0 }; }
  const env = effectiveEnv(config);

  const orders = await Order.find({
    "aesFiling.status": { $in: ["handed_off", "accepted"] },
    $or: [{ aesItn: { $in: [null, ""] } }, { aesItn: { $exists: false } }],
  }).limit(50);

  let captured = 0, abandoned = 0, errors = 0;
  for (const order of orders) {
    const f = order.aesFiling || {};
    const ageDays = f.handedOffAt ? (Date.now() - new Date(f.handedOffAt).getTime()) / 86400000 : 0;

    if (ageDays > GIVEUP_DAYS) {
      order.aesFiling.status = "abandoned";
      order.timeline.push({ action: "AES Poll Gave Up", details: `No ITN after ${Math.round(ageDays)} days. Check ACE AESDirect manually for SRN ${f.srn}.`, createdAt: new Date() });
      if (!dryRun) await order.save();
      abandoned++;
      continue;
    }

    try {
      const { status, itn } = await inquireWeblink({ fid: config.filerId, srn: f.srn, env });
      order.aesFiling.lastPolledAt = new Date();
      order.aesFiling.pollAttempts = (f.pollAttempts || 0) + 1;

      if (itn) {
        applyItn(order, itn, "inquiry-poller");
        captured++;
      } else if (/reject/i.test(status)) {
        order.aesFiling.status = "rejected";
        order.aesFiling.lastError = status;
        order.timeline.push({ action: "AES Rejected", details: `Inquiry says: ${status} (SRN ${f.srn})`, createdAt: new Date() });
      } else if (status) {
        order.aesFiling.lastError = "";
      }
      if (!dryRun) await order.save();
    } catch (err) {
      errors++;
      order.aesFiling.lastError = err.message;
      order.aesFiling.lastPolledAt = new Date();
      if (!dryRun) await order.save().catch(() => {});
      if (/not configured/i.test(err.message)) {
        console.log("[aesItnPoller] Inquiry API not configured — stopping this run");
        break;
      }
    }
  }

  console.log(`[aesItnPoller] checked ${orders.length} · captured ${captured} · abandoned ${abandoned} · errors ${errors}`);
  return { checked: orders.length, captured, abandoned, errors };
}

function startAesItnPoller() {
  console.log("[aesItnPoller] starting (every 15 min)");
  pollAesItns().catch((e) => console.error("[aesItnPoller] first run:", e.message));
  setInterval(() => pollAesItns().catch((e) => console.error("[aesItnPoller]", e.message)), INTERVAL_MS);
}

module.exports = { startAesItnPoller, pollAesItns };
