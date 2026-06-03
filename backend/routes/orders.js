const express = require("express");
const Order = require("../models/Order");
const Expense = require("../models/Expense");
const Pricing = require("../models/Pricing");
const Counter = require("../models/Counter");
const multer = require("multer");
const { parseAES, parseDispatch, parseBuyerReceipt } = require("../utils/parseOrderDocs");
const AddressBook = require("../models/AddressBook");
const path = require("path");
const PDFDocument = require("pdfkit");
const fs = require("fs");

const {
  drive,
  createDriveFolder,
  uploadFileToDrive,
  listFilesInFolder,
  listFoldersInFolder,
  downloadDriveFile,
  moveDriveFolder,
  deleteDriveFolder,
} = require("../googleDrive");

const router = express.Router();

// ── Auto-link unlinked expenses that contain this order's VIN ─────────────────
async function autoLinkExpenses(order) {
  if (!order?.vin) return;
  try {
    const result = await Expense.updateMany(
      {
        orderId:  null,
        orderRef: "",
        description: { $regex: order.vin, $options: "i" },
      },
      {
        $set: {
          orderId:  order._id,
          orderRef: order.refNumber || "",
        },
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`Auto-linked ${result.modifiedCount} expense(s) to order ${order.refNumber} (VIN: ${order.vin})`);
    }
  } catch (e) {
    console.warn("autoLinkExpenses error:", e.message);
  }
}
const upload = multer({ dest: "temp/" });

// ── Local file storage helpers ────────────────────────────────────────────────
const UPLOADS_BASE = path.join(__dirname, "..", "uploads");

function orderUploadsDir(orderId) {
  const dir = path.join(UPLOADS_BASE, String(orderId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".pdf":  "application/pdf",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls":  "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc":  "application/msword",
    ".txt":  "text/plain",
  };
  return map[ext] || "application/octet-stream";
}

function listLocalFiles(orderId) {
  const dir = path.join(UPLOADS_BASE, String(orderId));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => !name.startsWith("."))
    .map(name => {
      const stats = fs.statSync(path.join(dir, name));
      return {
        id:           name,
        name,
        webViewLink:  `http://localhost:4000/uploads/${orderId}/${encodeURIComponent(name)}`,
        mimeType:     getMimeType(name),
        modifiedTime: stats.mtime.toISOString(),
        createdTime:  stats.birthtime.toISOString(),
        isLocal:      true,
      };
    })
    .sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
}

// ── RORO delivery logic (shared with claude.js) ──────────────────────────────
const DELIVERY_BY_REGION = [
  { states:["tx","texas","la","louisiana","ms","mississippi","al","alabama","ga","georgia","fl","florida","ar","arkansas","ok","oklahoma","tn","tennessee","sc","south carolina","nc","north carolina","mo","missouri"],
    delivery:{ deliveryName:"ACL Freeport", deliveryAddress:"1 Port Road", deliveryCity:"Freeport", deliveryState:"TX", deliveryZip:"77541" } },
  { states:["nj","new jersey","ny","new york","ct","connecticut","ma","massachusetts","ri","rhode island","pa","pennsylvania","de","delaware","nh","new hampshire","me","maine","vt","vermont"],
    delivery:{ deliveryName:"Sallaum Providence", deliveryAddress:"Davisville Marine Terminal", deliveryCity:"Providence", deliveryState:"RI", deliveryZip:"02905" } },
  { states:["md","maryland","va","virginia"],
    delivery:{ deliveryName:"ACL Baltimore", deliveryAddress:"2001 E McComas St", deliveryCity:"Baltimore", deliveryState:"MD", deliveryZip:"21230" } },
  { states:["ca","california","az","arizona","nv","nevada","nm","new mexico","ut","utah","co","colorado","or","oregon","wa","washington","id","idaho"],
    delivery:{ deliveryName:"Sallaum Providence", deliveryAddress:"Davisville Marine Terminal", deliveryCity:"Providence", deliveryState:"RI", deliveryZip:"02905" } },
];
const AFRICA_PODS = ["TEMA","LAGOS","COTONOU","LOME","DAKAR","ABIDJAN","DURBAN","DOUALA"];
function applyRoroDelivery(result) {
  if (result.deliveryName) return;
  const pod = (result.pod || "").toUpperCase();
  if (!AFRICA_PODS.includes(pod)) return;
  const state = (result.pickupState || "").toLowerCase();
  if (!state) return;
  for (const region of DELIVERY_BY_REGION) {
    if (region.states.some(s => state.includes(s))) { Object.assign(result, region.delivery); return; }
  }
}

const FOLDERS = {
  // ── Dor L'dor Global > Website ───────────────────────────────────────────
  OUTSTANDING:     "1H1z3qz7Q9evi0RI3Bp2LHcVbIi72oAuj", // New Orders
  DISPATCHED:      "16p_LdTlIAa_Je8VHwKsatVjJuI_mpQPy", // Dispatched
  WAITING_TO_SAIL: "1l2UlM3T8CMWzA0koiRWUuexxHI7U694X", // Waiting to Sail
  SAILED:          "1GBMhn6FMLSWUVGrt4GVDD8mEqHpEcuJd", // Sailed
  ARRIVED:         "1vKMq92Xg3Fgel7m2eNqLtLM-WdCb8RbD", // Arrived
  COMPLETED:       "19cOmHNa0s7BewQ7wqdXPtLcGwx1pjklC", // Completed

  ACL:     "12d_VzDnu63UjNIUoX01EwLCrbKwa_QtK", // Waiting to Sail > ACL
  SALLAUM: "1ieF0GqNCjWo-nuiVEY3Ot69_dP7gQm6i", // Waiting to Sail > SALLAUM
};

