/**
 * One-time backfill: patch the AesConfig singleton with the real values
 * confirmed from accepted CBP filings — order 14217 (2026-09-10), then a bulk
 * scan of 307 real accepted EEI printouts. Schema defaults only apply to a NEW
 * document — this fixes up the one already created in production. Only
 * touches fields that are still blank or still at their old default, never
 * overwrites something you've already entered.
 *
 *   node backend/scripts/aes-seed-real-values.js          # dry run
 *   node backend/scripts/aes-seed-real-values.js --apply  # write
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const PATCH = {
  "forwardingAgent.name":     "DOR LDOR GLOBAL",
  "forwardingAgent.address1": "23 GALAHAD DR",
  "forwardingAgent.city":     "MANALAPAN",
  "forwardingAgent.state":    "NJ",
  "forwardingAgent.postal":   "07726",
  "forwardingAgent.country":  "US",
  "forwardingAgent.idType":   "E",
  ultConsigneeType:           "O",           // confirmed 306/307
  defaultInBondCode:          "70",          // confirmed 307/307
  defaultFilingOption:        "2",           // confirmed 307/307 — PREDEPARTURE
  defaultScheduleB:           "8703600045",  // confirmed 303/307
  defaultStateOfOrigin:       "NJ",          // plurality 177/307 — last-resort fallback only
};
// Only overwritten if the field is currently exactly this old value (i.e. untouched)
const REPLACE_IF_OLD = {
  srnPrefix:              { was: "DDG", now: "" },
  defaultOriginIndicator: { was: "F",   now: "D" },
};

(async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const AesConfig = require("../models/AesConfig");
  const cfg = await AesConfig.getSingleton();

  const changes = [];
  for (const [path, val] of Object.entries(PATCH)) {
    const [a, b] = path.split(".");
    const current = b ? (cfg[a] || {})[b] : cfg[a];
    if (!current) {
      changes.push(`${path}: "" → "${val}"`);
      if (apply) { if (b) { cfg[a] = cfg[a] || {}; cfg[a][b] = val; } else cfg[a] = val; }
    }
  }
  for (const [key, { was, now }] of Object.entries(REPLACE_IF_OLD)) {
    if (cfg[key] === was) {
      changes.push(`${key}: "${was}" → "${now}"`);
      if (apply) cfg[key] = now;
    }
  }

  if (!changes.length) {
    console.log("Nothing to change — AesConfig already has these fields set (or customized).");
  } else {
    console.log(`${apply ? "Applying" : "Would change"} ${changes.length} field(s):`);
    changes.forEach((c) => console.log("  " + c));
    if (apply) { await cfg.save(); console.log("Saved."); }
    else console.log("\nDry run — re-run with --apply to write.");
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
