const express = require("express");
const AesConfig = require("../models/AesConfig");
const aesCodes = require("../utils/aesCodes");

const router = express.Router();

// Keys a PUT is allowed to change. Anything else in the body is ignored.
const WRITABLE = [
  "usppiName", "usppiEin", "usppiIdType", "usppiAddress1", "usppiAddress2",
  "usppiCity", "usppiState", "usppiZip", "usppiContactFirst", "usppiContactLast", "usppiPhone",
  "forwardingAgent",
  "filerId", "srnPrefix", "responseEmail",
  "defaultFilingAction", "defaultFilingOption", "defaultFilingType",
  "defaultExportInfoCode", "defaultLicenseCode", "defaultLicenseNumber", "defaultEccn",
  "ultConsigneeType", "relatedParty", "hazmat", "routedExport",
  "defaultScheduleB", "scheduleBOverrides", "defaultOriginIndicator",
  "aesEnv",
];

// GET current config (+ the effective environment)
router.get("/", async (req, res) => {
  try {
    const cfg = await AesConfig.getSingleton();
    res.json({
      config: cfg,
      effectiveEnv: process.env.AES_ENV || cfg.aesEnv || "test",
      envLockedByServer: !!process.env.AES_ENV,
    });
  } catch (err) {
    console.error("Get AES config error:", err.message);
    res.status(500).json({ error: "Failed to load AES config" });
  }
});

// PUT — update whitelisted keys
router.put("/", async (req, res) => {
  try {
    const cfg = await AesConfig.getSingleton();
    for (const k of WRITABLE) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) cfg[k] = req.body[k];
    }
    await cfg.save();
    res.json({
      config: cfg,
      effectiveEnv: process.env.AES_ENV || cfg.aesEnv || "test",
      envLockedByServer: !!process.env.AES_ENV,
    });
  } catch (err) {
    console.error("Update AES config error:", err.message);
    res.status(500).json({ error: "Failed to save AES config" });
  }
});

// GET the read-only CBP code tables (for the Settings "code tables" panel)
router.get("/code-tables", (req, res) => {
  res.json({
    scheduleD: aesCodes.SCHEDULE_D,
    scheduleK: aesCodes.SCHEDULE_K,
    countryIso: aesCodes.COUNTRY_ISO,
    scac: aesCodes.SCAC,
  });
});

module.exports = router;