async function generateRefNumber() {
  const counter = await Counter.findByIdAndUpdate(
    "orderRef",
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq.toString();
}

// ── GET /api/orders/next-ref — peek at next order number without reserving it ──
router.get("/next-ref", async (req, res) => {
  try {
    const counter = await Counter.findById("orderRef");
    const next = counter ? counter.seq + 1 : 13782;
    res.json({ nextRef: next.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function folderForStatus(status) {
  if (status === "New Order")        return FOLDERS.OUTSTANDING;
  if (status === "Dispatched")       return FOLDERS.DISPATCHED;
  if (status === "Waiting to Sail")  return FOLDERS.WAITING_TO_SAIL;
  if (status === "Sailed")           return FOLDERS.SAILED;
  if (status === "Arrived")          return FOLDERS.ARRIVED;
  if (status === "Completed")        return FOLDERS.COMPLETED;
  if (status === "Paid")             return FOLDERS.COMPLETED;
  return FOLDERS.OUTSTANDING;
}

function parentForLine(line) {
  return line === "SALLAUM" ? FOLDERS.SALLAUM : FOLDERS.ACL;
}

function addTimeline(order, action, details) {
  order.timeline.push({
    action,
    details,
    createdAt: new Date(),
  });
}

// Strip undefined/null/"" values so spread never overrides existing fields with nothing
function cleanSpread(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && v !== "") result[k] = v;
  }
  return result;
}

// PARSE BUYER RECEIPT
router.post("/parse-buyer-receipt", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let parsed = await parseBuyerReceipt(req.file.path);
    const fileBuffer = fs.readFileSync(req.file.path);
    fs.unlink(req.file.path, () => {});

    // ── If regex parser returned little/nothing (or missing pickup), fall back to AI ──
    const pdfParse2 = require("pdf-parse");
    const rawText   = (await pdfParse2(fileBuffer)).text;
    const isCopartDoc = /copart/i.test(rawText);
    // Always run enhanced parser for Copart; for others only if pickup missing
    const needsEnhanced = isCopartDoc || !parsed?.pickupState;
    if (needsEnhanced) {
      try {
        const Groq = require("groq-sdk");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const text = rawText;
        const isCopart = isCopartDoc;
        if (isCopart) {
          // VIN
          const vinMatch  = text.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
          // Vehicle line: "VEHICLE:2020 MERCEDES-BENZ GLE 350 4MATIC BLUE Phy"
          const vehLine   = text.match(/VEHICLE:\s*(.+?)(?:Phy Yard|Keys:|$)/im);
          let year="", make="", model="", color="";
          if (vehLine) {
            const vl = vehLine[1].trim();
            const COLORS = ["BLACK","WHITE","BLUE","RED","SILVER","GRAY","GREY","GREEN","BROWN","GOLD","ORANGE","YELLOW","PURPLE","BEIGE","MAROON","BURGUNDY","TAN","CREAM","PINK","TEAL"];
            const colorFound = COLORS.find(c => vl.toUpperCase().includes(c));
            const colorIdx = colorFound ? vl.toUpperCase().lastIndexOf(colorFound) : vl.length;
            const beforeColor = vl.slice(0, colorIdx).trim();
            const yearMatch = beforeColor.match(/^(\d{4})\s+/);
            if (yearMatch) {
              year = yearMatch[1];
              const rest = beforeColor.slice(yearMatch[0].length).trim();
              // Make = first word(s) before a number or 3+ word model
              const makeMatch = rest.match(/^([A-Z][A-Z\-]+(?:\s[A-Z][A-Z\-]+)?)\s+(.+)$/i);
              if (makeMatch) { make = makeMatch[1].trim(); model = makeMatch[2].trim(); }
              else { make = rest; }
            }
            color = colorFound || "";
          }
          // Lot number
          const lotMatch   = text.match(/LOT#:\s*(\d+)/i);
          // Sale price
          const priceMatch = text.match(/Sale Price\s*\$?([\d,]+\.?\d*)/i);
          // Buyer/member name — line after "SELLER:" that has company keywords
          const memberMatch = text.match(/SELLER:\s*[\r\n]+\s*([A-Z][^\r\n]{3,80}(?:LTD|LLC|INC|CORP|LIMITED|ENTERPRISES|INTERNATIONAL|VENTURES|GLOBAL|MOTORS|TRADING|GROUP)[^\r\n]*)/i);

          // Pickup: look for US address pattern — "NNN STREET\nCITYSTATE ZIP" (merged by PDF)
          // Copart merges city+state+zip: "NORTH BILLERICAMA01862"
          let pickupAddress="", pickupCity="", pickupState="", pickupZip="", pickupName="Copart";
          // Find US street addresses — number + street name containing a suffix keyword
          const streetMatches = [...text.matchAll(/(\d+[A-Z]?\s+[^\r\n]+?(?:STREET|AVENUE|ROAD|DRIVE|BLVD|BOULEVARD|LANE|HIGHWAY|HWY)\b[^\r\n]*)/gi)];
          if (streetMatches.length) {
            // Use the last street address found
            pickupAddress = streetMatches[streetMatches.length - 1][1].trim();
            // City+state+zip — Copart merges them: "NORTH BILLERICAMA" then zip on next line
            const afterAddr = text.slice(streetMatches[streetMatches.length - 1].index + streetMatches[streetMatches.length - 1][0].length, streetMatches[streetMatches.length - 1].index + 400);
            // Grab first all-caps line after the street (city+state merged or separate)
            const cityLineMatch = afterAddr.match(/[\r\n,\s]+([A-Z][A-Z\s,]+[A-Z])/);
            if (cityLineMatch) {
              const raw = cityLineMatch[1].trim().replace(/^,\s*/, "");
              // Check if zip is embedded at end: "NORTH BILLERICAMA01862"
              const zipEmbedded = raw.match(/^([A-Z][A-Z\s]+?)([A-Z]{2})(\d{5})$/);
              if (zipEmbedded) {
                pickupCity  = zipEmbedded[1].trim();
                pickupState = zipEmbedded[2];
                pickupZip   = zipEmbedded[3];
              } else {
                // State is last 2 chars of city line, zip is next line
                pickupState = raw.slice(-2);
                pickupCity  = raw.slice(0, -2).trim().replace(/[,\s]+$/, "");
                const zipMatch = afterAddr.match(/[\r\n,\s]+(\d{5})/);
                if (zipMatch) pickupZip = zipMatch[1];
              }
            }
          }
          // For Copart, pickup name is always "Copart" — Danny's Auto Sales is the seller, not the yard
          pickupName = "Copart";

          parsed = {
            customerName: memberMatch?.[1]?.trim() || "",
            vin:          vinMatch?.[1]             || "",
            year, make, model, color,
            lotNumber:    lotMatch?.[1]             || "",
            bidAmount:    priceMatch ? parseFloat(priceMatch[1].replace(/,/g,"")) : 0,
            pickupName, pickupAddress, pickupCity, pickupState, pickupZip,
          };
        }

        // ── Generic AI fallback for non-Copart or if Copart regex missed key fields ──
        if (!parsed.vin || !parsed.pickupState) {
          const aiRes = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: `You are a logistics document parser for auto export. Extract from this buyer receipt/bill of sale.
${isCopart ? `This is a COPART document. Key patterns:
- VEHICLE line: "VEHICLE:YEAR MAKE MODEL COLOR" — extract year, make, model, color from this exact line
- VIN: appears after "VIN:" label
- LOT#: appears after "LOT#:" label
- PHYSICAL ADDRESS OF LOT: the yard/seller address — extract as pickupAddress, pickupCity, pickupState, pickupZip
- The BUYER/MEMBER company name appears after "SELLER:" in the first section (before the US address)
- pickupName: the seller yard name (e.g. "Danny's Auto Sales")` : ""}
Return ONLY JSON with: customerName, year, make, model, vin, color, mileage, lotNumber, bidAmount, pickupName, pickupAddress, pickupCity, pickupState, pickupZip` },
              { role: "user", content: `Document:\n\n${text.slice(0, 6000)}` },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
          });
          const aiParsed = JSON.parse(aiRes.choices[0].message.content);
          // Merge: AI fills any gaps left by regex
          parsed = { ...aiParsed, ...Object.fromEntries(Object.entries(parsed).filter(([,v]) => v)) };
        }
      } catch (aiErr) {
        console.error("AI buyer receipt fallback failed:", aiErr.message);
      }
    }

    // ── Customer lookup ─────────────────────────────────────────────────────
    let customerFound = null;
    if (parsed.customerName) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const name = parsed.customerName.trim();
      const normalize = (s) => s.replace(/[-_,.']/g, " ").replace(/\s+/g, " ").trim();
      const variants = [...new Set([name, normalize(name), name.replace(/\s+/g, "-")])].map(esc);
      customerFound = await AddressBook.findOne({
        $or: variants.map(v => ({ companyName: { $regex: v, $options: "i" } })),
      });
      if (!customerFound) {
        const words = normalize(name).split(" ").filter(w => w.length > 3);
        if (words.length) {
          customerFound = await AddressBook.findOne({
            companyName: { $regex: words.slice(0, 2).map(esc).join(".*"), $options: "i" }
          });
        }
      }
    }

    // Apply RORO delivery logic if pod is known
    const result = { ...parsed, customerFound: !!customerFound, customerRecord: customerFound || null };
    if (customerFound?.defaultPod) result.pod = result.pod || customerFound.defaultPod;
    applyRoroDelivery(result);
    res.json(result);
  } catch (err) {
    console.error("Parse buyer receipt error:", err);
    res.status(500).json({ error: "Failed to parse buyer receipt" });
  }
});

// CREATE ORDER
router.post("/", async (req, res) => {
  try {
    // ── VIN duplicate check ──────────────────────────────────────────
    const vinInput = (req.body.vin || "").trim().toUpperCase();
    if (vinInput) {
      const existing = await Order.findOne({ vin: vinInput });
      if (existing) {
        return res.status(409).json({
          error: `An order already exists for VIN ${vinInput} (Ref #${existing.refNumber}). Duplicate orders are not allowed.`,
          existingRefNumber: existing.refNumber,
          existingId: existing._id,
        });
      }
    }

    // Use manually provided ref number, or generate the next sequential one
    let refNumber;
    if (req.body.refNumber && req.body.refNumber.trim()) {
      refNumber = req.body.refNumber.trim();
      const exists = await Order.findOne({ refNumber });
      if (exists) {
        return res.status(409).json({ error: `Order #${refNumber} already exists.` });
      }
      // Keep counter in sync if manual number is higher
      const num = parseInt(refNumber);
      if (!isNaN(num)) {
        await Counter.findByIdAndUpdate("orderRef",
          [{ $set: { seq: { $max: ["$seq", num] } } }],
          { upsert: true }
        );
      }
    } else {
      refNumber = await generateRefNumber();
      let exists = await Order.findOne({ refNumber });
      while (exists) {
        refNumber = await generateRefNumber();
        exists = await Order.findOne({ refNumber });
      }
    }

    // ── Drive folder name: REF - YEAR MAKE LAST6VIN: CUSTOMER ───────
    const lastSix       = vinInput.slice(-6) || req.body.vin?.slice(-6) || "";
    const yearMakeModel = [req.body.year, req.body.make, req.body.model].filter(Boolean).join(" ");
    const folderName    = [
      `${refNumber} -`,
      yearMakeModel,
      lastSix,
      req.body.customerName ? `: ${req.body.customerName}` : "",
    ].filter(Boolean).join(" ").trim();

    let driveFolder = { id: null, webViewLink: null };
    try {
      driveFolder = await createDriveFolder(folderName, FOLDERS.OUTSTANDING);
    } catch (driveErr) {
      console.warn("Drive folder creation failed (non-fatal):", driveErr.message);
    }

    const order = await Order.create({
      ...req.body,
      vin: vinInput || req.body.vin,
      refNumber,
      driveFolderId:   driveFolder.id   || null,
      driveFolderLink: driveFolder.webViewLink || null,
      timeline: [
        {
          action: "Order Created",
          details: `Order #${refNumber} created. Drive folder: "${folderName}".`,
          createdAt: new Date(),
        },
      ],
    });

    // ── Auto-add or update customer in address book ──────────────────
    if (req.body.customerName) {
      const nameClean = req.body.customerName.trim();
      const needle = nameClean.toLowerCase().replace(/[^a-z0-9]/g, "");

      // Fuzzy match: load all customers and find best overlap
      const allCustomers = await AddressBook.find({ type: "customer" })
        .select("_id companyName phone email defaultPod").lean();

      let bestMatch = null, bestScore = 0;
      for (const c of allCustomers) {
        const hay = (c.companyName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!hay || !needle) continue;
        // Score: longest common prefix length / max length
        let common = 0;
        const minLen = Math.min(needle.length, hay.length);
        for (let i = 0; i < minLen; i++) {
          if (needle[i] === hay[i]) common++; else break;
        }
        // Also check if one contains the other
        const overlap = hay.includes(needle) || needle.includes(hay) ? 0.95 : common / Math.max(needle.length, hay.length);
        if (overlap > bestScore) { bestScore = overlap; bestMatch = c; }
      }

      if (bestMatch && bestScore >= 0.75) {
        // Good match — update missing fields on existing record
        const updates = {};
        if (req.body.customerPhone && !bestMatch.phone) updates.phone = req.body.customerPhone;
        if (req.body.customerEmail && !bestMatch.email) updates.email = req.body.customerEmail;
        if (req.body.pod && !bestMatch.defaultPod)      updates.defaultPod = req.body.pod;
        if (Object.keys(updates).length > 0) {
          await AddressBook.findByIdAndUpdate(bestMatch._id, updates);
        }
      } else {
        // No close match — create new customer
        await AddressBook.create({
          companyName: nameClean,
          phone:      req.body.customerPhone || "",
          email:      req.body.customerEmail || "",
          defaultPod: req.body.pod           || "",
          type:       "customer",
        });
      }
    }

    autoLinkExpenses(order); // non-blocking
    res.status(201).json(order);
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// GET ALL VOYAGE FOLDERS
router.get("/voyages/all", async (req, res) => {
  try {
    let aclFolders = [], sallaumFolders = [];
    try { aclFolders     = await listFoldersInFolder(FOLDERS.ACL); }     catch (e) { console.error("ACL folders error:", e.message); }
    try { sallaumFolders = await listFoldersInFolder(FOLDERS.SALLAUM); } catch (e) { console.error("SALLAUM folders error:", e.message); }

    const voyages = [
      ...aclFolders.map((v) => ({ ...v, shippingLine: "ACL" })),
      ...sallaumFolders.map((v) => ({ ...v, shippingLine: "SALLAUM" })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    res.json(voyages);
  } catch (err) {
    console.error("Voyage folders error:", err);
    res.status(500).json({ error: "Failed to fetch voyage folders" });
  }
});

// CREATE VOYAGE
router.post("/voyages/create", async (req, res) => {
  try {
    const { shippingLine, voyageName } = req.body;

    const cleanLine = (shippingLine || "ACL").toUpperCase();
    const parentId = parentForLine(cleanLine);

    const folder = await createDriveFolder(voyageName, parentId);

    res.json({
      ...folder,
      shippingLine: cleanLine,
    });
  } catch (err) {
    console.error("Create voyage error:", err);
    res.status(500).json({ error: "Failed to create voyage" });
  }
});

// BULK POPULATE OCEAN FREIGHT
router.post("/bulk-populate-ocean", async (req, res) => {
  try {
    const rates = await Pricing.find({ type: "ocean", portPrice: { $gt: 0 } });
    const orders = await Order.find({});
    let updated = 0;
    let skipped = 0;

    for (const order of orders) {
      const pol          = (order.pol          || "").toUpperCase();
      const pod          = (order.pod          || "").toUpperCase();
      const shippingLine = (order.shippingLine || "").toUpperCase();

      if (!pol || !pod) { skipped++; continue; }

      const currentFreight = Number((order.charges || {}).oceanFreight || 0);
      const currentCost    = Number((order.charges || {}).oceanCost    || 0);
      // Skip only if both sell price AND cost are already set
      if (currentFreight > 0 && currentCost > 0) { skipped++; continue; }

      const match =
        rates.find(r =>
          (r.pol          || "").toUpperCase() === pol &&
          (r.pod          || "").toUpperCase() === pod &&
          (r.shippingLine || "").toUpperCase() === shippingLine
        ) ||
        rates.find(r =>
          (r.pol || "").toUpperCase() === pol &&
          (r.pod || "").toUpperCase() === pod
        );

      if (match?.portPrice) {
        const patch = {};
        if (currentFreight === 0 && match.portPrice) patch.oceanFreight = String(match.portPrice);
        if (currentCost    === 0 && match.cost)      patch.oceanCost    = String(match.cost);
        if (!Object.keys(patch).length) { skipped++; continue; }
        order.charges = { ...(order.charges || {}), ...patch };
        order.markModified("charges");
        await order.save();
        updated++;
      } else {
        skipped++;
      }
    }

    res.json({ updated, skipped, total: orders.length });
  } catch (err) {
    console.error("Bulk populate ocean error:", err);
    res.status(500).json({ error: "Failed to bulk populate ocean freight" });
  }
});

// GET ALL ORDERS
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("Get orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// GET SINGLE ORDER
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (err) {
    console.error("Get single order error:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// GET DRIVE FILES
router.get("/:id/drive-files", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.driveFolderId) return res.json([]);
    const files = await listFilesInFolder(order.driveFolderId);
    res.json(files);
  } catch (err) {
    console.error("Drive list files error:", err);
    res.status(500).json({ error: "Failed to list Drive files" });
  }
});

// MOVE ORDER TO VOYAGE
router.post("/:id/move-to-voyage", async (req, res) => {
  try {
    const { voyageFolderId, voyageFolderName, shippingLine } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.driveFolderId) {
      try { await moveDriveFolder(order.driveFolderId, voyageFolderId); } catch (e) {
        console.warn("Drive move failed (non-fatal):", e.message);
      }
    }

    order.status = "Sailed";
    order.voyageFolderId = voyageFolderId;
    order.voyageFolderName = voyageFolderName || "";
    order.shippingLine = shippingLine || order.shippingLine;

    addTimeline(
      order,
      "Moved to Voyage",
      `Shipment folder moved to ${shippingLine} / ${voyageFolderName}. Status changed to Sailed.`
    );

    await order.save();

    res.json(order);
  } catch (err) {
    console.error("Move to voyage error:", err);
    res.status(500).json({ error: "Failed moving order to voyage" });
  }
});

// UPDATE ORDER
router.put("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const oldStatus = order.status;

    Object.assign(order, req.body);
    if (req.body.charges) order.markModified("charges");

    if (req.body.status && req.body.status !== oldStatus) {
      if (order.driveFolderId) {
        const newParentId = folderForStatus(req.body.status);
        try { await moveDriveFolder(order.driveFolderId, newParentId); } catch (e) {
          console.warn("Drive move failed (non-fatal):", e.message);
        }
      }
      addTimeline(
        order,
        "Status Changed",
        `Status changed from ${oldStatus} to ${req.body.status}.`
      );
    }

    await order.save();
    autoLinkExpenses(order); // non-blocking
    res.json(order);
  } catch (err) {
    console.error("Update order error:", err);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// UPLOAD FILE (to Google Drive)
router.post(
  "/:id/upload-drive",
  upload.single("file"),
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // ── Ensure Drive folder exists (create if missing) ────────────────
      if (!order.driveFolderId) {
        const lastSix    = (order.vin || "").slice(-6);
        const yearMake   = [order.year, order.make].filter(Boolean).join(" ");
        const folderName = [
          `${order.refNumber} -`,
          yearMake,
          lastSix,
          order.customerName ? `: ${order.customerName}` : "",
        ].filter(Boolean).join(" ").trim();
        try {
          const folder = await createDriveFolder(folderName, FOLDERS.OUTSTANDING);
          order.driveFolderId   = folder.id;
          order.driveFolderLink = folder.webViewLink;
        } catch (folderErr) {
          console.error("Drive folder creation failed:", folderErr.message);
          if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch (_) {}
          return res.status(500).json({ error: "Could not create Drive folder. Check GOOGLE_REFRESH_TOKEN in .env." });
        }
      }

      // ── Upload file to Drive folder ───────────────────────────────────
      const uploaded = await uploadFileToDrive(
        req.file.path,
        req.file.originalname,
        req.file.mimetype,
        order.driveFolderId
      );

      if (!order.files) {
        order.files = [];
      }

      order.files.push({
        label:        req.body.label || "Document",
        originalName: req.file.originalname,
        filename:     uploaded.name,
        driveFileId:  uploaded.id,
        path:         uploaded.webViewLink,
        mimetype:     req.file.mimetype,
      });

      const label = req.body.label || "Document";

      addTimeline(
        order,
        "File Uploaded",
        `${label} uploaded: ${req.file.originalname}.`
      );

      try {
        if (label === "AES") {
          const parsed = await parseAES(req.file.path);
          const updates = [];

          // Always save the full DR fields from AES (overwrite blanks, keep existing)
          const aesFields = [
            "bookingNumber","vin","year","make","model","pol","pod",
            "exporterName","exporterAddress","exporterCity","exporterState","exporterZip","exporterCountry",
            "consigneeName","consigneeAddress","consigneeCity","consigneeCountry",
            "vessel","aesItn","weightKgs","value","vehicleYearMakeModel",
          ];
          for (const field of aesFields) {
            if (parsed[field] && !order[field]) {
              order[field] = parsed[field];
              updates.push(field);
            }
          }

          addTimeline(
            order,
            "AES Parsed",
            updates.length
              ? `AES parsed and updated: ${updates.join(", ")}.`
              : "AES parsed but no empty order fields needed updating."
          );
        }

        if (label === "Dispatch") {
          const parsed = await parseDispatch(req.file.path);
          const updates = [];

          const dispatchFields = [
            "vin","year","make","model","condition",
            "pickupLocation","pickupName","pickupAddress","pickupCity","pickupState","pickupZip",
            "deliveryLocation","deliveryName","deliveryAddress","deliveryCity","deliveryState","deliveryZip",
            "weightKgs",
          ];
          for (const field of dispatchFields) {
            const val = parsed[field] || parsed.dispatchVin && field === "vin" ? (parsed[field] || parsed.dispatchVin) : null;
            if (val && !order[field]) {
              if (field === "condition" && order.condition && order.condition !== "Runner") continue;
              order[field] = val;
              updates.push(field);
            }
          }
          if (parsed.dispatchWeightKgs && !order.weightKgs) {
            order.weightKgs = parsed.dispatchWeightKgs;
          }

          // Towing cost verification — attach to response but don't auto-save
          if (parsed.dispatchTowingCost) {
            const storedCost   = Number((order.charges || {}).towingCost   || 0);
            const storedCharge = Number((order.charges || {}).towingCharge || 0);
            // Only flag a mismatch if the dispatch cost doesn't match EITHER
            // the stored sell price (towingCharge) OR the stored cost (towingCost).
            // If towingCharge already matches, the rate is correct — no popup needed.
            const alreadyMatches = parsed.dispatchTowingCost === storedCharge ||
                                   parsed.dispatchTowingCost === storedCost;
            if (!alreadyMatches) {
              req._towingCostVerification = {
                dispatchCost: parsed.dispatchTowingCost,
                currentCost:  storedCost || storedCharge,
                pickupCity:   order.pickupCity || (order.pickupLocation || "").replace(/^COPART[\s\-–,]+/i,"").split(/[\s,]+/)[0] || "",
                pol:          order.pol || "",
              };
            }
          }

          addTimeline(
            order,
            "Dispatch Parsed",
            updates.length
              ? `Dispatch parsed and updated: ${updates.join(", ")}.`
              : "Dispatch parsed but no empty order fields needed updating."
          );
        }
      } catch (parseErr) {
        console.error("Parse error:", parseErr);

        addTimeline(
          order,
          "Parse Failed",
          `${label} uploaded, but automatic parsing failed.`
        );
      }

      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch (_) {}

      await order.save();

      res.json({
        ...order.toObject(),
        towingCostVerification: req._towingCostVerification || null,
      });
    } catch (err) {
      console.error("Drive upload error:", err);
      if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch (_) {}
      res.status(500).json({
        error: "Drive upload failed: " + err.message,
      });
    }
  }
);

// PARSE EXISTING DRIVE FILES
router.post("/:id/parse-drive-files", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (!order.driveFolderId) {
      return res.status(400).json({ error: "Order has no Drive folder" });
    }

    const files = await listFilesInFolder(order.driveFolderId);
    const pdfs  = files.filter(f => (f.name || "").toLowerCase().endsWith(".pdf"));

    let parsedSomething = false;

    for (const file of pdfs) {
      const name     = file.name.toLowerCase();
      const tempPath = path.join(__dirname, "..", "temp", `${file.id}.pdf`);

      await downloadDriveFile(file.id, tempPath);

      if (name.includes("aes")) {
        const parsed  = await parseAES(tempPath);
        const updates = [];
        const aesFields = [
          "bookingNumber","vin","year","make","model","pol","pod",
          "exporterName","exporterAddress","exporterCity","exporterState","exporterZip","exporterCountry",
          "consigneeName","consigneeAddress","consigneeCity","consigneeCountry",
          "vessel","aesItn","weightKgs","value","vehicleYearMakeModel",
        ];
        for (const field of aesFields) {
          if (parsed[field] && !order[field]) { order[field] = parsed[field]; updates.push(field); }
        }
        addTimeline(order, "AES Parsed",
          updates.length
            ? `Drive AES parsed and updated: ${updates.join(", ")}.`
            : `Drive AES parsed from ${file.name} — no empty fields needed updating.`
        );
        parsedSomething = true;
      }

      if (name.includes("dispatch") || name.includes("pickup") || name.includes("sheet")) {
        const parsed  = await parseDispatch(tempPath);
        const updates = [];
        const dispatchFields = [
          "vin","year","make","model","condition",
          "pickupLocation","pickupName","pickupAddress","pickupCity","pickupState","pickupZip",
          "deliveryLocation","deliveryName","deliveryAddress","deliveryCity","deliveryState","deliveryZip",
        ];
        for (const field of dispatchFields) {
          const val = parsed[field] || (field === "vin" ? parsed.dispatchVin : null);
          if (val && !order[field]) {
            if (field === "condition" && order.condition && order.condition !== "Runner") continue;
            order[field] = val; updates.push(field);
          }
        }
        if (parsed.dispatchWeightKgs && !order.weightKgs) order.weightKgs = parsed.dispatchWeightKgs;

        let towingCostVerification = null;
        if (parsed.dispatchTowingCost) {
          const storedCost   = Number((order.charges || {}).towingCost   || 0);
          const storedCharge = Number((order.charges || {}).towingCharge || 0);
          const alreadyMatches = parsed.dispatchTowingCost === storedCharge ||
                                 parsed.dispatchTowingCost === storedCost;
          if (!alreadyMatches) {
            towingCostVerification = {
              dispatchCost: parsed.dispatchTowingCost,
              currentCost:  storedCost || storedCharge,
              pickupCity:   order.pickupCity || (order.pickupLocation || "").replace(/^COPART[\s\-–,]+/i,"").split(/[\s,]+/)[0] || "",
              pol:          order.pol || "",
            };
          }
        }
        addTimeline(order, "Dispatch Parsed",
          updates.length
            ? `Drive dispatch parsed and updated: ${updates.join(", ")}.`
            : `Drive dispatch parsed from ${file.name} — no empty fields needed updating.`
        );
        parsedSomething = true;

        try { fs.unlinkSync(tempPath); } catch (_) {}

        if (towingCostVerification) {
          await order.save();
          return res.json({ ...order.toObject(), towingCostVerification });
        }
        continue;
      }

      try { fs.unlinkSync(tempPath); } catch (_) {}
    }

    if (!parsedSomething) {
      addTimeline(order, "Parse Attempted", "No AES or dispatch PDF was found in the Drive folder.");
    }

    await order.save();
    res.json({ ...order.toObject(), towingCostVerification: null });
  } catch (err) {
    console.error("Parse existing Drive files error:", err);
    res.status(500).json({ error: "Failed to parse existing Drive files" });
  }
});

// UPDATE TOWING COST ON ORDER + OPTIONALLY SYNC PRICING TABLE
router.post("/:id/confirm-towing-cost", async (req, res) => {
  try {
    const { towingCost, updatePricingTable, pickupCity, pol } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Update this order's towing cost (and sell price if not already set)
    const existingCharge = Number((order.charges || {}).towingCharge || 0);
    order.charges = {
      ...(order.charges || {}),
      towingCost:   String(towingCost),
      // If no sell price was ever set, use dispatch cost as the sell price too
      towingCharge: existingCharge > 0 ? String(existingCharge) : String(towingCost),
    };
    order.markModified("charges");
    addTimeline(order, "Towing Cost Updated", `Towing cost set to $${towingCost} from dispatch sheet.`);
    await order.save();

    // Optionally update pricing table
    if (updatePricingTable && pickupCity) {
      const normCity = s => (s || "").replace(/[^A-Z0-9 ]/gi, "").trim().toUpperCase();
      const rate = await Pricing.findOne({ type: "towing" }).then(async () => {
        // Find best match: city+port, then city-only
        const all = await Pricing.find({ type: "towing" });
        return all.find(r =>
          normCity(r.city) === normCity(pickupCity) &&
          (r.port || "").toUpperCase() === (pol || "").toUpperCase()
        ) || all.find(r =>
          normCity(r.city) === normCity(pickupCity) && !r.port
        ) || all.find(r =>
          normCity(r.city) === normCity(pickupCity)
        );
      });

      if (rate) {
        rate.cost = towingCost;
        await rate.save();
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Confirm towing cost error:", err);
    res.status(500).json({ error: "Failed to update towing cost" });
  }
});

// CLEAR VOYAGE / MOVE BACK TO WAITING TO SAIL
router.post("/:id/clear-voyage", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    if (order.driveFolderId) {
      try {
        await moveDriveFolder(order.driveFolderId, FOLDERS.WAITING_TO_SAIL);
      } catch (e) {
        console.warn("Drive move failed (non-fatal):", e.message);
      }
    }

    order.status = "Waiting to Sail";
    order.voyageFolderId = "";
    order.voyageFolderName = "";
    order.vessel = "";
    order.voyage = "";
    order.cutoffDate = "";
    order.sailDate = "";
    order.arrivalDate = "";

    addTimeline(
      order,
      "Voyage Cleared",
      "Voyage assignment removed. Shipment moved back to Waiting to Sail."
    );

    await order.save();

    res.json(order);
  } catch (err) {
    console.error("Clear voyage error:", err);

    res.status(500).json({
      error: "Failed to clear voyage",
    });
  }
});

// GENERATE INVOICE PDF
router.post("/:id/generate-invoice", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    const { invoiceItems } = req.body;

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
    });

    const fileName = `Invoice-${order.refNumber || order._id}.pdf`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    res.setHeader(
      "Content-Type",
      "application/pdf"
    );

    doc.pipe(res);

    // =========================
    // HEADER
    // =========================

    doc
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("INVOICE", 400, 50);

    doc
      .fontSize(11)
      .font("Helvetica");

    // LEFT COMPANY INFO

    // LEFT COMPANY INFO

const fs = require("fs");

const logoPath = path.join(__dirname, "../logo.png");

if (fs.existsSync(logoPath)) {
  doc.image(logoPath, 50, 40, {
    width: 95,
  });
}

doc.text("Dor L'Dor Global LLC", 50, 125);

    doc.text("23 GALAHAD DR");

    doc.text("Manalapan, New Jersey 07726");

    doc.text("United States");

    doc.text("9172003998");

    // =========================
    // BILL TO
    // =========================

    doc
      .moveDown(3)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("BILL TO", 50);

    doc.moveDown(0.5);

    doc
      .font("Helvetica")
      .fontSize(11);

    doc.text(order.customerName || "");

    if (order.customerAddress) {
      doc.text(order.customerAddress);
    }

    if (order.customerCity) {
      doc.text(order.customerCity);
    }

    if (order.customerCountry) {
      doc.text(order.customerCountry);
    }

    if (order.customerEmail) {
      doc.text(order.customerEmail);
    }

    // =========================
    // INVOICE DETAILS RIGHT
    // =========================

    const rightX = 360;

    doc
      .font("Helvetica-Bold")
      .text("Invoice Number:", rightX, 145);

    doc
      .font("Helvetica")
      .text(order.refNumber || "", 470, 145);

    doc
      .font("Helvetica-Bold")
      .text("Invoice Date:", rightX, 165);

    doc
      .font("Helvetica")
      .text(
        new Date().toLocaleDateString(),
        470,
        165
      );

    doc
      .font("Helvetica-Bold")
      .text("Amount Due (USD):", rightX, 185);

    // =========================
    // TOTAL CALC
    // =========================

    let total = 0;

    invoiceItems.forEach((item) => {
      total += Number(item.amount || 0);
    });

    doc
      .font("Helvetica-Bold")
      .text(
        `$${total.toLocaleString(undefined, {
          minimumFractionDigits: 2,
        })}`,
        470,
        185
      );

    // =========================
    // VEHICLE INFO
    // =========================

    doc.moveDown(4);

    doc
  .font("Helvetica-Bold")
  .fontSize(10)
  .text(
    `Vehicle: ${order.year || ""} ${order.make || ""} ${order.model || ""}`,
    rightX,
    215
  );

doc
  .font("Helvetica")
  .fontSize(10)
  .text(
    `VIN: ${order.vin || ""}`,
    rightX,
    233
  );

doc
  .font("Helvetica")
  .fontSize(10)
  .text(
    `Booking #: ${order.bookingNumber || ""}`,
    rightX,
    251
  );

    // =========================
    // TABLE HEADER
    // =========================

    const tableTop = 340;

    doc
      .font("Helvetica-Bold")
      .fontSize(11);

    doc.text("Description", 50, tableTop);

    doc.text("Quantity", 360, tableTop);

    doc.text("Price", 430, tableTop);

    doc.text("Amount", 500, tableTop);

    doc.moveTo(50, tableTop + 18)
      .lineTo(560, tableTop + 18)
      .stroke();

    // =========================
    // ITEMS
    // =========================

    let y = tableTop + 35;

    doc.font("Helvetica");

    invoiceItems.forEach((item) => {
      const amount = Number(item.amount || 0);

      doc.text(item.description || "", 50, y, {
        width: 280,
      });

      doc.text("1", 370, y);

      doc.text(
        `$${amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
        })}`,
        425,
        y
      );

      doc.text(
        `$${amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
        })}`,
        495,
        y
      );

      y += 28;
    });

    // =========================
    // TOTAL
    // =========================

    y += 20;

    doc.moveTo(380, y)
      .lineTo(560, y)
      .stroke();

    y += 12;

    doc
      .font("Helvetica-Bold")
      .fontSize(14);

    doc.text(
      `Total: $${total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`,
      400,
      y
    );

    y += 30;

    doc.text(
      `Amount Due (USD): $${total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`,
      320,
      y
    );

    doc.end();
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to generate invoice",
    });
  }
});

