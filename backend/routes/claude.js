const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const Groq = require("groq-sdk");
const Order = require("../models/Order");
const Expense = require("../models/Expense");
const ScheduleRow = require("../models/Schedule");
const AddressBook = require("../models/AddressBook");
const AiRule = require("../models/AiRule");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";

async function pdfText(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

async function aiJSON(systemPrompt, userContent) {
  const res = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });
  return JSON.parse(res.choices[0].message.content);
}

async function aiText(messages) {
  const res = await groq.chat.completions.create({ model: MODEL, messages, temperature: 0.3 });
  return res.choices[0].message.content;
}

// ── RORO delivery logic ───────────────────────────────────────────────────────
const DELIVERY_BY_REGION = [
  {
    states: ["tx","texas","la","louisiana","ms","mississippi","al","alabama","ga","georgia","fl","florida","ar","arkansas","ok","oklahoma","tn","tennessee","sc","south carolina","nc","north carolina","mo","missouri"],
    delivery: { deliveryName:"ACL Freeport", deliveryAddress:"1 Port Road", deliveryCity:"Freeport", deliveryState:"TX", deliveryZip:"77541" },
  },
  {
    states: ["nj","new jersey","ny","new york","ct","connecticut","ma","massachusetts","ri","rhode island","pa","pennsylvania","de","delaware","md","maryland","va","virginia","nh","new hampshire","me","maine","vt","vermont"],
    delivery: { deliveryName:"ACL Baltimore", deliveryAddress:"2001 E McComas St", deliveryCity:"Baltimore", deliveryState:"MD", deliveryZip:"21230" },
  },
  {
    states: ["ca","california","az","arizona","nv","nevada","nm","new mexico","ut","utah","co","colorado","or","oregon","wa","washington","id","idaho"],
    delivery: { deliveryName:"ACL Baltimore", deliveryAddress:"2001 E McComas St", deliveryCity:"Baltimore", deliveryState:"MD", deliveryZip:"21230" },
  },
];

const AFRICA_PODS = ["TEMA","LAGOS","COTONOU","LOME","DAKAR","ABIDJAN","DURBAN","DOUALA"];

function applyRoroDelivery(result) {
  if (result.deliveryName) return; // already set
  const pod = (result.pod || "").toUpperCase();
  if (!AFRICA_PODS.includes(pod)) return;
  const state = (result.pickupState || "").toLowerCase();
  if (!state) return;

  for (const region of DELIVERY_BY_REGION) {
    if (region.states.some(s => state.includes(s))) {
      Object.assign(result, region.delivery);
      return;
    }
  }
}

