/**
 * Bulk backfill: re-parse every order's saved "AES" PDF (in its Drive folder)
 * so usppiEin / titleNumber / titleState / bookingNumber / exporter* / etc.
 * get filled in from documents that were originally parsed before those
 * fields existed. Same logic as POST /api/orders/:id/parse-drive-files
 * (backend/routes/orders.js), just run across every order instead of one.
 *
 * Only fills fields that are currently BLANK on the order — never overwrites
 * anything already there. Must be run where the real MONGODB_URI + Google
 * Drive credentials live (the deploy), not from a dev machine.
 *
 *   node backend/scripts/aes-backfill-from-pdfs.js                    # dry run, all orders
 *   node backend/scripts/aes-backfill-from-pdfs.js --apply            # write
 *   node backend/scripts/aes-backfill-from-pdfs.js --apply --only=14217,14218
 *   node backend/scripts/aes-backfill-from-pdfs.js --apply --missing  # only orders missing usppiEin/titleNumber/bookingNumber
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const AES_FIELDS = [
  "bookingNumber", "vin", "year", "make", "model", "pol", "pod",
  "exporterName", "exporterAddress", "exporterCity", "exporterState", "exporterZip", "exporterCountry", "usppiEin",
  "consigneeName", "consigneeAddress", "consigneeCity", "consigneeCountry",
  "vessel", "weightKgs", "value", "vehicleYearMakeModel", "titleNumber", "titleState",
];

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyMissing = args.includes("--missing");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyRefs = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()) : null;

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const Order = require("../models/Order");
  const { parseAES } = require("../utils/parseOrderDocs");
  const { applyItn } = require("../utils/aesWeblink");
  const { listFilesInFolder, downloadDriveFile } = require("../googleDrive");

  const filter = { driveFolderId: { $exists: true, $ne: "" } };
  if (onlyRefs) filter.refNumber = { $in: onlyRefs };
  if (onlyMissing) {
    filter.$or = [
      { usppiEin: { $in: [null, ""] } },
      { titleNumber: { $in: [null, ""] } },
      { bookingNumber: { $in: [null, ""] } },
    ];
  }

  const orders = await Order.find(filter);
  console.log(`${orders.length} order(s) to check\n`);

  const tempDir = path.join(__dirname, "..", "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let touched = 0, errors = 0;
  for (const order of orders) {
    try {
      const files = await listFilesInFolder(order.driveFolderId);
      const aesFile = files.find((f) => (f.name || "").toLowerCase().includes("aes") && (f.name || "").toLowerCase().endsWith(".pdf"));
      if (!aesFile) continue;

      const tempPath = path.join(tempDir, `backfill_${aesFile.id}.pdf`);
      await downloadDriveFile(aesFile.id, tempPath);
      const parsed = await parseAES(tempPath);
      fs.unlink(tempPath, () => {});

      const updates = [];
      for (const field of AES_FIELDS) {
        if (parsed[field] && !order[field]) { order[field] = parsed[field]; updates.push(field); }
      }
      let itnResult = "";
      if (parsed.aesItn) itnResult = applyItn(order, parsed.aesItn, "bulk backfill");
      if (itnResult === "set") updates.push("aesItn");

      if (updates.length) {
        console.log(`${order.refNumber}: ${updates.join(", ")}`);
        touched++;
        if (apply) {
          order.timeline.push({ action: "AES Backfilled", details: `Bulk backfill from ${aesFile.name}: ${updates.join(", ")}.`, createdAt: new Date() });
          await order.save();
        }
      }
    } catch (err) {
      errors++;
      console.error(`${order.refNumber}: ERROR — ${err.message}`);
    }
  }

  console.log(`\n${touched} order(s) ${apply ? "updated" : "would be updated"}, ${errors} error(s).`);
  if (!apply) console.log("Dry run — re-run with --apply to write.");

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