// GENERATE INVOICE PDF AND SAVE LOCALLY
router.post("/:id/generate-invoice-drive", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { invoiceItems } = req.body;

    const fileName = `Invoice-${order.refNumber || order._id}.pdf`;
    const tempPath = path.join(__dirname, "..", "temp", fileName);

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
    });

    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);

    // HEADER
    doc
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("INVOICE", 400, 50);

    doc.fontSize(11).font("Helvetica");

    // LOGO + COMPANY INFO
    const logoPath = path.join(__dirname, "../logo.png");

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 40, {
        width: 95,
      });

      doc.text("Dor L'Dor Global LLC", 50, 125);
    } else {
      doc.text("Dor L'Dor Global LLC", 50, 55);
    }

    doc.text("23 GALAHAD DR");
    doc.text("Manalapan, New Jersey 07726");
    doc.text("United States");
    doc.text("9172003998");

    // BILL TO
    doc
      .moveDown(3)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("BILL TO", 50);

    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);

    doc.text(order.customerName || "");

    if (order.customerEmail) {
      doc.text(order.customerEmail);
    }

    // INVOICE DETAILS RIGHT
    const rightX = 360;

    let total = 0;

    invoiceItems.forEach((item) => {
      total += Number(item.amount || 0);
    });

    doc.font("Helvetica-Bold").text("Invoice Number:", rightX, 145);
    doc.font("Helvetica").text(order.refNumber || "", 470, 145);

    doc.font("Helvetica-Bold").text("Invoice Date:", rightX, 165);
    doc.font("Helvetica").text(new Date().toLocaleDateString(), 470, 165);

    doc.font("Helvetica-Bold").text("Amount Due (USD):", rightX, 185);
    doc.font("Helvetica-Bold").text(
      `$${total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`,
      470,
      185
    );

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(
        `Vehicle: ${order.year || ""} ${order.make || ""} ${order.model || ""}`,
        rightX,
        215
      );

    doc
      .font("Helvetica")
      .fontSize(10)
      .text(`VIN: ${order.vin || ""}`, rightX, 233);

    doc
      .font("Helvetica")
      .fontSize(10)
      .text(`Booking #: ${order.bookingNumber || ""}`, rightX, 251);

    // TABLE
    const tableTop = 340;

    doc.font("Helvetica-Bold").fontSize(11);

    doc.text("Description", 50, tableTop);
    doc.text("Quantity", 360, tableTop);
    doc.text("Price", 430, tableTop);
    doc.text("Amount", 500, tableTop);

    doc.moveTo(50, tableTop + 18).lineTo(560, tableTop + 18).stroke();

    let y = tableTop + 35;

    doc.font("Helvetica");

    invoiceItems.forEach((item) => {
      const amount = Number(item.amount || 0);

      doc.text(item.description || "", 50, y, {
        width: 280,
      });

      doc.text("1", 370, y);

      doc.text(
        `$${amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
        })}`,
        425,
        y
      );

      doc.text(
        `$${amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
        })}`,
        495,
        y
      );

      y += 28;
    });

    y += 20;

    doc.moveTo(380, y).lineTo(560, y).stroke();

    y += 12;

    doc.font("Helvetica-Bold").fontSize(14);

    doc.text(
      `Total: $${total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`,
      400,
      y
    );

    y += 30;

    doc.text(
      `Amount Due (USD): $${total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`,
      320,
      y
    );

    doc.end();

    stream.on("finish", async () => {
      // Copy PDF from temp to local uploads dir
      const dir      = orderUploadsDir(req.params.id);
      const destPath = path.join(dir, fileName);
      fs.copyFileSync(tempPath, destPath);
      try { fs.unlinkSync(tempPath); } catch (_) {}

      const fileUrl = `http://localhost:4000/uploads/${req.params.id}/${encodeURIComponent(fileName)}`;

      if (!order.files) order.files = [];
      order.files.push({
        label:        "Invoice",
        originalName: fileName,
        filename:     fileName,
        path:         fileUrl,
        mimetype:     "application/pdf",
      });

      addTimeline(order, "Invoice Generated", `${fileName} generated and saved.`);
      await order.save();

      res.json({
        success:  true,
        fileName,
        fileUrl,
        order,
      });
    });
  } catch (err) {
    console.error("Generate invoice Drive error:", err);

    res.status(500).json({
      error: "Failed to generate invoice and save to Drive",
    });
  }
});