// ── Address book lookup helper ────────────────────────────────────────────────
async function enrichFromAddressBook(result) {
  if (!result.customerName) return result;
  const needle = result.customerName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const contacts = await AddressBook.find({ type: { $in: ["customer", "Customer"] } })
    .select("companyName address city state postalCode country defaultPod").lean();
  let best = null, bestScore = 0;
  for (const c of contacts) {
    const hay = (c.companyName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    let matches = 0;
    for (let i = 0; i < needle.length - 2; i++) {
      if (hay.includes(needle.slice(i, i + 3))) matches++;
    }
    const score = needle.length > 2 ? matches / (needle.length - 2) : 0;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best && bestScore > 0.5) {
    if (!result.consigneeName)    result.consigneeName    = best.companyName || "";
    if (!result.consigneeAddress) result.consigneeAddress = best.address     || "";
    if (!result.consigneeCity)    result.consigneeCity    = best.city        || "";
    if (!result.consigneeState)   result.consigneeState   = best.state       || "";
    if (!result.consigneeZip)     result.consigneeZip     = best.postalCode  || "";
    if (!result.consigneeCountry) result.consigneeCountry = best.country     || "";
    if (!result.pod && best.defaultPod) result.pod        = best.defaultPod;
    result._addressBookMatch = best.companyName;
  }
  return result;
}

// ── POST /api/claude/parse-dispatch ──────────────────────────────────────────
router.post("/parse-dispatch", upload.single("file"), async (req, res) => {
  try {
    const text = req.file ? await pdfText(req.file.buffer) : req.body.text;
    if (!text) return res.status(400).json({ error: "file or text required" });
    const result = await aiJSON(
      "You are a logistics document parser. Return ONLY a JSON object with these keys (empty string if not found, 0 for total): vin, ymm, total, loadId, dispatchDate, origin, carrier",
      `Extract from this dispatch document:\n\n${text.slice(0, 6000)}`
    );
    res.json({ vin: result.vin || "", ymm: result.ymm || "", total: parseFloat(result.total) || 0, loadId: result.loadId || "", dispatchDate: result.dispatchDate || "", origin: result.origin || "", carrier: result.carrier || "", vendor: result.carrier || "" });
  } catch (err) {
    console.error("parse-dispatch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/claude/autofill — used by CreateOrder ──────────────────────────
router.post("/autofill", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });
    const text = req.file.mimetype === "application/pdf"
      ? await pdfText(req.file.buffer)
      : req.file.buffer.toString("utf8");

    // Load any saved rules for this doc type
    const allRules = await AiRule.find({}).lean();
    const rulesText = allRules.length
      ? "\n\nSAVED EXTRACTION RULES:\n" + allRules.map(r => `[${r.docType}]: ${r.instructions}`).join("\n")
      : "";

    const result = await aiJSON(
      `You are a logistics document parser for an auto transport/export company.
Extract order fields from the document. Return ONLY a JSON object with these keys (empty string if not found):
customerName, customerPhone (buyer's phone only, not auction/branch phone), customerEmail,
consigneeName, consigneeAddress, consigneeCity, consigneeState, consigneeZip, consigneeCountry,
exporterName, exporterAddress, exporterCity, exporterState, exporterZip, exporterCountry,
year, make, model, vin, color,
pickupName (auction/branch name), pickupAddress, pickupCity, pickupState, pickupZip,
deliveryAddress, deliveryCity, deliveryState, deliveryZip,
vessel, voyage, bookingNumber, pol, pod, cutoffDate, sailDate, notes${rulesText}`,
      `Extract from this shipping document:\n\n${text.slice(0, 8000)}`
    );

    // ── Buyer account → customer lookup ──────────────────────────────
    if (result.customerName) {
      const buyerName = result.customerName; // what the receipt says
      const customerLookup = await AddressBook.findOne({
        type: "customer",
        buyerAccounts: { $elemMatch: { $regex: buyerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      }).lean();

      if (customerLookup) {
        // We know who the real customer is — keep buyer name separate
        result.buyerName    = buyerName;
        result.customerName = customerLookup.companyName;
        result.customerPhone = result.customerPhone || customerLookup.phone || "";
        result.customerEmail = result.customerEmail || customerLookup.email || "";
        if (!result.pod && customerLookup.defaultPod) result.pod = customerLookup.defaultPod;
        result._buyerAccountMatch = customerLookup.companyName;
      } else {
        // No mapping yet — use buyer name as customer, store as buyerName too
        result.buyerName = buyerName;
      }
    }

    await enrichFromAddressBook(result);
    applyRoroDelivery(result);
    res.json(result);
  } catch (err) {
    console.error("autofill error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/claude/upload-chat — AI Assistant doc upload + conversation ─────
// Accepts: file (optional), message, history, docText (if re-using prior upload)
router.post("/upload-chat", upload.single("file"), async (req, res) => {
  try {
    let docText = req.body.docText || "";
    let docType = req.body.docType || "";
    let fileName = req.body.fileName || "";

    // If a new file was uploaded, extract its text
    if (req.file) {
      fileName = req.file.originalname || "document";
      docText = req.file.mimetype === "application/pdf"
        ? await pdfText(req.file.buffer)
        : req.file.buffer.toString("utf8");

      // Auto-detect document type — check filename first to avoid misclassifying generated invoices
      if (/^Invoice-/i.test(fileName)) {
        docType = "Invoice";
      } else {
        const typeResult = await aiJSON(
          `Identify the type of this logistics document. Return JSON: { "docType": "..." }
Common types: "IAA Buyer Receipt", "IAAI Buyer Receipt", "Copart Buyer Receipt", "Dispatch Sheet", "Bill of Lading", "Booking Confirmation", "AES Export", "Invoice", "Other"`,
          `Document text:\n${docText.slice(0, 3000)}`
        );
        docType = typeResult.docType || "Unknown Document";
      }
    }

    const message = req.body.message || "";
    let history = [];
    try { history = JSON.parse(req.body.history || "[]"); } catch {}

    // Load any saved rules for this doc type
    const savedRule = docType ? await AiRule.findOne({ docType }).lean() : null;
    const savedInstructions = savedRule?.instructions || "";

    const systemPrompt = `You are the DDG AI Assistant — a smart logistics document processor and Q&A assistant for DDG Global Logistics.

When given a document, extract ALL relevant order fields and present them clearly grouped by category.
When the user corrects you or asks for more fields, re-extract and include the correction.
When the user says "remember this", "save this", or "use this next time", respond with:
<SAVE_RULE>{"docType":"${docType || "Unknown"}","instructions":"[precise rule text]"}</SAVE_RULE>

STANDARD FIELDS TO EXTRACT (use empty string if not found):
customerName, customerPhone (buyer's phone ONLY — never the auction/branch/seller phone), customerEmail,
consigneeName, consigneeAddress, consigneeCity, consigneeState, consigneeZip, consigneeCountry,
exporterName, exporterAddress, exporterCity, exporterState, exporterZip, exporterCountry,
year, make, model, vin, color, mileage,
lotNumber (stock/lot number — strip any leading "000-" prefix),
bidAmount (the bid/purchase price as a number),
pickupName, pickupAddress, pickupCity, pickupState, pickupZip,
deliveryName, deliveryAddress, deliveryCity, deliveryState, deliveryZip,
vessel, voyage, bookingNumber, pol, pod, cutoffDate, sailDate, notes.

${savedInstructions ? `MANDATORY RULES FOR ${docType} — ALWAYS APPLY THESE:\n${savedInstructions}\n` : ""}
Always include a JSON block at the END of your extraction response:
<EXTRACTED_FIELDS>{"customerName":"...","year":"...","lotNumber":"...",...}</EXTRACTED_FIELDS>`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

    // If there's a new file or the user's first message references a doc, inject doc text
    if (docText && (req.file || history.length === 0)) {
      messages.push({
        role: "user",
        content: `I've uploaded "${fileName}" (${docType}).\n\n${message || "Please extract all the order fields from this document."}\n\nDOCUMENT TEXT:\n${docText.slice(0, 8000)}`
      });
    } else if (message) {
      // Follow-up message in the same doc conversation
      if (docText) {
        messages.push({
          role: "user",
          content: `${message}\n\n(Document context: ${docType})\nDOCUMENT TEXT:\n${docText.slice(0, 8000)}`
        });
      } else {
        messages.push({ role: "user", content: message });
      }
    }

    const reply = await aiText(messages);

    // Check if AI wants to save a rule
    const saveMatch = reply.match(/<SAVE_RULE>([\s\S]*?)<\/SAVE_RULE>/);
    if (saveMatch) {
      try {
        const rule = JSON.parse(saveMatch[1]);
        if (rule.docType && rule.instructions) {
          await AiRule.findOneAndUpdate(
            { docType: rule.docType },
            { instructions: rule.instructions },
            { upsert: true, new: true }
          );
        }
      } catch {}
    }

    // Extract fields JSON if present
    const fieldsMatch = reply.match(/<EXTRACTED_FIELDS>([\s\S]*?)<\/EXTRACTED_FIELDS>/);
    let extractedFields = null;
    if (fieldsMatch) {
      try {
        extractedFields = JSON.parse(fieldsMatch[1]);

        // Buyer account → customer lookup
        if (extractedFields.customerName) {
          const buyerName = extractedFields.customerName;
          const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const customerLookup = await AddressBook.findOne({
            type: "customer",
            buyerAccounts: { $elemMatch: { $regex: esc(buyerName), $options: "i" } },
          }).lean();
          if (customerLookup) {
            extractedFields.buyerName    = buyerName;
            extractedFields.customerName = customerLookup.companyName;
            extractedFields._buyerAccountMatch = customerLookup.companyName;
            if (!extractedFields.pod && customerLookup.defaultPod) extractedFields.pod = customerLookup.defaultPod;
          } else {
            extractedFields.buyerName = buyerName;
          }
        }

        await enrichFromAddressBook(extractedFields);
        applyRoroDelivery(extractedFields);
      } catch {}
    }

    // Clean reply for display (remove raw XML tags)
    const cleanReply = reply
      .replace(/<SAVE_RULE>[\s\S]*?<\/SAVE_RULE>/g, "\n✅ Rules saved for future uploads.")
      .replace(/<EXTRACTED_FIELDS>[\s\S]*?<\/EXTRACTED_FIELDS>/g, "")
      .trim();

    res.json({ reply: cleanReply, extractedFields, docText, docType, fileName });
  } catch (err) {
    console.error("upload-chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/claude/rules — list saved rules ──────────────────────────────────
router.get("/rules", async (req, res) => {
  try {
    const rules = await AiRule.find({}).lean();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/claude/rules/:id ──────────────────────────────────────────────
router.delete("/rules/:id", async (req, res) => {
  try {
    await AiRule.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/claude/chat — general Q&A ──────────────────────────────────────
router.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const [orders, expenses, schedules] = await Promise.all([
      Order.find({}).select("refNumber customerName vin year make model status vessel voyage pol pod sailDate cutoffDate aesItn weightKgs charges notes createdAt").sort({ createdAt: -1 }).limit(200).lean(),
      Expense.find({}).select("description amount category status orderRef date vendor").sort({ date: -1 }).limit(100).lean(),
      ScheduleRow.find({}).select("vessel voyage pol pod cutoffDate sailDate arrivalDate status").limit(100).lean(),
    ]);

    const context = `ORDERS:\n${JSON.stringify(orders).slice(0, 10000)}\n\nEXPENSES:\n${JSON.stringify(expenses).slice(0, 3000)}\n\nSCHEDULES:\n${JSON.stringify(schedules).slice(0, 2000)}`;

    const messages = [
      { role: "system", content: `You are a helpful logistics assistant for DDG Global Logistics. Answer staff questions concisely using bullet points. Format currency as $X,XXX.XX.\n\nLIVE DATA:\n${context}` },
      ...history.map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content })),
      { role: "user", content: message },
    ];

    const reply = await aiText(messages);
    res.json({ reply });
  } catch (err) {
    console.error("chat error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