// DELETE ORDER
router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Delete the Drive folder (and all its contents) if one was created
    if (order.driveFolderId) {
      try {
        await deleteDriveFolder(order.driveFolderId);
      } catch (driveErr) {
        // Log but don't block the DB delete — folder may already be gone
        console.warn(`Drive folder delete failed for order ${order.refNumber}:`, driveErr.message);
      }
    }

    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, refNumber: order.refNumber });
  } catch (err) {
    console.error("Delete order error:", err);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// ── DEBUG: inspect raw AES text + parsed output ──
router.get("/:id/debug-aes", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order || !order.driveFolderId) return res.status(404).json({ error: "No order/folder" });

    const files  = await listFilesInFolder(order.driveFolderId);
    const aesPdf = files.find(f =>
      (f.name || "").toLowerCase().includes("aes") &&
      (f.name || "").toLowerCase().endsWith(".pdf")
    );
    if (!aesPdf) return res.status(404).json({ error: "No AES PDF found", files: files.map(f => f.name) });

    const tempPath = path.join(__dirname, "..", "temp", `debug_${aesPdf.id}.pdf`);
    await downloadDriveFile(aesPdf.id, tempPath);

    const pdfParse = require("pdf-parse");
    const buf      = fs.readFileSync(tempPath);
    const data     = await pdfParse(buf);
    const rawText  = data.text || "";
    fs.unlinkSync(tempPath);

    const tempPath2 = path.join(__dirname, "..", "temp", `debug2_${aesPdf.id}.pdf`);
    await downloadDriveFile(aesPdf.id, tempPath2);
    const parsed = await parseAES(tempPath2);
    try { fs.unlinkSync(tempPath2); } catch (_) {}

    res.json({
      fileName:         aesPdf.name,
      rawTextFirst3000: rawText.slice(0, 3000),
      lines:            rawText.split(/\r?\n/).filter(l => l.trim()).slice(0, 80),
      parsed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DR PAYLOAD — parse fresh from local uploads + schedule DB ──
router.get("/:id/dr-payload", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const ScheduleRow = require("../models/Schedule");
    const o = order.toObject ? order.toObject() : { ...order };

    // ── Step 1: Parse AES + Dispatch fresh from Drive ──────────────────
    let aesData = {};
    let dispatchData = {};

    if (order.driveFolderId) {
      try {
        const files = await listFilesInFolder(order.driveFolderId);
        const pdfs  = files.filter(f => (f.name || "").toLowerCase().endsWith(".pdf"));

        for (const file of pdfs) {
          const name     = file.name.toLowerCase();
          const tempPath = path.join(__dirname, "..", "temp", `dr_${file.id}.pdf`);
          try {
            await downloadDriveFile(file.id, tempPath);
            if (name.includes("aes")) {
              aesData = await parseAES(tempPath);
            }
            if (name.includes("dispatch") || name.includes("sheet") || name.includes("pickup")) {
              dispatchData = await parseDispatch(tempPath);
            }
          } catch (e) {
            console.error(`Failed to parse ${file.name}:`, e.message);
          } finally {
            try { fs.unlinkSync(tempPath); } catch (_) {}
          }
        }
      } catch (e) {
        console.error("Drive file listing failed:", e.message);
      }
    }

    // ── Step 2: Schedule lookup from master-schedule.xlsx ────────────
    const vessel = aesData.vessel || o.vessel || "";
    const polNorm = (aesData.portOfLoading || aesData.pol || o.pol || "").toUpperCase();
    const podNorm = (aesData.portOfDischarge || aesData.pod || o.pod || "").toUpperCase();
    let scheduleData = {};

    if (vessel && polNorm && podNorm) {
      try {
        const lookupRes = await fetch(
          `http://localhost:4000/api/schedule/lookup?vessel=${encodeURIComponent(vessel)}&pol=${encodeURIComponent(polNorm)}&pod=${encodeURIComponent(podNorm)}`
        );
        const lookupData = await lookupRes.json();
        if (lookupData.found) {
          scheduleData = {
            voyage:      lookupData.voyage      || "",
            cutoffDate:  lookupData.cutoffDate  || "",
            sailDate:    lookupData.sailDate    || "",
            arrivalDate: lookupData.arrivalDate || "",
          };
        }
      } catch (e) {
        console.error("Schedule lookup failed in dr-payload:", e.message);
      }
    }

    // ── Step 3: Merge — AES/Dispatch win over stale order fields ──────
    // cleanSpread filters undefined/null/"" so we never override real values with nothing
    const cleanAes      = cleanSpread(aesData);
    const cleanDispatch = cleanSpread(dispatchData);

    const payload = {
      // order base
      ...o,
      referenceNumber: o.refNumber || o.referenceNumber,
      // AES data (overwrites order fields where AES has real values)
      ...cleanAes,
      // Dispatch data (overwrites where dispatch has real values)
      ...cleanDispatch,
      // Schedule
      ...cleanSpread(scheduleData),
      // Explicitly preserve condition + titleStatus from order if dispatch didn't supply them
      condition:   cleanDispatch.condition   || o.condition   || "Runner",
      titleStatus: cleanDispatch.titleStatus || o.titleStatus || "Pending",
      // Normalised port aliases
      portOfLoading:   cleanAes.pol || o.pol || "",
      portOfDischarge: cleanAes.pod || o.pod || "",
      pol: cleanAes.pol || o.pol || "",
      pod: cleanAes.pod || o.pod || "",
      // vehicleYearMakeModel fallback
      vehicleYearMakeModel:
        cleanAes.vehicleYearMakeModel ||
        o.vehicleYearMakeModel ||
        [cleanAes.year || o.year, cleanAes.make || o.make, cleanAes.model || o.model]
          .filter(Boolean).join(" "),
    };

    res.json(payload);
  } catch (err) {
    console.error("DR payload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE FILE — removes from Google Drive and from order.files
router.delete("/:id/files/:driveFileId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const fileId   = req.params.driveFileId;
    const fileName = req.query.name || fileId;

    // Delete from Drive
    try {
      await drive.files.delete({ fileId });
    } catch (e) {
      console.warn("Drive delete failed (non-fatal):", e.message);
    }

    // Remove from order.files — match by stored driveFileId or by webViewLink containing the ID
    order.files = (order.files || []).filter(f => {
      if (f.driveFileId === fileId) return false;
      if ((f.path || "").includes(fileId)) return false;
      return true;
    });

    addTimeline(order, "File Deleted", `File deleted: ${fileName}`);
    await order.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Delete file error:", err);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// POST /:id/timeline — add a timeline entry
router.post("/:id/timeline", express.json(), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Not found" });
    const { action, details } = req.body;
    order.timeline.push({ action, details, createdAt: new Date() });
    await order.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;