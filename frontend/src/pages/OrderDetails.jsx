import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// defaultSell = fixed sell price pre-fill; hasDesc = show description sub-input
const feeRows = [
  ["nonRunnerFee",        "Non-runner Fee",                { defaultSell: 400  }],
  ["forkliftFee",         "Forklift Fee",                  { defaultSell: 500  }],
  ["storageAuctionFee",   "Storage Fee – Auction",         {}],
  ["storageWarehouseFee", "Storage Fee – Warehouse",       {}],
  ["storagePortFee",      "Storage Fee – Port",            {}],
  ["redeliveryFee",       "Re-delivery Fee",               {}],
  ["titleProcessingFee",  "Title Processing Fee",          {}],
  ["mechanicalCharges",   "Mechanical Charges",            { hasDesc: true }],
  ["warehouseInOutFee",   "Warehouse In/Out Fee",          { defaultSell: 150  }],
  ["customsDemurrageFee", "Customs Demurrage Fee",         {}],
  ["customsHoldingFee",   "Customs Holding Fee",           {}],
  ["vesselRolloverFee",   "Vessel Rollover Fee",           {}],
  ["blFedexFee",          "FedEx/Mailing Fee",             { defaultSell: 35   }],
  ["noTitleDeliveryFee",  "No Title Delivery at Port Fee", { defaultSell: 75   }],
  ["emergencyBafFee",     "Emergency BAF",                 {}],
  ["ctnFee",              "CTN Fee",                       { defaultSell: 75   }],
  ["miscellaneousFee",    "Miscellaneous Fee",             {}],
];

const defaultCharges = {
  towingCharge: "0.00",
  oceanFreight: "0.00",
  nonRunnerFee: "0.00",
  forkliftFee: "0.00",
  storageAuctionFee:   "0.00",
  storageWarehouseFee: "0.00",
  storagePortFee:      "0.00",
  redeliveryFee: "0.00",
  titleProcessingFee: "0.00",
  mechanicalCharges: "0.00",
  warehouseInOutFee: "0.00",
  customsDemurrageFee: "0.00",
  customsHoldingFee: "0.00",
  vesselRolloverFee: "0.00",
  blFedexFee: "0.00",
  noTitleDeliveryFee: "0.00",
  emergencyBafFee: "0.00",
  ctnFee: "0.00",
  miscellaneousFee: "0.00",
};

function TowingVerifyForm({ verify, orderId, onDone }) {
  const [updateTable, setUpdateTable] = useState(false);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/orders/${orderId}/confirm-towing-cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          towingCost:         verify.dispatchCost,
          updatePricingTable: updateTable,
          pickupCity:         verify.pickupCity,
          pol:                verify.pol,
        }),
      });
      if (!res.ok) throw new Error("Server error " + res.status);
      onDone(true);
    } catch (e) {
      alert("Update failed: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div>
      <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:13,
        padding:"10px 14px", borderRadius:8, background:"var(--bg-panel)",
        border:"1px solid var(--border)", cursor:"pointer", marginBottom:16 }}>
        <input type="checkbox" checked={updateTable} onChange={e => setUpdateTable(e.target.checked)}
          style={{ width:16, height:16, cursor:"pointer" }} />
        <span>
          Also update <strong>Towing Charges table</strong> for{" "}
          <span style={{ color:"var(--accent)" }}>{verify.pickupCity || "this city"}</span>
          {verify.pol ? <> → <span style={{ color:"var(--accent)" }}>{verify.pol}</span></> : ""}
          {" "}to <strong style={{ color:"#fbbf24" }}>${verify.dispatchCost.toLocaleString()}</strong>
        </span>
      </label>
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={confirm} disabled={saving}
          style={{ padding:"10px 20px", borderRadius:8, border:"none",
            background:"#059669", color:"white", cursor:"pointer", fontWeight:700 }}>
          {saving ? "Saving…" : "✓ Update This Order"}
        </button>
        <button onClick={() => onDone(false)}
          style={{ padding:"10px 16px", borderRadius:8, border:"1px solid var(--border)",
            background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
          Ignore
        </button>
      </div>
    </div>
  );
}

// ── DropZone ──────────────────────────────────────────────────────────────────
function DropZone({ label, file, setFile, existingUrl, existingName, onRemoveExisting, accept = "image/*,.pdf", hint }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);
  const hasNew = !!file;
  const hasOld = !hasNew && !!existingUrl;
  return (
    <div>
      {label && <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:5 }}>{label}</div>}
      <div
        onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
        style={{
          border: `2px dashed ${drag ? "var(--accent)" : (hasNew||hasOld) ? "#34d399" : "var(--border)"}`,
          borderRadius: 8, padding: "12px 14px", textAlign: "center",
          cursor: "pointer", transition: "all 0.15s", minHeight: 68,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 4,
          background: drag ? "rgba(96,165,250,0.06)" : (hasNew||hasOld) ? "rgba(52,211,153,0.04)" : "var(--bg-panel)",
        }}
      >
        <input ref={ref} type="file" accept={accept} style={{ display:"none" }}
          onChange={e => setFile(e.target.files[0] || null)} />
        {hasNew ? (
          <>
            <span style={{ fontSize:13, color:"#34d399" }}>📎 {file.name}</span>
            <span style={{ fontSize:11, color:"var(--text-muted)" }}>{(file.size/1024).toFixed(0)} KB</span>
            <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }}
              style={{ fontSize:11, color:"#f87171", background:"none", border:"none", cursor:"pointer", padding:0, marginTop:2 }}>Remove</button>
          </>
        ) : hasOld ? (
          <>
            <a href={existingUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ fontSize:13, color:"var(--accent)", textDecoration:"none" }}>
              📎 {existingName || "View file"}
            </a>
            <div style={{ display:"flex", gap:12, marginTop:4 }}>
              <button type="button" onClick={e => { e.stopPropagation(); ref.current?.click(); }}
                style={{ fontSize:11, color:"var(--text-muted)", background:"none", border:"none", cursor:"pointer", padding:0 }}>Replace</button>
              {onRemoveExisting && (
                <button type="button" onClick={e => { e.stopPropagation(); onRemoveExisting(); }}
                  style={{ fontSize:11, color:"#f87171", background:"none", border:"none", cursor:"pointer", padding:0 }}>Remove</button>
              )}
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize:22 }}>📂</span>
            <span style={{ fontSize:12, color:"var(--text-muted)" }}>{hint || "Drop file or click to browse"}</span>
            <span style={{ fontSize:11, color:"var(--text-muted)", opacity:0.6 }}>PDF · JPG · PNG up to 20 MB</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Inline address search for edit modal ─────────────────────────────────────
function LocationSearch({ label, value, onChange, onSelect }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = async (q) => {
    onChange(q);
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    try {
      const res = await fetch(`${API}/api/address-book?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data.slice(0, 8) : []);
      setOpen(true);
    } catch { setResults([]); }
  };

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        {label}
        <input
          value={value}
          onChange={e => search(e.target.value)}
          onFocus={() => value.length >= 2 && open && results.length && setOpen(true)}
          placeholder="Type to search address book…"
          style={{ display:"block", width:"100%", marginTop:4, boxSizing:"border-box" }}
        />
      </label>
      {open && results.length > 0 && (
        <div style={{
          position:"absolute", zIndex:50, top:"100%", left:0, right:0,
          background:"var(--bg-elevated)", border:"1px solid var(--border)",
          borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,0.3)",
          maxHeight:220, overflowY:"auto",
        }}>
          {results.map(item => (
            <div key={item._id}
              onMouseDown={() => { onSelect(item); setOpen(false); setResults([]); }}
              style={{ padding:"9px 12px", cursor:"pointer", borderBottom:"1px solid var(--border-muted)" }}
              onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            >
              <div style={{ fontWeight:600, fontSize:13, color:"var(--text-primary)" }}>{item.companyName}</div>
              {(item.address||item.city) && (
                <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:2 }}>
                  {[item.address, item.city, item.state].filter(Boolean).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState("");

  const [driveFiles,        setDriveFiles]        = useState([]);
  const [uploadingLabels,   setUploadingLabels]   = useState({});   // { AES: 1, Dispatch: 0, ... }
  const [draggingLabel,     setDraggingLabel]     = useState(null);
  const [docPreview,        setDocPreview]        = useState(null); // { name, url }
  const [editingFeeKey,     setEditingFeeKey]     = useState(null); // key of fee row being inline-edited
  const [editingInternalRow, setEditingInternalRow] = useState(null); // "towing" | "ocean" | null
  const [oceanEditForm,     setOceanEditForm]     = useState({ pol:"", pod:"", shippingLine:"", sell:"", cost:"", category:"1" });
  const [oceanLooking,      setOceanLooking]      = useState(false);
  const [oceanRates,        setOceanRates]        = useState([]);

  const [voyages, setVoyages] = useState([]);
  const [voyageSearch, setVoyageSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showVoyageList, setShowVoyageList] = useState(false);

  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const voyageContainerRef = useRef(null);

  const [showCosts, setShowCosts] = useState(false);
  const [charges, setCharges] = useState(defaultCharges);

  const [emailNote, setEmailNote]           = useState("");
  const [emailNoteSaving, setEmailNoteSaving] = useState(false);
  const [emailNoteSaved,  setEmailNoteSaved]  = useState(false);

  const saveEmailNote = async () => {
    setEmailNoteSaving(true);
    await fetch(`${API}/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailNote }),
    });
    setEmailNoteSaving(false);
    setEmailNoteSaved(true);
    setTimeout(() => setEmailNoteSaved(false), 2000);
  };

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({});

  const [showDrPreview, setShowDrPreview] = useState(false);
  const [drPayload, setDrPayload] = useState(null);
  const [drLoading, setDrLoading] = useState(false);
  const [drWeightOverride, setDrWeightOverride] = useState("");
  const [showDrEdit, setShowDrEdit] = useState(false);
  const [drEditForm, setDrEditForm] = useState({});
  const [scheduleVessels, setScheduleVessels] = useState([]);
  const [scheduleLooking, setScheduleLooking] = useState(false);

  // Load vessel list once
  useEffect(() => {
    fetch(`${API}/api/schedule/vessels`)
      .then(r => r.json()).then(setScheduleVessels).catch(() => {});
  }, []);

  // Core: hit the schedule API with any combo of voyageName / vessel params
  const applyScheduleResult = async (params) => {
    const qs = new URLSearchParams(params).toString();
    const res  = await fetch(`http://localhost:4000/api/schedule/lookup?${qs}`);
    const data = await res.json();
    if (data.found) {
      await fetch(`${API}/api/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vessel:      data.vessel,
          voyage:      data.voyage,
          cutoffDate:  data.cutoffDate,
          sailDate:    data.sailDate,
          arrivalDate: data.arrivalDate,
        }),
      });
      fetchOrder();
      setMessage(`✅ Schedule: ${data.vessel} V:${data.voyage} — Sail ${data.sailDate}`);
    } else {
      setMessage("⚠️ No schedule match found.");
    }
    return data.found;
  };

  // Called from the manual Lookup button — uses AES vessel
  const lookupAndApplySchedule = async (vessel, pol, pod) => {
    if (!pol || !pod) return;
    setScheduleLooking(true);
    try {
      await applyScheduleResult({ vessel: vessel || "", pol, pod });
    } catch (e) {
      setMessage("Schedule lookup failed: " + e.message);
    }
    setScheduleLooking(false);
  };
  const [showNoteEdit, setShowNoteEdit] = useState(false);
  const [noteText, setNoteText] = useState("");

  const [towingVerify, setTowingVerify] = useState(null);
  // { dispatchCost, currentCost, pickupCity, pol }

  const [showInvoice,   setShowInvoice]   = useState(false);
  const [invoiceItems,  setInvoiceItems]  = useState([
    { description: "Towing Charge", amount: "0.00" },
    { description: "Ocean Freight", amount: "0.00" },
  ]);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceNotes,   setInvoiceNotes]   = useState("");
  const [invoiceSaving,  setInvoiceSaving]  = useState(false);
  const [orderInvoices,  setOrderInvoices]  = useState([]);  // invoices created for this order

  // ── Bills ────────────────────────────────────────────────────────────────────
  const [bills, setBills]                     = useState([]);
  const [billsLoading, setBillsLoading]       = useState(false);
  const [showAddBill, setShowAddBill]         = useState(false);
  const [editingBill, setEditingBill]         = useState(null); // null = new, else bill object
  const [billMode, setBillMode]               = useState("manual");
  const [billForm, setBillForm]               = useState({});
  const [billExtraLines, setBillExtraLines]   = useState([]); // [{ description, amount }]
  const [billSaving, setBillSaving]           = useState(false);
  const [billDocPaste, setBillDocPaste]       = useState("");
  const [billParsing, setBillParsing]         = useState(false);
  const [billParseResult, setBillParseResult] = useState(null);
  const [billVendors, setBillVendors]         = useState([]);
  const [billReceiptFile, setBillReceiptFile] = useState(null);
  const [billDocFile,    setBillDocFile]      = useState(null);
  const [invoiceSendModal, setInvoiceSendModal] = useState(null); // { pdfBase64, pdfName, invoiceNumber }
  const [invSendTo,   setInvSendTo]   = useState("");
  const [invSubject,  setInvSubject]  = useState("");
  const [invBody,     setInvBody]     = useState("");
  const [invSending,  setInvSending]  = useState(false);

  const [drSendModal,  setDrSendModal]  = useState(null); // { pdfBase64, pdfName }
  const [drSendTo,     setDrSendTo]     = useState("");
  const [drSendTrucker,setDrSendTrucker]= useState("");
  const [drSendSubject,setDrSendSubject]= useState("");
  const [drSendBody,   setDrSendBody]   = useState("");
  const [drSending,    setDrSending]    = useState(false);
  const [lastDrBase64, setLastDrBase64] = useState(null); // cached after last generation

  useEffect(() => {
    fetchOrder();
    fetchVoyages();
    fetchBillVendors();
    fetchOrderInvoices();
  }, []);

  const fetchOrderInvoices = async () => {
    try {
      const res  = await fetch(`${API}/api/invoices/by-order/${id}`);
      const data = await res.json();
      setOrderInvoices(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => {
    const handler = (e) => {
      if (voyageContainerRef.current && !voyageContainerRef.current.contains(e.target)) {
        setShowVoyageList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchOrder = async () => {
    const res = await fetch(`${API}/api/orders/${id}`);
    const data = await res.json();

    setOrder(data);
    fetchBills(data.refNumber);
    setNoteText(data.notes || "");
    setEmailNote(data.emailNote || "");
    const currentCharges = { ...defaultCharges, ...(data.charges || {}) };
    setCharges(currentCharges);

    fetchDriveFiles();

    // ── Auto-populate towing / ocean freight from pricing table ──────────
    // Fills in sell prices AND costs wherever they are still $0.
    // Saves silently so the values persist on refresh.
    const needsTowing     = !currentCharges.towingCharge || Number(currentCharges.towingCharge) === 0;
    const needsOcean      = !currentCharges.oceanFreight || Number(currentCharges.oceanFreight) === 0;
    const needsTowingCost = !currentCharges.towingCost   || Number(currentCharges.towingCost)   === 0;
    const needsOceanCost  = !currentCharges.oceanCost    || Number(currentCharges.oceanCost)    === 0;
    if (!needsTowing && !needsOcean && !needsTowingCost && !needsOceanCost) return;

    // Derive pickup city: use stored pickupCity, or extract first word from pickupLocation.
    // pickupLocation formats: "COPART SPARTANBURG SC" or "COPART - SPARTANBURG, SC"
    // Strip "COPART" + any trailing spaces/dashes, then take first word.
    const pickupCity   = (
      data.pickupCity ||
      (data.pickupLocation || "").replace(/^COPART[\s\-–,]+/i, "").split(/[\s,]+/)[0] ||
      ""
    ).toUpperCase();
    const pol          = (data.pol || "").toUpperCase();
    const pod          = (data.pod || "").toUpperCase();
    const shippingLine = (data.shippingLine || "").toUpperCase();

    try {
      const [towingRates, oceanRates] = await Promise.all([
        ((needsTowing || needsTowingCost) && pickupCity && pol)
          ? fetch(`${API}/api/pricing?type=towing`).then(r => r.json())
          : Promise.resolve([]),
        ((needsOcean || needsOceanCost) && pol && pod)
          ? fetch(`${API}/api/pricing?type=ocean`).then(r => r.json())
          : Promise.resolve([]),
      ]);

      const updates = {};

      if ((needsTowing || needsTowingCost) && towingRates.length) {
        const normCity = s => {
          if (!s) return "";
          let c = s.toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim().replace(/\s+/g, " ");
          c = c.replace(/\bFT\b/g, "FORT").replace(/\bST\b/g, "SAINT").replace(/\bMT\b/g, "MOUNT");
          return c;
        };
        const match =
          // 1. Exact: city + port both match
          towingRates.find(r =>
            normCity(r.city) === normCity(pickupCity) &&
            (r.port || "").toUpperCase() === pol
          ) ||
          // 2. City match where rate has no port assigned (port-agnostic entry)
          towingRates.find(r =>
            normCity(r.city) === normCity(pickupCity) &&
            !r.port
          ) ||
          // 3. City match regardless of port (closest we can get)
          towingRates.find(r =>
            normCity(r.city) === normCity(pickupCity)
          );
        if (match) {
          const deliv = (data.deliveryLocation || "").toUpperCase();
          const isWarehouse = /WAREHOUSE/i.test(deliv) ||
            (match.warehouse && deliv.includes((match.warehouse || "").toUpperCase()));
          if (isWarehouse) {
            if (needsTowing     && match.warehousePrice) updates.towingCharge = String(match.warehousePrice);
            if (needsTowingCost && match.warehouseCost)  updates.towingCost   = String(match.warehouseCost);
          } else {
            if (needsTowing     && match.portPrice) updates.towingCharge = String(match.portPrice);
            if (needsTowingCost && match.cost)      updates.towingCost   = String(match.cost);
          }
        }
      }

      if ((needsOcean || needsOceanCost) && oceanRates.length) {
        // Always prefer Category 1 pricing for customer sell price
        const match =
          oceanRates.find(r =>
            (r.pol          || "").toUpperCase() === pol &&
            (r.pod          || "").toUpperCase() === pod &&
            (r.shippingLine || "").toUpperCase() === shippingLine &&
            r.category === "1"
          ) ||
          oceanRates.find(r =>
            (r.pol || "").toUpperCase() === pol &&
            (r.pod || "").toUpperCase() === pod &&
            r.category === "1"
          ) ||
          oceanRates.find(r =>
            (r.pol          || "").toUpperCase() === pol &&
            (r.pod          || "").toUpperCase() === pod &&
            (r.shippingLine || "").toUpperCase() === shippingLine
          ) ||
          oceanRates.find(r =>
            (r.pol || "").toUpperCase() === pol &&
            (r.pod || "").toUpperCase() === pod
          );
        if (match) {
          if (needsOcean     && match.portPrice) updates.oceanFreight = String(match.portPrice);
          if (needsOceanCost && match.cost)      updates.oceanCost    = String(match.cost);
        }
      }

      if (!Object.keys(updates).length) return;

      const newCharges = { ...currentCharges, ...updates };
      setCharges(newCharges);
      // Persist silently so the values survive page refreshes
      fetch(`${API}/api/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charges: newCharges }),
      });
    } catch (_) {
      // Pricing lookup failure is non-critical — silently ignore
    }
  };

  const fetchDriveFiles = async () => {
    try {
      const res  = await fetch(`${API}/api/orders/${id}/drive-files`);
      const data = await res.json();
      setDriveFiles(Array.isArray(data) ? data : []);
    } catch {
      setDriveFiles([]);
    }
  };

  const fetchVoyages = async () => {
    const res = await fetch(`${API}/api/orders/voyages/all`);
    const data = await res.json();
    setVoyages(data);
  };

  const fetchBillVendors = async () => {
    try {
      const res  = await fetch(`${API}/api/vendors`);
      const data = await res.json();
      setBillVendors(Array.isArray(data) ? data : []);
    } catch {}
  };

  const fetchBills = async (refNumber) => {
    const ref = refNumber || order?.refNumber;
    if (!ref) return;
    setBillsLoading(true);
    try {
      const res  = await fetch(`${API}/api/expenses?orderRef=${encodeURIComponent(ref)}`);
      const data = await res.json();
      setBills(Array.isArray(data) ? data : []);
    } catch {}
    setBillsLoading(false);
  };

  const BILL_CATEGORIES = [
    "Towing / Transport", "Ocean Freight", "Port / Terminal Fees",
    "Loaders & Warehouses", "Software", "Legal Fees", "Office & Admin", "General Overhead",
  ];

  const BILL_CAT_COLORS = {
    "Towing / Transport":   "#60a5fa",
    "Ocean Freight":        "#34d399",
    "Port / Terminal Fees": "#a78bfa",
    "Loaders & Warehouses": "#f97316",
    "Software":             "#22d3ee",
    "Legal Fees":           "#f43f5e",
    "Office & Admin":       "#fbbf24",
    "General Overhead":     "#9ca3af",
  };

  const openAddBill = (mode = "manual") => {
    const desc = [order.year, order.make, order.model].filter(Boolean).join(" ")
      + (order.vin ? " — VIN: " + order.vin : "");
    setEditingBill(null);
    setBillForm({
      category:      "Towing / Transport",
      description:   desc,
      vendor:        "",
      amount:        "",
      date:          new Date().toISOString().slice(0, 10),
      orderRef:      order.refNumber || "",
      orderId:       id,
      invoiceNumber: "",
      status:        "unpaid",
      paidDate:      "",
      notes:         "",
    });
    setBillMode(mode);
    setBillDocPaste("");
    setBillParseResult(null);
    setBillReceiptFile(null);
    setBillDocFile(null);
    setBillExtraLines([]);
    setShowAddBill(true);
  };

  const openEditBill = (bill) => {
    setEditingBill(bill);
    setBillForm({
      category:      bill.category      || "Towing / Transport",
      description:   bill.description   || "",
      vendor:        bill.vendor        || "",
      amount:        bill.amount != null ? String(bill.amount - (bill.lineItems||[]).reduce((s,l)=>s+Number(l.amount||0),0)) : "",
      date:          bill.date ? bill.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      orderRef:      bill.orderRef      || order.refNumber || "",
      orderId:       id,
      invoiceNumber: bill.invoiceNumber || "",
      status:        bill.status        || "unpaid",
      paidDate:      bill.paidDate ? bill.paidDate.slice(0, 10) : "",
      notes:         bill.notes         || "",
    });
    setBillExtraLines(bill.lineItems?.length ? bill.lineItems.map(l => ({ description: l.description, amount: String(l.amount) })) : []);
    setBillMode("manual");
    setBillDocPaste("");
    setBillParseResult(null);
    setBillReceiptFile(null);
    setBillDocFile(null);
    setShowAddBill(true);
  };

  const saveBill = async () => {
    if (!billForm.category || !billForm.description || !billForm.amount) {
      alert("Category, description, and amount are required.");
      return;
    }
    setBillSaving(true);
    try {
      const fd = new FormData();
      Object.entries(billForm).forEach(([k, v]) => v != null && fd.append(k, v));
      const validExtras = billExtraLines.filter(l => l.description.trim() && Number(l.amount) > 0);
      if (validExtras.length) fd.append("lineItems", JSON.stringify(validExtras));
      if (billReceiptFile) fd.append("receipt", billReceiptFile);
      if (billDocFile)     fd.append("bill",    billDocFile);

      const url    = editingBill ? `${API}/api/expenses/${editingBill._id}` : `${API}/api/expenses`;
      const method = editingBill ? "PUT" : "POST";
      const res    = await fetch(url, { method, body: fd });
      const data   = await res.json();
      if (!res.ok) { setMessage(data.error || "Failed to save bill"); setBillSaving(false); return; }

      // Extra lines are stored on the main bill — nothing extra to save here

      setShowAddBill(false);
      setBillExtraLines([]);
      fetchBills();
      setMessage(editingBill ? "Bill updated ✓" : `Bill added ✓${validExtras.length ? ` + ${validExtras.length} extra charge${validExtras.length > 1 ? "s" : ""}` : ""}`);
    } catch { setMessage("Failed to save bill"); }
    setBillSaving(false);
  };

  const removeBillFile = async (type) => {
    if (!editingBill) return;
    if (!window.confirm(`Remove the ${type === "bill" ? "bill document" : "receipt"}?`)) return;
    await fetch(`${API}/api/expenses/${editingBill._id}/${type}`, { method: "DELETE" });
    setEditingBill(b => ({ ...b, [`${type}FileName`]: "" }));
  };

  const markBillPaid = async (billId) => {
    const res = await fetch(`${API}/api/expenses/${billId}/pay`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ paidDate: new Date().toISOString().slice(0, 10) }),
    });
    if (res.ok) fetchBills();
  };

  const deleteBill = async (billId) => {
    if (!window.confirm("Remove this bill from the order?")) return;
    const res = await fetch(`${API}/api/expenses/${billId}`, { method: "DELETE" });
    if (res.ok) fetchBills();
  };

  const updateStatus = async (newStatus) => {
    setMessage("Updating status...");

    const res = await fetch(`${API}/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Failed to update status");
      return;
    }

    setOrder(data);
    setMessage("Status updated");
  };

  const updateCharge = (key, value) => {
    setCharges((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const saveCharges = async () => {
    setMessage("Saving charges...");

    const res = await fetch(`${API}/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ charges }),
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Failed to save charges");
      return;
    }

    setOrder(data);
    setShowCosts(false);
    setMessage("Additional costs saved");
  };

  const openInvoiceModal = () => {
    const items = [];

    if (charges.towingCharge && Number(charges.towingCharge) > 0) {
      const towDesc = [
        "Towing",
        order.pickupLocation && order.deliveryLocation
          ? `${order.pickupLocation} → ${order.deliveryLocation}`
          : order.pickupLocation || order.deliveryLocation || "",
      ].filter(Boolean).join(" — ");
      items.push({ description: towDesc, amount: charges.towingCharge });
    }

    if (charges.oceanFreight && Number(charges.oceanFreight) > 0) {
      const ocnCat  = charges.oceanCategory ? `Cat. ${charges.oceanCategory}` : "Cat. 1";
      const ocnDesc = [
        "Ocean Freight",
        order.pol && order.pod ? `${order.pol} → ${order.pod}` : "",
        ocnCat,
      ].filter(Boolean).join(" — ");
      items.push({ description: ocnDesc, amount: charges.oceanFreight });
    }

    feeRows.forEach(([key, label]) => {
      if (charges[key] && Number(charges[key]) > 0) {
        const desc = charges[key + "Desc"]
          ? `${label} — ${charges[key + "Desc"]}`
          : label;
        items.push({ description: desc, amount: charges[key] });
      }
    });

    setInvoiceItems(
      items.length ? items : [{ description: "", amount: "0.00" }]
    );

    setInvoiceDueDate("");
    setInvoiceNotes("");
    setShowInvoice(true);
  };

  const updateInvoiceItem = (index, key, value) => {
    setInvoiceItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [key]: value } : item
      )
    );
  };

  const addInvoiceItem = () => {
    setInvoiceItems((prev) => [
      ...prev,
      { description: "", amount: "0.00" },
    ]);
  };

  const removeInvoiceItem = (index) => {
    setInvoiceItems((prev) => prev.filter((_, i) => i !== index));
  };

  const moveToVoyage = async (voyage) => {
    setMessage("Moving shipment folder to voyage...");

    const res = await fetch(`${API}/api/orders/${id}/move-to-voyage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voyageFolderId: voyage.id,
        voyageFolderName: voyage.name,
        shippingLine: voyage.shippingLine,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Move failed");
      return;
    }

    setOrder(data);
    setVoyageSearch(voyage.name);
    setShowVoyageList(false);
    setMessage(`Moved to ${voyage.shippingLine} / ${voyage.name} — looking up schedule…`);

    // Parse vessel + voyage code directly from folder name: "26LA01 LIBERTY PASSION" → voyage=26LA01, vessel=LIBERTY PASSION
    const folderUpper = voyage.name.toUpperCase().trim();
    const codeMatch   = folderUpper.match(/^(\d+[A-Z]+\d+[A-Z]*)\s+(.*)/);
    const voyageCode  = codeMatch ? codeMatch[1] : "";
    const vesselName  = codeMatch ? codeMatch[2].trim() : folderUpper;

    // Always save vessel + voyage from folder name immediately — schedule fills in dates
    await fetch(`${API}/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vessel: vesselName, voyage: voyageCode }),
    });
    fetchOrder();

    // Then try schedule lookup for dates (cutoff, sail, arrival)
    setScheduleLooking(true);
    try {
      const found = await applyScheduleResult({ voyageName: voyage.name, pol: data.pol, pod: data.pod });
      if (!found) setMessage(`✅ Moved — vessel & voyage set. Load the schedule to get dates.`);
    } catch (e) {
      setMessage("Schedule lookup failed: " + e.message);
    }
    setScheduleLooking(false);
  };

  const guessShippingLine = (name) => {
    const upper = name.toUpperCase();

    if (
      upper.includes("SALLAUM") ||
      upper.includes("SALL") ||
      upper.startsWith("S")
    ) {
      return "SALLAUM";
    }

    return "ACL";
  };

  const createVoyageAndMove = async () => {
    const name = voyageSearch.trim();

    if (!name) {
      alert("Type a voyage folder name first");
      return;
    }

    const shippingLine = guessShippingLine(name);

    setMessage(`Creating ${shippingLine} voyage folder...`);

    const res = await fetch(`${API}/api/orders/voyages/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shippingLine,
        voyageName: name,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Could not create voyage");
      return;
    }

    await fetchVoyages();
    await moveToVoyage(data);
  };

  const clearVoyage = async () => {
    const confirmClear = window.confirm(
      "Clear voyage and move shipment back to Waiting to Sail?"
    );

    if (!confirmClear) return;

    setMessage("Clearing voyage...");

    const res = await fetch(`${API}/api/orders/${id}/clear-voyage`, {
      method: "POST",
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Failed to clear voyage");
      return;
    }

    setOrder(data);
    setVoyageSearch("");
    setMessage("Voyage cleared and shipment moved back to Waiting to Sail.");
  };

  // Auto-upload a single file under a given label
  const uploadFile = async (file, label) => {
    setUploadingLabels(prev => ({ ...prev, [label]: (prev[label] || 0) + 1 }));
    try {
      const fd = new FormData();
      fd.append("file",  file);
      fd.append("label", label);
      const res  = await fetch(`${API}/api/orders/${id}/upload-drive`, {
        method: "POST",
        body:   fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`❌ ${file.name}: ${data.error || "Upload failed"}`);
        return;
      }
      if (data.towingCostVerification) setTowingVerify(data.towingCostVerification);
      try { await fetchDriveFiles(); } catch {}
      try { await fetchOrder();      } catch {}
      setMessage(`✅ ${file.name} uploaded`);

      // ── If Email doc, parse for PIN and auto-update order ────────────
      if (label === "Email") {
        try {
          const parseFd = new FormData();
          parseFd.append("file", file);
          parseFd.append("message", "Extract the gate release PIN or pickup PIN number from this email. Return only the PIN number, nothing else. If not found return empty string.");
          parseFd.append("history", "[]");
          const parseRes = await fetch(`${API}/api/claude/upload-chat`, { method: "POST", body: parseFd });
          const parseData = await parseRes.json();
          const pin = parseData.reply?.trim().replace(/[^0-9A-Za-z]/g, "");
          if (pin && pin.length >= 4 && pin.length <= 20) {
            await fetch(`${API}/api/orders/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pin }),
            });
            await fetchOrder();
            setMessage(`✅ ${file.name} uploaded · PIN extracted: ${pin}`);
          }
        } catch {}
      }
    } catch (e) {
      setMessage(`❌ Upload error: ${file.name}`);
    } finally {
      setUploadingLabels(prev => ({ ...prev, [label]: Math.max(0, (prev[label] || 1) - 1) }));
    }
  };

  // Delete a file from Drive and the order. Pass silent=true to skip confirm + toast.
  const deleteFile = async (driveFileId, fileName, silent = false) => {
    if (!silent && !window.confirm(`Delete "${fileName}"?`)) return;
    try {
      const res = await fetch(
        `${API}/api/orders/${id}/files/${driveFileId}?name=${encodeURIComponent(fileName)}`,
        { method: "DELETE" }
      );
      if (!res.ok) { if (!silent) setMessage("❌ Delete failed"); return; }
      await fetchDriveFiles();
      if (!silent) setMessage(`✓ ${fileName} deleted`);
    } catch (e) {
      if (!silent) setMessage("❌ Delete failed");
    }
  };

  // Save a single internal cost/sell field on blur
  const saveInternalField = async (key, value) => {
    try {
      const res = await fetch(`${API}/api/orders/${id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ charges: { ...charges, [key]: value } }),
      });
      const data = await res.json();
      if (res.ok) { setOrder(data); setCharges(data.charges || {}); }
    } catch (e) { console.error("Save internal field failed:", e); }
  };

  const parseExistingDriveFiles = async () => {
    setMessage("Parsing Drive files...");

    const res = await fetch(`${API}/api/orders/${id}/parse-drive-files`, {
      method: "POST",
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Failed to parse Drive files");
      return;
    }

    setOrder(data);
    await fetchDriveFiles();
    setMessage("Drive files parsed");

    if (data.towingCostVerification) {
      setTowingVerify(data.towingCostVerification);
    }
  };

  const openEdit = () => {
    setEditForm({
      customerName:    order.customerName    || "",
      customerPhone:   order.customerPhone   || "",
      customerEmail:   order.customerEmail   || "",
      year:            order.year            || "",
      make:            order.make            || "",
      model:           order.model           || "",
      color:           order.color           || "",
      vin:             order.vin             || "",
      lotNumber:       order.lotNumber       || "",
      pin:             order.pin             || "",
      condition:       order.condition       || "Runner",
      titleStatus:     order.titleStatus     || "Pending",
      pickupLocation:  order.pickupLocation  || "",
      deliveryLocation:order.deliveryLocation|| "",
      requestType:     order.requestType     || "RORO",
      containerSize:   order.containerSize   || "",
      shippingLine:    order.shippingLine    || "",
      pol:             order.pol             || "",
      pod:             order.pod             || "",
      bookingNumber:   order.bookingNumber   || "",
      containerNumber: order.containerNumber || "",
      sealNumber:      order.sealNumber      || "",
      notes:           order.notes           || "",
    });
    // Pre-load ocean rates for Container auto-price lookup
    fetch(`${API}/api/pricing?type=ocean`)
      .then(r => r.json()).then(setOceanRates).catch(() => {});
    setShowEdit(true);
  };

  const saveEdit = async () => {
    setMessage("Saving changes...");
    const res = await fetch(`${API}/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error || "Failed to save"); return; }

    // If Container + containerSize + pol set, auto-apply ocean freight from pricing table
    if (editForm.requestType === "Container" && editForm.containerSize && editForm.pol) {
      const pol  = editForm.pol.toUpperCase();
      const pod  = (editForm.pod || "").toUpperCase();
      const size = editForm.containerSize;
      const line = (editForm.shippingLine || "").toUpperCase();
      const match =
        oceanRates.find(r => r.requestType === "CONTAINER" && r.pol === pol && r.containerSize === size && r.shippingLine === line) ||
        oceanRates.find(r => r.requestType === "CONTAINER" && r.pol === pol && r.containerSize === size) ||
        oceanRates.find(r => r.requestType === "CONTAINER" && r.pol === pol && r.shippingLine === line);
      if (match && match.portPrice) {
        const newCharges = { ...charges, oceanFreight: String(match.portPrice), ...(match.cost ? { oceanCost: String(match.cost) } : {}) };
        setCharges(newCharges);
        await fetch(`${API}/api/orders/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ charges: newCharges }),
        });
      }
    }

    setOrder(data);
    setShowEdit(false);
    setMessage("Order updated");
  };

  const saveNote = async () => {
    const res = await fetch(`${API}/api/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: noteText }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error || "Failed to save note"); return; }
    setOrder(data);
    setShowNoteEdit(false);
    setMessage("Note saved");
  };

  const openDrPreview = async (forceRefresh = false) => {
    setShowDrPreview(true);
    // If we already have DR data (possibly with edits), show it as-is — don't overwrite.
    // Only fetch from backend on first open or when forceRefresh is true.
    if (drPayload && !forceRefresh) return;
    setDrLoading(true);
    try {
      const res  = await fetch(`${API}/api/orders/${id}/dr-payload`);
      const data = await res.json();
      setDrPayload(data);
      setDrWeightOverride(data.weightKgs || "");
    } catch (err) {
      console.error("DR payload fetch failed", err);
      setDrPayload(null);
    }
    setDrLoading(false);
  };

  const generateDockReceipt = async (overridePayload) => {
    setMessage("Generating Dock Receipt...");
    try {
    // Delete any existing Dock Receipt files first to avoid duplicates
    const oldDrs = driveFiles.filter(f => {
      const match = (order.files || []).find(of => of.filename === f.name || of.originalName === f.name);
      return (match?.label || "") === "Dock Receipt";
    });
    for (const old of oldDrs) {
      await deleteFile(old.id, old.name, true).catch(() => {});
    }

    const base = overridePayload || drPayload || order;
    const payload = {
      ...base,
      referenceNumber: base.refNumber || base.referenceNumber,
      vehicleYearMakeModel:
        base.vehicleYearMakeModel ||
        `${base.year || ""} ${base.make || ""} ${base.model || ""}`.trim(),
      portOfLoading: base.pol || base.portOfLoading || "",
      portOfDischarge: base.pod || base.portOfDischarge || "",
      // Apply manual weight override if set
      weightKgs: drWeightOverride || base.weightKgs || "",
    };

    const res = await fetch(`${API}/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      setMessage("Failed to generate Dock Receipt");
      return;
    }

    const arrayBuffer = await res.arrayBuffer();
    const pdfName = `${order.refNumber || "dock-receipt"} DR.pdf`;

    // Convert to base64
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    uint8.forEach(b => binary += String.fromCharCode(b));
    const base64 = btoa(binary);

    // Trigger download
    const blob = new Blob([arrayBuffer], { type: "application/pdf" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = pdfName;
    a.click();
    window.URL.revokeObjectURL(url);

    // Auto-upload to Drive under "Dock Receipt" label
    try {
      const drFile = new File([arrayBuffer], pdfName, { type: "application/pdf" });
      await uploadFile(drFile, "Dock Receipt");
    } catch (_) {}

    // Cache base64 for Send DR button
    setLastDrBase64(base64);

    // Open send modal
    setDrSendModal({ pdfBase64: base64, pdfName });
    setDrSendTo(order.customerEmail || "");
    setDrSendTrucker("");
    setDrSendSubject(`Dock Receipt - ${order.refNumber || ""} | ${payload.vehicleYearMakeModel || ""} | VIN: ${(payload.vin || order.vin || "").slice(-6)}`);
    setDrSendBody(`Please find your Dock Receipt attached.\n\nVIN: ${payload.vin || order.vin || ""}\nVessel: ${payload.vessel || ""} | Voyage: ${payload.voyage || ""}\nPort of Loading: ${payload.portOfLoading || ""}\n\nRegards,\nDDG OPS`);

    setMessage("Dock Receipt generated & uploaded");
    } catch (err) {
      console.error("generateDockReceipt error:", err);
      setMessage("❌ DR generation error: " + err.message);
    }
  };

  const sendDrEmail = async () => {
    if (!drSendModal) return;
    const recipients = [drSendTo, drSendTrucker].map(e => e.trim()).filter(Boolean);
    if (!recipients.length) return alert("Enter at least one email address.");
    setDrSending(true);
    try {
      const b64 = drSendModal.pdfBase64;

      const fetchWithTimeout = (url, opts, ms = 30000) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
      };

      const results = await Promise.all(recipients.map(to =>
        fetchWithTimeout(`${API}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, subject: drSendSubject, body: drSendBody, pdfBase64: b64, pdfName: drSendModal.pdfName }),
        })
      ));

      // Check for server-side errors
      for (const r of results) {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || `Server error ${r.status}`);
        }
      }

      // Log to timeline
      const sentTo = [drSendTo.trim(), drSendTrucker.trim()].filter(Boolean);
      const details = sentTo.map((e, i) => i === 0 ? `Customer: ${e}` : `Driver: ${e}`).join(" | ");
      await fetch(`${API}/api/orders/${id}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DR Sent", details }),
      });
      fetchOrder();
      setDrSendModal(null);
      setMessage("✅ DR sent successfully");
    } catch(e) {
      const msg = e.name === "AbortError" ? "Request timed out — check server logs" : e.message;
      setMessage("❌ Failed to send DR: " + msg);
    } finally {
      setDrSending(false);
    }
  };

  const generateInvoicePdf = async () => {
    setInvoiceSaving(true);
    setMessage("Saving invoice…");
    try {
      const payload = {
        items:   invoiceItems.map(i => ({ description: i.description, amount: Number(i.amount || 0) })),
        notes:   invoiceNotes,
        dueDate: invoiceDueDate || null,
      };

      let inv;

      // If an invoice already exists for this order, update it — never duplicate
      if (orderInvoices.length > 0) {
        const existingId = orderInvoices[0]._id;
        const updateRes  = await fetch(`${API}/api/invoices/${existingId}`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });
        inv = await updateRes.json();
        if (!updateRes.ok) { setMessage(inv.error || "Failed to update invoice"); setInvoiceSaving(false); return; }
      } else {
        // First time — create a new invoice
        const createRes = await fetch(`${API}/api/invoices`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ orderId: id, ...payload }),
        });
        inv = await createRes.json();
        if (!createRes.ok) { setMessage(inv.error || "Failed to create invoice"); setInvoiceSaving(false); return; }
      }

      // Download the PDF
      const a = document.createElement("a");
      a.href     = `${API}/api/invoices/${inv._id}/pdf`;
      a.download = `Invoice-${inv.invoiceNumber}.pdf`;
      a.target   = "_blank";
      a.click();

      setShowInvoice(false);
      setMessage(`✅ Invoice ${inv.invoiceNumber} saved & downloaded`);
      fetchOrderInvoices();
      fetchOrder();

      // Auto-open send modal after generation
      const pdfRes = await fetch(`${API}/api/invoices/${inv._id}/pdf`);
      const ab = await pdfRes.arrayBuffer();
      const uint8 = new Uint8Array(ab);
      let bin = ""; uint8.forEach(b => bin += String.fromCharCode(b));
      const base64 = btoa(bin);
      setInvoiceSendModal({ invoiceId: inv._id, pdfBase64: base64, pdfName: `Invoice-${inv.invoiceNumber}.pdf`, invoiceNumber: inv.invoiceNumber });
      setInvSendTo(order?.customerEmail || "");
      setInvSubject(`Invoice #${inv.invoiceNumber} — ${order?.refNumber || ""}`);
      setInvBody(`Dear Customer,\n\nPlease find your invoice attached.\n\nInvoice #${inv.invoiceNumber}\n\nThank you for your business.\n\nRegards,\nDDG OPS`);
    } catch (e) {
      setMessage("Invoice generation failed");
    }
    setInvoiceSaving(false);
  };

  const sendInvoiceEmail = async () => {
    if (!invoiceSendModal) return;
    const to = invSendTo.trim();
    if (!to) return alert("Enter customer email.");
    setInvSending(true);
    try {
      // Uses the dedicated send endpoint — auto-attaches invoice PDF + Draft doc from order files
      const res = await fetch(`${API}/api/invoices/${invoiceSendModal.invoiceId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: invSubject, body: invBody }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");

      await fetch(`${API}/api/orders/${id}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "Invoice Sent", details: `Customer: ${to} | Invoice #${invoiceSendModal.invoiceNumber} | Attachments: ${data.attachments?.join(", ")}` }),
      });
      fetchOrder();
      fetchOrderInvoices();
      setInvoiceSendModal(null);
      setMessage(`✅ Invoice sent to ${to}${data.attachments?.length > 1 ? ` with ${data.attachments.length} attachments` : ""}`);
    } catch (e) {
      setMessage(`❌ Failed to send invoice: ${e.message}`);
    }
    setInvSending(false);
  };

  if (!order) return <p>Loading order...</p>;

  const statusStyle = (s) => {
    const map = {
      "New Order":         { bg:"rgba(107,114,128,0.18)", color:"#9ca3af", border:"rgba(107,114,128,0.35)" },
      "Awaiting Pickup":   { bg:"rgba(217,119,6,0.18)",   color:"#fbbf24", border:"rgba(251,191,36,0.35)" },
      "Picked Up":         { bg:"rgba(37,99,235,0.18)",   color:"#60a5fa", border:"rgba(96,165,250,0.35)" },
      "Delivered": { bg:"rgba(124,58,237,0.18)",  color:"#a78bfa", border:"rgba(167,139,250,0.35)" },
      "Waiting to Sail":   { bg:"rgba(234,88,12,0.18)",   color:"#fb923c", border:"rgba(251,146,60,0.35)" },
      "Sailed":            { bg:"rgba(5,150,105,0.18)",   color:"#34d399", border:"rgba(52,211,153,0.35)" },
      "Arrived":           { bg:"rgba(8,145,178,0.18)",   color:"#22d3ee", border:"rgba(34,211,238,0.35)" },
      "Paid":              { bg:"rgba(22,163,74,0.18)",   color:"#4ade80", border:"rgba(74,222,128,0.35)" },
      "Completed":         { bg:"rgba(21,128,61,0.22)",   color:"#86efac", border:"rgba(134,239,172,0.35)" },
      "Problem / Hold":    { bg:"rgba(220,38,38,0.18)",   color:"#f87171", border:"rgba(248,113,113,0.35)" },
    };
    return map[s] || map["New Order"];
  };

  const invoiceTotal = invoiceItems.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const filteredVoyages = voyages.filter((v) => {
    const search = voyageSearch.toLowerCase();

    if (!search) return true;

    return (
      v.name.toLowerCase().includes(search) ||
      v.shippingLine.toLowerCase().includes(search)
    );
  });

  const sortedTimeline = [...(order.timeline || [])].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const timelineToShow = showFullTimeline
    ? sortedTimeline
    : sortedTimeline.slice(0, 3);

  const handleVoyageKeyDown = async (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setShowVoyageList(true);

      setHighlightedIndex((prev) =>
        Math.min(prev + 1, filteredVoyages.length - 1)
      );
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();

      setHighlightedIndex((prev) =>
        Math.max(prev - 1, 0)
      );
    }

    if (e.key === "Enter") {
      e.preventDefault();

      if (filteredVoyages.length > 0) {
        await moveToVoyage(filteredVoyages[highlightedIndex]);
      } else {
        await createVoyageAndMove();
      }
    }
  };

  return (
    <div>
      {/* ── Page Header ─────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800 }}>Order #{order.refNumber}</h1>
          <p style={{ color: "var(--text-primary)", fontWeight: 500 }}>{order.year} {order.make} {order.model} — {order.vin}</p>
          {order.voyageFolderName && (
            <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: 10 }}>
              <p style={{ margin: 0 }}>
                <strong>Voyage:</strong> {order.shippingLine} / {order.voyageFolderName}
              </p>
              <button onClick={clearVoyage} style={{ padding: "5px 10px", borderRadius: 7, border: "none",
                background: "#991b1b", color: "white", cursor: "pointer", fontSize: 12 }}>
                Clear Voyage
              </button>
            </div>
          )}
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
          {message && <span style={{ fontSize:12, color:"var(--text-muted)" }}>{message}</span>}
          {/* Big status badge — click to change */}
          <div style={{ position:"relative" }}>
            <select
              value={order.status}
              onChange={(e) => updateStatus(e.target.value)}
              style={{
                appearance:"none", WebkitAppearance:"none",
                padding:"12px 48px 12px 20px",
                borderRadius:14,
                fontWeight:900,
                fontSize:22,
                letterSpacing:"0.06em",
                textTransform:"uppercase",
                border:`2px solid ${statusStyle(order.status).border}`,
                background:statusStyle(order.status).bg,
                color:statusStyle(order.status).color,
                cursor:"pointer",
                minWidth:200,
              }}>
              <option>New Order</option>
              <option>Awaiting Pickup</option>
              <option>Picked Up</option>
              <option>Delivered</option>
              <option>Waiting to Sail</option>
              <option>Sailed</option>
              <option>Arrived</option>
              <option>Paid</option>
              <option>Completed</option>
              <option>Problem / Hold</option>
            </select>
            <span style={{ position:"absolute", right:14, top:"50%", transform:"translateY(-50%)",
              pointerEvents:"none", color:statusStyle(order.status).color, fontSize:14 }}>▼</span>
          </div>
        </div>
      </div>

      {/* ── Action Buttons ───────────────────────────── */}
      {(() => {
        const drSentEntry     = [...(order.timeline||[])].reverse().find(t => t.action === "DR Sent");
        const invSentEntry    = [...(order.timeline||[])].reverse().find(t => t.action === "Invoice Sent");
        const sentBadge = (entry, label) => entry ? (
          <span style={{ fontSize:11, color:"#34d399", background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:6, padding:"3px 8px", whiteSpace:"nowrap" }}>
            ✅ {label} {new Date(entry.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
          </span>
        ) : null;
        return (
          <div style={{ display:"flex", gap:8, marginBottom:6, flexWrap:"wrap", alignItems:"center" }}>
            {sentBadge(drSentEntry, "DR Sent")}
            {sentBadge(invSentEntry, "Invoice Sent")}
          </div>
        );
      })()}
      <div style={{ display: "flex", gap: "10px", marginBottom: orderInvoices.length > 0 ? 10 : "20px", flexWrap: "wrap" }}>
        <button onClick={openEdit} style={{ padding: "10px 14px", borderRadius: "10px", border: "none",
            background: "#7c3aed", color: "white", cursor: "pointer", fontSize: "13px" }}>
          ✏️ Edit Order
        </button>
        <button onClick={() => openDrPreview()} style={{ padding: "10px 14px", borderRadius: "10px",
            border: "none", background: "#059669", color: "white", cursor: "pointer", fontSize: "13px" }}>
          Generate Dock Receipt
        </button>
        <button onClick={async () => {
          const base = drPayload || order;
          const ymm = base.vehicleYearMakeModel || `${base.year||""} ${base.make||""} ${base.model||""}`.trim();
          const vin = base.vin || order.vin || "";
          const pdfName = `${order.refNumber||"dock-receipt"} DR.pdf`;
          // Auto-generate DR silently if not yet cached
          let b64 = lastDrBase64;
          if (!b64) {
            try {
              setMessage("Generating DR…");
              const payload = {
                ...base,
                referenceNumber: base.refNumber || base.referenceNumber,
                vehicleYearMakeModel: base.vehicleYearMakeModel || `${base.year||""} ${base.make||""} ${base.model||""}`.trim(),
                portOfLoading: base.pol || base.portOfLoading || "",
                portOfDischarge: base.pod || base.portOfDischarge || "",
                weightKgs: drWeightOverride || base.weightKgs || "",
              };
              const res = await fetch(`${API}/generate-pdf`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              if (!res.ok) throw new Error("DR generation failed");
              const buf = await res.arrayBuffer();
              b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
              setLastDrBase64(b64);
              setMessage("");
            } catch(e) {
              setMessage("❌ Could not generate DR: " + e.message);
              return;
            }
          }
          setDrSendModal({ pdfBase64: b64, pdfName });
          setDrSendTo(order.customerEmail || "");
          setDrSendTrucker("");
          setDrSendSubject(`Dock Receipt - ${order.refNumber||""} | ${ymm} | VIN: ${vin.slice(-6)}`);
          setDrSendBody(`Please find your Dock Receipt attached.\n\nVIN: ${vin}\nVessel: ${base.vessel||""} | Voyage: ${base.voyage||""}\nPort of Loading: ${base.pol||base.portOfLoading||""}\n\nRegards,\nDor Ldor Global`);
        }} style={{ padding:"10px 14px", borderRadius:"10px", border:"none", background:"#2563eb", color:"white", cursor:"pointer", fontSize:"13px" }}>
          ✉️ Send DR
        </button>
      </div>

      {/* ── Invoice Status Bar ───────────────────────── */}
      {orderInvoices.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {orderInvoices.map(inv => {
            const statusClr = inv.status === "paid" ? "#34d399" : inv.status === "sent" ? "#60a5fa" : "#9ca3af";
            const statusBg  = inv.status === "paid" ? "rgba(5,150,105,0.12)" : inv.status === "sent" ? "rgba(37,99,235,0.12)" : "rgba(107,114,128,0.12)";
            return (
              <div key={inv._id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                borderRadius: 10, border: `1px solid ${statusClr}44`,
                background: statusBg, fontSize: 12,
              }}>
                <span style={{ fontWeight: 700, fontFamily: "monospace", color: "var(--accent)" }}>
                  {inv.invoiceNumber}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  ${Number(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span style={{ fontWeight: 700, color: statusClr, textTransform: "uppercase", fontSize: 11 }}>
                  {inv.status}
                </span>
                <button onClick={() => window.open(`${API}/api/invoices/${inv._id}/pdf`, "_blank")}
                  style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "1px solid var(--border)",
                    background: "var(--bg-panel)", color: "var(--text-secondary)", cursor: "pointer" }}>
                  PDF
                </button>
                {inv.status !== "paid" && (
                  <button onClick={async () => {
                    await fetch(`${API}/api/invoices/${inv._id}/status`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "paid" }),
                    });
                    fetchOrderInvoices(); fetchOrder();
                    setMessage(`Invoice ${inv.invoiceNumber} marked as Paid`);
                  }} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "none",
                    background: "rgba(5,150,105,0.2)", color: "#34d399", cursor: "pointer", fontWeight: 600 }}>
                    ✓ Mark Paid
                  </button>
                )}
                {inv.status === "draft" && (
                  <button onClick={async () => {
                    await fetch(`${API}/api/invoices/${inv._id}/status`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "sent" }),
                    });
                    fetchOrderInvoices(); fetchOrder();
                    setMessage(`Invoice ${inv.invoiceNumber} marked as Sent`);
                  }} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 5, border: "none",
                    background: "rgba(37,99,235,0.2)", color: "#60a5fa", cursor: "pointer", fontWeight: 600 }}>
                  ✈ Mark Sent
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dashboard Cards ──────────────────────────── */}
      <div className="dashboard-grid">
        <div className="dashboard-card">
          <span>Customer</span>
          <strong className="small">{order.customerName || "—"}</strong>
        </div>
        <div className="dashboard-card">
          <span>Request Date</span>
          <strong className="small">{order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}</strong>
        </div>
        <div className="dashboard-card">
          <span>VIN / Chassis</span>
          <strong className="small" style={{ fontFamily: "monospace", letterSpacing: "0.04em" }}>
            {order.vin || "—"}
          </strong>
          <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Lot# <strong style={{ color: "var(--text-secondary)" }}>{order.lotNumber || "—"}</strong>
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              PIN <strong style={{ color: order.pin ? "#fbbf24" : "var(--text-muted)" }}>{order.pin || "—"}</strong>
            </span>
          </div>
        </div>
        {/* Sailed Workflow — replaces status card */}
        <div className="dashboard-card" style={{ cursor:"default", gridColumn:"span 2" }}>
          <span style={{ marginBottom:8, display:"block" }}>Sailed Workflow</span>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <div ref={voyageContainerRef} style={{ position:"relative", flex:1, minWidth:220 }}>
              <input
                placeholder="Search voyage or type new name..."
                value={voyageSearch}
                onFocus={() => setShowVoyageList(true)}
                onChange={(e) => { setVoyageSearch(e.target.value); setHighlightedIndex(0); setShowVoyageList(true); }}
                onKeyDown={handleVoyageKeyDown}
                style={{ width:"100%", padding:"8px 36px 8px 10px", borderRadius:8, boxSizing:"border-box", fontSize:13 }}
              />
              <button type="button" onClick={() => setShowVoyageList(!showVoyageList)}
                style={{ position:"absolute", right:4, top:4, height:28, width:28,
                  background:"var(--bg-panel)", borderRadius:6, cursor:"pointer", padding:0, fontSize:11 }}>▼</button>
              {showVoyageList && (
                <div style={{ position:"absolute", zIndex:20, top:40, left:0, right:0,
                  maxHeight:200, overflow:"auto", border:"1px solid var(--border)",
                  borderRadius:10, background:"var(--bg-elevated)", boxShadow:"var(--shadow-lg)" }}>
                  {filteredVoyages.map((v, index) => (
                    <div key={v.id} onMouseDown={() => moveToVoyage(v)}
                      style={{ padding:"9px 12px", cursor:"pointer",
                        borderBottom:"1px solid var(--border-muted)",
                        background: index === highlightedIndex ? "var(--accent-dim)" : "transparent",
                        color:"var(--text-primary)" }}>
                      <strong>{v.name}</strong>
                      <span style={{ marginLeft:8, color:"var(--text-muted)", fontSize:12 }}>{v.shippingLine}</span>
                    </div>
                  ))}
                  {filteredVoyages.length === 0 && (
                    <div style={{ padding:14, color:"var(--text-muted)", fontSize:13 }}>No voyage found.</div>
                  )}
                </div>
              )}
            </div>
            <button onClick={createVoyageAndMove}
              style={{ padding:"8px 12px", borderRadius:8, border:"none",
                background:"#111827", color:"white", cursor:"pointer", fontSize:12, whiteSpace:"nowrap" }}>
              + New Voyage
            </button>
          </div>
        </div>
        <div className="dashboard-card">
          <span>Order Type</span>
          <strong>{order.requestType || "—"}</strong>
        </div>
      </div>

      {/* ── Info Panels ─────────────────────────────── */}
      <div className="details-grid">

        {/* Customer */}
        <section className="form-section">
          <h2>Customer</h2>
          <p style={{ margin: "0 0 2px" }}><strong>{order.customerName || "—"}</strong></p>
          {order.contactName  && <p style={{ margin: "0 0 4px", fontSize: 13, color:"var(--text-secondary)" }}>{order.contactName}</p>}
          {order.customerPhone && <p style={{ margin: "0 0 4px", fontSize: 13 }}>📞 {order.customerPhone}</p>}
          {order.customerEmail && <p style={{ margin: "0 0 10px", fontSize: 13 }}>✉️ {order.customerEmail}</p>}
          {/* Source / Office tag */}
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>SOURCE / OFFICE</label>
            <select
              value={order.source || ""}
              onChange={async e => {
                await fetch(`${API}/api/orders/${id}`, {
                  method: "PUT", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source: e.target.value }),
                });
                fetchOrder();
              }}
              style={{ padding: "5px 8px", borderRadius: 6, fontSize: 12,
                border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", width: "100%" }}>
              <option value="USA OFFICE">🇺🇸 USA Office</option>
              <option value="GHANA OFFICE">🇬🇭 Ghana Office</option>
            </select>
          </div>
          {/* Order Type — change inline */}
          <div>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>ORDER TYPE</label>
            <div style={{ display:"flex", gap:6 }}>
              {["RORO","Container"].map(t => {
                const active = (order.requestType || "RORO") === t;
                return (
                  <button key={t} type="button"
                    onClick={async () => {
                      await fetch(`${API}/api/orders/${id}`, {
                        method:"PUT", headers:{"Content-Type":"application/json"},
                        body: JSON.stringify({ requestType: t }),
                      });
                      fetchOrder();
                    }}
                    style={{
                      flex:1, padding:"5px 0", borderRadius:6, cursor:"pointer", fontWeight:600,
                      fontSize:12, border:"none",
                      background: active ? (t==="Container" ? "#2563eb" : "#059669") : "var(--bg-panel)",
                      color: active ? "#fff" : "var(--text-muted)",
                      outline: active ? "none" : "1px solid var(--border)",
                    }}>{t}</button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pickup & Delivery + Costs */}
        <section className="form-section">
          <h2>Pickup &amp; Delivery</h2>
          <p style={{ margin: "0 0 4px", fontSize: 13 }}>
            <strong>Pickup:</strong> {order.pickupLocation || "—"}
          </p>
          <p style={{ margin: "0 0 12px", fontSize: 13 }}>
            <strong>Delivery:</strong> {order.deliveryLocation || "—"}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 110, padding: "10px 14px", borderRadius: 9,
              background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 4 }}>Towing</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                ${Number(charges.towingCharge || 0).toLocaleString(undefined,
                  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 110, padding: "10px 14px", borderRadius: 9,
              background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                letterSpacing: "0.06em", marginBottom: 4 }}>Ocean Freight</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                ${Number(charges.oceanFreight || 0).toLocaleString(undefined,
                  { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </section>

        {/* Vehicle */}
        <section className="form-section">
          <h2>Vehicle</h2>
          <p style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
            {[order.year, order.make, order.model].filter(Boolean).join(" ") || "—"}
          </p>
          <p style={{ margin: "0 0 10px", fontFamily: "monospace", fontSize: 13,
            color: "var(--text-muted)", letterSpacing: "0.05em" }}>{order.vin || "—"}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {order.condition || "—"}
            </span>
            <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              Title: {order.titleStatus || "—"}
            </span>
          </div>
        </section>

        {/* Shipment — route big + bold */}
        <section className="form-section">
          <h2>Shipment</h2>
          {/* Big route display */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            padding: "12px 16px", background: "var(--bg-panel)", borderRadius: 10,
            border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)",
              letterSpacing: "0.03em" }}>{order.pol || "—"}</span>
            <span style={{ fontSize: 20, color: "var(--text-muted)", fontWeight: 400 }}>→</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)",
              letterSpacing: "0.03em" }}>{order.pod || "—"}</span>
          </div>
          {(order.consigneeName || order.buyerName) && (
            <p style={{ margin: "0 0 8px", fontSize: 13 }}>
              <strong>Consignee / Buyer:</strong>{" "}
              {order.consigneeName || order.buyerName}
              {order.consigneeName && order.buyerName && order.consigneeName !== order.buyerName && (
                <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 12 }}>({order.buyerName})</span>
              )}
            </p>
          )}
          <p style={{ margin: "0 0 4px", fontSize: 13 }}><strong>Line:</strong> {order.shippingLine || "—"}</p>
          <p style={{ margin: "0 0 4px", fontSize: 13 }}><strong>Booking #:</strong> {order.bookingNumber || "—"}</p>
          {order.requestType === "Container" && (
            <>
              <p style={{ margin: "0 0 4px", fontSize: 13 }}><strong>Container #:</strong> {order.containerNumber || "—"}</p>
              <p style={{ margin: "0 0 4px", fontSize: 13 }}><strong>Seal #:</strong> {order.sealNumber || "—"}</p>
            </>
          )}
          <p style={{ margin: "0 0 10px", fontSize: 13 }}><strong>Type:</strong> {order.requestType}</p>

          {/* ── Vessel & Schedule Dates ── */}
          <div style={{ borderTop:"1px solid var(--border)", paddingTop:12, marginTop:4 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <strong style={{ fontSize:13 }}>Vessel & Schedule</strong>
              <button
                onClick={() => lookupAndApplySchedule(order.vessel, order.pol, order.pod)}
                disabled={scheduleLooking || !order.vessel || !order.pol || !order.pod}
                title="Look up dates from master schedule"
                style={{ fontSize:11, padding:"3px 9px", borderRadius:6, border:"1px solid var(--border)",
                  background:"var(--bg-panel)", color:"var(--accent)", cursor:"pointer" }}>
                {scheduleLooking ? "Looking…" : "🔄 Lookup"}
              </button>
            </div>
            <div style={{ marginBottom:6 }}>
              <select
                value={order.vessel || ""}
                onChange={async e => {
                  await fetch(`${API}/api/orders/${id}`, {
                    method:"PUT", headers:{"Content-Type":"application/json"},
                    body: JSON.stringify({ vessel: e.target.value }),
                  });
                  fetchOrder();
                  if (e.target.value && order.pol && order.pod)
                    lookupAndApplySchedule(e.target.value, order.pol, order.pod);
                }}
                style={{ width:"100%", padding:"5px 8px", borderRadius:6, fontSize:13,
                  border:"1px solid var(--border)", background:"var(--bg-input)", color:"var(--text-primary)" }}>
                <option value="">Select vessel…</option>
                {order.vessel && !scheduleVessels.includes(order.vessel) && (
                  <option value={order.vessel}>{order.vessel}</option>
                )}
                {scheduleVessels.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, fontSize:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ color:"var(--text-muted)" }}>Voyage:</span>
                <input
                  defaultValue={order.voyage || ""}
                  placeholder="e.g. GAB0326"
                  onBlur={async e => {
                    const val = e.target.value.trim();
                    await fetch(`${API}/api/orders/${id}`, {
                      method:"PUT", headers:{"Content-Type":"application/json"},
                      body: JSON.stringify({ voyage: val }),
                    });
                    fetchOrder();
                  }}
                  style={{ fontWeight:700, fontSize:12, width:90, padding:"2px 6px",
                    background:"var(--bg-input)", border:"1px solid var(--border)",
                    borderRadius:4, color:"var(--text-primary)" }}
                />
              </div>
              <div><span style={{ color:"var(--text-muted)" }}>Cutoff:</span> <strong>{order.cutoffDate || "—"}</strong></div>
              <div><span style={{ color:"var(--text-muted)" }}>Sail:</span> <strong style={{ color:"#34d399" }}>{order.sailDate || "—"}</strong></div>
              <div><span style={{ color:"var(--text-muted)" }}>Arrival:</span> <strong>{order.arrivalDate || "—"}</strong></div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Documents ───────────────────────────────── */}
      <section className="form-section">
        <h2>Documents</h2>


        <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:16 }}>
          {order.driveFolderLink && (
            <a href={order.driveFolderLink} target="_blank" rel="noreferrer"
              style={{ fontSize:13, color:"var(--accent)" }}>
              Open Google Drive Folder
            </a>
          )}
          <button onClick={parseExistingDriveFiles}
            style={{ padding:"7px 12px", borderRadius:8, border:"1px solid var(--border)",
              background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer", fontSize:12 }}>
            Re-parse Drive Files
          </button>
        </div>

        {/* ── Labeled upload zones ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(105px, 1fr))", gap:8, marginBottom:16 }}>
          {[
            { label:"Buyer Receipt",      icon:"🧾" },
            { label:"Email",              icon:"📧" },
            { label:"Order Request Form", icon:"📋" },
            { label:"Dispatch",           icon:"🚛" },
            { label:"Title",              icon:"📜" },
            { label:"AES",                icon:"📋" },
            { label:"Dock Receipt",       icon:"🚢" },
            { label:"Stamped DR",         icon:"📌" },
            { label:"Draft",              icon:"📝" },
            { label:"Rated Draft",        icon:"🧮" },
            { label:"Other",              icon:"📎" },
          ].map(({ label, icon }) => {
            const busy = (uploadingLabels[label] || 0) > 0;
            const drag = draggingLabel === label;
            return (
              <div key={label}
                onDragOver={e  => { e.preventDefault(); setDraggingLabel(label); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDraggingLabel(null); }}
                onDrop={e => {
                  e.preventDefault(); setDraggingLabel(null);
                  Array.from(e.dataTransfer.files).forEach(f => uploadFile(f, label));
                }}
                onClick={() => document.getElementById(`zone-${label}`).click()}
                style={{
                  border:`2px dashed ${drag ? "var(--accent)" : "var(--border)"}`,
                  borderRadius:10, padding:"14px 6px", textAlign:"center", cursor:"pointer",
                  background: drag ? "rgba(99,102,241,0.07)" : "var(--bg-panel)",
                  transition:"all 0.15s", minHeight:70,
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4,
                }}>
                <input id={`zone-${label}`} type="file" multiple hidden
                  onChange={e => {
                    Array.from(e.target.files).forEach(f => uploadFile(f, label));
                    e.target.value = "";
                  }} />
                <span style={{ fontSize:20 }}>{busy ? "⏳" : icon}</span>
                <span style={{ fontSize:11, fontWeight:600, color:"var(--text-secondary)", lineHeight:1.2 }}>
                  {busy ? "Uploading…" : label}
                </span>
                {!busy && (() => {
                  const autoMap = { "Dispatch":"→ Awaiting Pickup", "Dock Receipt":"→ Picked Up", "Stamped DR":"→ Delivered", "Draft":"→ Waiting to Sail" };
                  const hint = autoMap[label];
                  return hint ? <span style={{ fontSize:9, color:"#34d399", opacity:0.8, lineHeight:1 }}>{hint}</span> : null;
                })()}
              </div>
            );
          })}
        </div>

        {/* ── File list ── */}
        <table className="orders-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Modified</th>
              <th>View</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {driveFiles.map((f) => {
              const match = (order.files || []).find(of =>
                of.filename === f.name || of.originalName === f.name
              );
              const label = match?.label || "Document";
              const isDispatch    = label === "Dispatch";
              const isRatedDraft  = label === "Rated Draft";

              const createBillFromDoc = async (docLabel) => {
                try {
                  setMessage(`Parsing ${docLabel}...`);
                  const res = await fetch(`${API}/api/expenses/parse-dispatch-url`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: f.webViewLink, filename: f.name, orderRef: order.refNumber, orderId: order._id }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "Parse failed");
                  sessionStorage.setItem("dispatchParseResult", JSON.stringify({ rows: data, orderRef: order.refNumber, orderId: order._id }));
                  navigate("/expenses?importDispatch=1");
                } catch(e) {
                  alert("Parse failed: " + e.message);
                  setMessage("❌ Parse failed: " + e.message);
                }
              };

              return (
                <tr key={f.id} onClick={() => setDocPreview({ name: f.name, url: f.webViewLink, label })}
                  style={{ cursor: "pointer" }}>
                  <td>{f.name}</td>
                  <td>
                    <span style={{ fontSize:11, padding:"2px 7px", borderRadius:5,
                      background: isRatedDraft ? "rgba(234,179,8,0.15)" : "var(--bg-panel)",
                      color:      isRatedDraft ? "#fbbf24"              : "var(--text-secondary)",
                      border:`1px solid ${isRatedDraft ? "rgba(251,191,36,0.3)" : "var(--border)"}` }}>
                      {label}
                    </span>
                  </td>
                  <td>{f.modifiedTime ? new Date(f.modifiedTime).toLocaleString() : ""}</td>
                  <td><a href={f.webViewLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>↗ Open</a></td>
                  <td style={{ display:"flex", gap:6, alignItems:"center" }}>
                    {isDispatch && (
                      <button
                        title="Create Bill from Dispatch"
                        onClick={() => createBillFromDoc("Dispatch")}
                        style={{ background:"none", border:"none", cursor:"pointer", color:"#60a5fa", fontSize:13, padding:"2px 6px", borderRadius:4, whiteSpace:"nowrap" }}>
                        📋 Create Bill from Dispatch
                      </button>
                    )}
                    {isRatedDraft && (
                      <button
                        title="Create Bill from Rated Draft"
                        onClick={() => createBillFromDoc("Rated Draft")}
                        style={{ background:"none", border:"none", cursor:"pointer", color:"#fbbf24", fontSize:13, padding:"2px 6px", borderRadius:4, whiteSpace:"nowrap" }}>
                        🧮 Create Bill from Rated Draft
                      </button>
                    )}
                    <a href={f.webViewLink} download onClick={e => e.stopPropagation()}
                      style={{ background:"none", border:"1px solid var(--border)", borderRadius:5,
                        color:"var(--text-secondary)", fontSize:11, padding:"3px 9px",
                        cursor:"pointer", textDecoration:"none", whiteSpace:"nowrap" }}>
                      ⬇ Download
                    </a>
                    <button onClick={e => { e.stopPropagation(); deleteFile(f.id, f.name); }}
                      style={{ background:"none", border:"1px solid rgba(248,113,113,0.3)", borderRadius:5,
                        cursor:"pointer", color:"#f87171", fontSize:11, padding:"3px 9px", whiteSpace:"nowrap" }}>
                      🗑 Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── Internal Cost & Margin ──────────────────── */}
      {(() => {
        const fmt   = n => "$" + Math.abs(Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
        const pClr  = n => n > 0 ? "#34d399" : n < 0 ? "#f87171" : "var(--text-muted)";
        const pStr  = n => n === 0 ? "—" : (n>0?"+":"−") + fmt(n);
        const inpStyle = (clr) => ({
          width:"100%", textAlign:"right", background:"transparent",
          border:"1px solid var(--border)", borderRadius:5, padding:"3px 7px",
          color:clr, fontSize:12, MozAppearance:"textfield",
        });
        const towSell   = Number(charges.towingCharge  || 0);
        const towCost   = Number(charges.towingCost    || 0);
        const ocnSell   = Number(charges.oceanFreight  || 0);
        const ocnCost   = Number(charges.oceanCost     || 0);
        // Fee rows with non-zero sell values
        const activeFeeRows = feeRows.filter(([key]) => Number(charges[key] || 0) > 0);
        const feeTotal     = activeFeeRows.reduce((s,[key]) => s + Number(charges[key]||0), 0);
        const feeCostTotal = activeFeeRows.reduce((s,[key]) => s + Number(charges[key+"Cost"]||0), 0);
        const totSell   = towSell + ocnSell + feeTotal;
        const totCost   = towCost + ocnCost + feeCostTotal;
        const totProfit = totSell - totCost;
        return (
          <section className="form-section" style={{ borderColor:"rgba(251,191,36,0.2)", background:"rgba(251,191,36,0.03)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <span style={{ fontSize:10, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase",
                color:"#fbbf24", background:"rgba(251,191,36,0.15)", border:"1px solid rgba(251,191,36,0.3)",
                padding:"2px 8px", borderRadius:6 }}>🔒 Internal — Not Printed</span>
            </div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  <th style={{ textAlign:"left",  padding:"4px 8px", fontSize:11, color:"var(--text-muted)", fontWeight:600 }}>Item</th>
                  <th style={{ textAlign:"right", padding:"4px 8px", fontSize:11, color:"var(--accent)",    fontWeight:600 }}>Sell</th>
                  <th style={{ textAlign:"right", padding:"4px 8px", fontSize:11, color:"#f87171",          fontWeight:600 }}>Cost</th>
                  <th style={{ textAlign:"right", padding:"4px 8px", fontSize:11, color:"#34d399",          fontWeight:600 }}>Profit</th>
                  <th style={{ width:28 }}></th>
                </tr>
              </thead>
              <tbody>
                {/* Towing row — edit button */}
                {(() => {
                  const editing = editingInternalRow === "towing";
                  return (
                    <tr style={{ borderBottom:"1px solid var(--border)" }}>
                      <td style={{ padding:"5px 8px" }}>
                        <div style={{ fontWeight:600 }}>Towing</div>
                        {(order.pickupLocation || order.pickupCity) && (
                          <div style={{ fontSize:10, color:"var(--text-muted)", marginTop:1 }}>
                            {(() => {
                              const loc = order.pickupLocation || "";
                              const city = order.pickupCity || "";
                              const state = order.pickupState || "";
                              // Build "COPART JOBSTOWN, NJ" style label
                              const cityState = [city, state].filter(Boolean).join(", ");
                              const full = loc && cityState && !loc.toUpperCase().includes(city.toUpperCase())
                                ? `${loc} — ${cityState}`
                                : loc || cityState;
                              return full;
                            })()}
                            {order.deliveryLocation ? ` → ${order.deliveryLocation}` : ""}
                          </div>
                        )}
                      </td>
                      {editing ? (
                        <>
                          <td style={{ padding:"4px 6px" }}>
                            <input key={`ts-${charges.towingCharge}`} type="number" autoFocus
                              defaultValue={charges.towingCharge || ""}
                              onBlur={e => { saveInternalField("towingCharge", e.target.value); setEditingInternalRow(null); }}
                              style={inpStyle("var(--accent)")} placeholder="0" />
                          </td>
                          <td style={{ padding:"4px 6px" }}>
                            <input key={`tc-${charges.towingCost}`} type="number"
                              defaultValue={charges.towingCost || ""}
                              onBlur={e => { saveInternalField("towingCost", e.target.value); setEditingInternalRow(null); }}
                              style={inpStyle("#f87171")} placeholder="0" />
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ textAlign:"right", padding:"5px 8px", color:"var(--accent)", fontWeight:700 }}>
                            {towSell > 0 ? fmt(towSell) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                          </td>
                          <td style={{ textAlign:"right", padding:"5px 8px", color:"#f87171", fontWeight:700 }}>
                            {towCost > 0 ? fmt(towCost) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                          </td>
                        </>
                      )}
                      <td style={{ textAlign:"right", padding:"5px 8px", fontWeight:700, color:pClr(towSell-towCost) }}>
                        {pStr(towSell-towCost)}
                      </td>
                      <td style={{ textAlign:"center", padding:"4px 6px" }}>
                        <button onClick={() => setEditingInternalRow(editing ? null : "towing")}
                          style={{ background:"none", border:"none", cursor:"pointer",
                            color: editing ? "#34d399" : "#60a5fa", fontSize:12, padding:"2px 4px" }}>
                          {editing ? "✓" : "✏️"}
                        </button>
                      </td>
                    </tr>
                  );
                })()}
                {/* Ocean row — edit button with route lookup */}
                {(() => {
                  const editing = editingInternalRow === "ocean";

                  const openOceanEdit = () => {
                    setOceanEditForm({
                      pol:          order.pol          || "",
                      pod:          order.pod          || "",
                      shippingLine: order.shippingLine || "",
                      sell:         charges.oceanFreight || "",
                      cost:         charges.oceanCost    || "",
                      category:     charges.oceanCategory || "1",
                    });
                    setEditingInternalRow("ocean");
                  };

                  const lookupOceanPrice = async (categoryOverride) => {
                    setOceanLooking(true);
                    try {
                      const rates = await fetch(`${API}/api/pricing?type=ocean`).then(r => r.json());
                      const pol = (oceanEditForm.pol || "").toUpperCase();
                      const pod = (oceanEditForm.pod || "").toUpperCase();
                      const sl  = (oceanEditForm.shippingLine || "").toUpperCase();
                      const cat = categoryOverride || oceanEditForm.category || "1";
                      const match =
                        rates.find(r => (r.pol||"").toUpperCase()===pol && (r.pod||"").toUpperCase()===pod && (r.shippingLine||"").toUpperCase()===sl && r.category===cat) ||
                        rates.find(r => (r.pol||"").toUpperCase()===pol && (r.pod||"").toUpperCase()===pod && r.category===cat) ||
                        rates.find(r => (r.pol||"").toUpperCase()===pol && (r.pod||"").toUpperCase()===pod && (r.shippingLine||"").toUpperCase()===sl) ||
                        rates.find(r => (r.pol||"").toUpperCase()===pol && (r.pod||"").toUpperCase()===pod);
                      if (match) {
                        setOceanEditForm(f => ({ ...f, sell: String(match.portPrice||""), cost: String(match.cost||"") }));
                        setMessage(`✅ Cat. ${cat} price found: $${match.portPrice}`);
                      } else {
                        setMessage("⚠️ No pricing found for that route");
                      }
                    } catch { setMessage("⚠️ Pricing lookup failed"); }
                    setOceanLooking(false);
                  };

                  const saveOceanEdit = async () => {
                    const res = await fetch(`${API}/api/orders/${id}`, {
                      method:  "PUT",
                      headers: { "Content-Type": "application/json" },
                      body:    JSON.stringify({
                        pol:          oceanEditForm.pol.toUpperCase(),
                        pod:          oceanEditForm.pod.toUpperCase(),
                        shippingLine: oceanEditForm.shippingLine.toUpperCase(),
                        charges: { ...charges, oceanFreight: oceanEditForm.sell, oceanCost: oceanEditForm.cost, oceanCategory: oceanEditForm.category },
                      }),
                    });
                    const data = await res.json();
                    if (res.ok) { setOrder(data); setCharges(data.charges || {}); }
                    setEditingInternalRow(null);
                  };

                  const currentCat = charges.oceanCategory || "1";

                  return (
                    <tr style={{ borderBottom:"1px solid var(--border)" }}>
                      <td style={{ padding:"5px 8px" }}>
                        {editing ? (
                          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                            <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                              <input value={oceanEditForm.pol}
                                onChange={e => setOceanEditForm(f => ({ ...f, pol: e.target.value.toUpperCase() }))}
                                placeholder="POL"
                                style={{ width:60, padding:"3px 6px", fontSize:12, borderRadius:5,
                                  border:"1px solid var(--border)", background:"var(--bg-input)", color:"var(--text-primary)",
                                  textTransform:"uppercase" }} />
                              <span style={{ color:"var(--text-muted)", fontSize:12 }}>→</span>
                              <input value={oceanEditForm.pod}
                                onChange={e => setOceanEditForm(f => ({ ...f, pod: e.target.value.toUpperCase() }))}
                                placeholder="POD"
                                style={{ width:60, padding:"3px 6px", fontSize:12, borderRadius:5,
                                  border:"1px solid var(--border)", background:"var(--bg-input)", color:"var(--accent)",
                                  textTransform:"uppercase" }} />
                              {/* Category toggle */}
                              <div style={{ display:"flex", borderRadius:5, overflow:"hidden", border:"1px solid var(--border)", flexShrink:0 }}>
                                {["1","2"].map(cat => (
                                  <button key={cat} onClick={() => {
                                    setOceanEditForm(f => ({ ...f, category: cat }));
                                    lookupOceanPrice(cat);
                                  }}
                                    style={{ padding:"3px 8px", fontSize:11, border:"none", cursor:"pointer", fontWeight:700,
                                      background: oceanEditForm.category === cat ? "#7c3aed" : "var(--bg-panel)",
                                      color:      oceanEditForm.category === cat ? "white"   : "var(--text-muted)" }}>
                                    Cat {cat}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                              <input value={oceanEditForm.shippingLine}
                                onChange={e => setOceanEditForm(f => ({ ...f, shippingLine: e.target.value.toUpperCase() }))}
                                placeholder="Shipping Line"
                                style={{ flex:1, padding:"3px 6px", fontSize:12, borderRadius:5,
                                  border:"1px solid var(--border)", background:"var(--bg-input)", color:"var(--text-primary)",
                                  textTransform:"uppercase" }} />
                              <button onClick={lookupOceanPrice} disabled={oceanLooking}
                                style={{ padding:"3px 8px", fontSize:11, borderRadius:5, border:"none",
                                  background:"#7c3aed", color:"white", cursor:"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
                                {oceanLooking ? "…" : "🔍 Lookup"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontWeight:600 }}>Ocean Freight</div>
                            <div style={{ fontSize:10, color:"var(--text-muted)", marginTop:1, display:"flex", gap:8, flexWrap:"wrap" }}>
                              {order.pol && order.pod && <span>{order.pol} → {order.pod}</span>}
                              {order.shippingLine && <span>· {order.shippingLine}</span>}
                              <span style={{ color:"#a78bfa", fontWeight:700 }}>Cat. {currentCat}</span>
                            </div>
                          </>
                        )}
                      </td>
                      {editing ? (
                        <>
                          <td style={{ padding:"4px 6px" }}>
                            <input type="number" value={oceanEditForm.sell}
                              onChange={e => setOceanEditForm(f => ({ ...f, sell: e.target.value }))}
                              style={inpStyle("var(--accent)")} placeholder="0" />
                          </td>
                          <td style={{ padding:"4px 6px" }}>
                            <input type="number" value={oceanEditForm.cost}
                              onChange={e => setOceanEditForm(f => ({ ...f, cost: e.target.value }))}
                              style={inpStyle("#f87171")} placeholder="0" />
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ textAlign:"right", padding:"5px 8px", color:"var(--accent)", fontWeight:700 }}>
                            {ocnSell > 0 ? fmt(ocnSell) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                          </td>
                          <td style={{ textAlign:"right", padding:"5px 8px", color:"#f87171", fontWeight:700 }}>
                            {ocnCost > 0 ? fmt(ocnCost) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                          </td>
                        </>
                      )}
                      <td style={{ textAlign:"right", padding:"5px 8px", fontWeight:700, color:pClr(ocnSell-ocnCost) }}>
                        {pStr(ocnSell-ocnCost)}
                      </td>
                      <td style={{ textAlign:"center", padding:"4px 6px", whiteSpace:"nowrap" }}>
                        {editing ? (
                          <>
                            <button onClick={saveOceanEdit}
                              style={{ background:"none", border:"none", cursor:"pointer", color:"#34d399", fontSize:12, padding:"2px 4px" }}>
                              ✓
                            </button>
                            <button onClick={() => setEditingInternalRow(null)}
                              style={{ background:"none", border:"none", cursor:"pointer", color:"#f87171", fontSize:12, padding:"2px 4px" }}>
                              ✕
                            </button>
                          </>
                        ) : (
                          <button onClick={openOceanEdit}
                            style={{ background:"none", border:"none", cursor:"pointer", color:"#60a5fa", fontSize:12, padding:"2px 4px" }}>
                            ✏️
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })()}
                {/* Additional fee rows from charges (set via Additional Charges modal) */}
                {activeFeeRows.map(([key, label]) => {
                  const sell    = Number(charges[key] || 0);
                  const cost    = Number(charges[key + "Cost"] || 0);
                  const profit  = sell - cost;
                  const editing = editingFeeKey === key;
                  return (
                    <tr key={key} style={{ borderBottom:"1px solid var(--border)" }}>
                      <td style={{ padding:"5px 8px", color:"var(--text-secondary)", fontStyle:"italic" }}>
                        <div>{label}</div>
                        {charges[key + "Desc"] && (
                          <div style={{ fontSize:10, color:"var(--text-muted)", fontStyle:"normal", marginTop:1 }}>
                            {charges[key + "Desc"]}
                          </div>
                        )}
                      </td>
                      {editing ? (
                        <>
                          {/* Sell input */}
                          <td style={{ padding:"4px 6px" }}>
                            <input
                              key={`fee-sell-${key}`}
                              type="number"
                              autoFocus
                              defaultValue={sell || ""}
                              placeholder="Sell"
                              onBlur={async e => { await saveInternalField(key, e.target.value); }}
                              onKeyDown={e => { if (e.key === "Escape") setEditingFeeKey(null); }}
                              style={{ ...inpStyle("var(--accent)"), width:"100%" }}
                            />
                          </td>
                          {/* Cost input */}
                          <td style={{ padding:"4px 6px" }}>
                            <input
                              key={`fee-cost-${key}`}
                              type="number"
                              defaultValue={cost || ""}
                              placeholder="Cost"
                              onBlur={async e => { await saveInternalField(key + "Cost", e.target.value); }}
                              onKeyDown={e => { if (e.key === "Escape") setEditingFeeKey(null); }}
                              style={{ ...inpStyle("#f87171"), width:"100%" }}
                            />
                          </td>
                          <td style={{ padding:"5px 8px" }}></td>
                        </>
                      ) : (
                        <>
                          <td style={{ textAlign:"right", padding:"5px 8px", color:"var(--accent)", fontWeight:700 }}>
                            {fmt(sell)}
                          </td>
                          <td style={{ textAlign:"right", padding:"5px 8px", color:"#f87171", fontWeight:700 }}>
                            {cost > 0 ? fmt(cost) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                          </td>
                          <td style={{ textAlign:"right", padding:"5px 8px", fontWeight:700, color:pClr(profit) }}>
                            {cost > 0 ? pStr(profit) : <span style={{ color:"var(--text-muted)" }}>—</span>}
                          </td>
                        </>
                      )}
                      <td style={{ textAlign:"center", whiteSpace:"nowrap", padding:"4px 6px" }}>
                        <button
                          onClick={() => setEditingFeeKey(editing ? null : key)}
                          title={editing ? "Done" : "Edit"}
                          style={{ background:"none", border:"none", cursor:"pointer",
                            color: editing ? "#34d399" : "#60a5fa", fontSize:12, padding:"2px 4px" }}>
                          {editing ? "✓" : "✏️"}
                        </button>
                        {!editing && (
                          <button
                            onClick={async () => {
                              await saveInternalField(key, "0");
                              setEditingFeeKey(null);
                            }}
                            title="Remove fee"
                            style={{ background:"none", border:"none", cursor:"pointer", color:"#f87171", fontSize:12, padding:"2px 4px" }}>
                            🗑
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop:"2px solid var(--border)", background:"var(--bg-panel)" }}>
                  <td style={{ padding:"8px 8px", fontWeight:700, fontSize:12 }}>Total</td>
                  <td style={{ textAlign:"right", padding:"8px 8px", color:"var(--accent)", fontWeight:800 }}>{totSell>0?fmt(totSell):"—"}</td>
                  <td style={{ textAlign:"right", padding:"8px 8px", color:"#f87171",      fontWeight:800 }}>{totCost>0?fmt(totCost):"—"}</td>
                  <td style={{ textAlign:"right", padding:"8px 8px", fontWeight:800, fontSize:15, color:pClr(totProfit) }}>{pStr(totProfit)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            {/* Bottom bar: additional charges left, invoice right */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12, gap:8, flexWrap:"wrap" }}>
              <button onClick={() => setShowCosts(true)}
                style={{ padding:"8px 16px", borderRadius:8, border:"none",
                  background:"#b45309", color:"white", cursor:"pointer", fontSize:13, fontWeight:600 }}>
                💰 Additional Charges
              </button>
              <button onClick={openInvoiceModal}
                style={{ padding:"8px 18px", borderRadius:8, border:"none",
                  background:"#2563eb", color:"white", cursor:"pointer", fontSize:13, fontWeight:700,
                  whiteSpace:"nowrap" }}>
                🧾 Generate Invoice
              </button>
            </div>
          </section>
        );
      })()}

      {/* ── P&L Summary ─────────────────────────────── */}
      {(() => {
        const plTowSell = Number(charges.towingCharge || 0);
        const plOcnSell = Number(charges.oceanFreight || 0);
        const plFeeRows = feeRows.filter(([k]) => Number(charges[k] || 0) > 0);
        const plFeeRev  = plFeeRows.reduce((s,[k]) => s + Number(charges[k]||0), 0);
        const plRev     = plTowSell + plOcnSell + plFeeRev;
        const plTowCost = Number(charges.towingCost || 0);
        const plOcnCost = Number(charges.oceanCost  || 0);
        const plFeeCost = plFeeRows.reduce((s,[k]) => s + Number(charges[k+"Cost"]||0), 0);
        const plExp     = plTowCost + plOcnCost + plFeeCost;
        const plNet     = plRev - plExp;
        const plMargin  = plRev > 0 ? ((plNet / plRev) * 100).toFixed(1) : "0.0";

        const paidInvs  = orderInvoices.filter(i => i.status === "paid");
        const cashRev   = paidInvs.reduce((s,i) => s + Number(i.total||0), 0);
        const cashNet   = cashRev - plExp;
        const cashMargin = cashRev > 0 ? ((cashNet / cashRev) * 100).toFixed(1) : "0.0";

        const fm = v => (v < 0 ? "-" : "") + "$" + Math.abs(Number(v)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
        const nc = n => n >= 0 ? "#34d399" : "#f87171";
        const rowStyle = (indent) => ({ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid var(--border-muted)", marginLeft: indent ? 16 : 0 });
        const headStyle = (color) => ({ fontSize:11, fontWeight:700, color, textTransform:"uppercase", letterSpacing:".08em", padding:"14px 0 6px" });

        return (
          <section className="form-section" style={{ gridColumn:"1 / -1" }}>
            <h2 style={{ margin:"0 0 16px" }}>P&amp;L Summary</h2>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

              {/* Accrual */}
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:11, padding:"3px 12px", borderRadius:20, background:"rgba(99,102,241,0.15)", color:"#818cf8", border:"1px solid #818cf833" }}>Accrual Basis</span>
                  <span style={{ fontSize:11, color:"var(--text-muted)" }}>earned when charged</span>
                </div>
                <div style={{ background:"var(--bg-panel)", borderRadius:12, padding:"20px 24px", border:"1px solid var(--border)" }}>
                  <div style={headStyle("#34d399")}>Income</div>
                  {plTowSell > 0 && <div style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Towing / Transport</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(plTowSell)}</span></div>}
                  {plOcnSell > 0 && <div style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Ocean Freight</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(plOcnSell)}</span></div>}
                  {plFeeRows.map(([k,lbl]) => (
                    <div key={k} style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>{lbl}</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(Number(charges[k]||0))}</span></div>
                  ))}
                  {plRev === 0 && <div style={{fontSize:12,color:"var(--text-muted)",padding:"8px 0 8px 16px"}}>No revenue recorded</div>}
                  <div style={{borderTop:"1px solid var(--border)",marginTop:4}}/>
                  <div style={rowStyle(false)}><span style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>Total Income</span><span style={{fontSize:13,fontWeight:700,color:"#34d399",fontFamily:"monospace"}}>{fm(plRev)}</span></div>

                  <div style={headStyle("#f87171")}>Expenses</div>
                  {plTowCost > 0 && <div style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Towing / Transport</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(plTowCost)}</span></div>}
                  {plOcnCost > 0 && <div style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Ocean Freight</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(plOcnCost)}</span></div>}
                  {plFeeRows.map(([k,lbl]) => Number(charges[k+"Cost"]||0) > 0 && (
                    <div key={k+"c"} style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>{lbl}</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(Number(charges[k+"Cost"]||0))}</span></div>
                  ))}
                  {plExp === 0 && <div style={{fontSize:12,color:"var(--text-muted)",padding:"8px 0 8px 16px"}}>No cost data entered</div>}
                  <div style={{borderTop:"1px solid var(--border)",marginTop:4}}/>
                  <div style={rowStyle(false)}><span style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>Total Expenses</span><span style={{fontSize:13,fontWeight:700,color:"#f87171",fontFamily:"monospace"}}>{fm(plExp)}</span></div>

                  <div style={{borderTop:"2px solid var(--border)",marginTop:16,paddingTop:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:15,fontWeight:800}}>Net Profit / (Loss)</span>
                      <span style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:nc(plNet)}}>{fm(plNet)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
                      <span style={{fontSize:12,color:"var(--text-muted)"}}>Gross Margin</span>
                      <span style={{fontSize:13,fontWeight:600,color:nc(plNet)}}>{plMargin}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cash */}
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:11, padding:"3px 12px", borderRadius:20, background:"rgba(34,211,153,0.15)", color:"#34d399", border:"1px solid #34d39933" }}>Cash Basis</span>
                  <span style={{ fontSize:11, color:"var(--text-muted)" }}>{paidInvs.length} of {orderInvoices.length} invoice{orderInvoices.length !== 1 ? "s" : ""} paid</span>
                </div>
                <div style={{ background:"var(--bg-panel)", borderRadius:12, padding:"20px 24px", border:"1px solid var(--border)" }}>
                  <div style={headStyle("#34d399")}>Income</div>
                  {paidInvs.length > 0
                    ? paidInvs.map(inv => (
                        <div key={inv._id} style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Invoice {inv.invoiceNumber}</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(Number(inv.total||0))}</span></div>
                      ))
                    : <div style={{fontSize:12,color:"var(--text-muted)",padding:"8px 0 8px 16px"}}>No paid invoices yet</div>
                  }
                  <div style={{borderTop:"1px solid var(--border)",marginTop:4}}/>
                  <div style={rowStyle(false)}><span style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>Total Collected</span><span style={{fontSize:13,fontWeight:700,color:"#34d399",fontFamily:"monospace"}}>{fm(cashRev)}</span></div>

                  <div style={headStyle("#f87171")}>Expenses</div>
                  {plTowCost > 0 && <div style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Towing / Transport</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(plTowCost)}</span></div>}
                  {plOcnCost > 0 && <div style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>Ocean Freight</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(plOcnCost)}</span></div>}
                  {plFeeRows.map(([k,lbl]) => Number(charges[k+"Cost"]||0) > 0 && (
                    <div key={k+"cc"} style={rowStyle(true)}><span style={{fontSize:13,color:"var(--text-secondary)"}}>{lbl}</span><span style={{fontSize:13,fontFamily:"monospace"}}>{fm(Number(charges[k+"Cost"]||0))}</span></div>
                  ))}
                  {plExp === 0 && <div style={{fontSize:12,color:"var(--text-muted)",padding:"8px 0 8px 16px"}}>No cost data entered</div>}
                  <div style={{borderTop:"1px solid var(--border)",marginTop:4}}/>
                  <div style={rowStyle(false)}><span style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>Total Expenses</span><span style={{fontSize:13,fontWeight:700,color:"#f87171",fontFamily:"monospace"}}>{fm(plExp)}</span></div>

                  <div style={{borderTop:"2px solid var(--border)",marginTop:16,paddingTop:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:15,fontWeight:800}}>Net Profit / (Loss)</span>
                      <span style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:nc(cashNet)}}>{fm(cashNet)}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
                      <span style={{fontSize:12,color:"var(--text-muted)"}}>Gross Margin</span>
                      <span style={{fontSize:13,fontWeight:600,color:nc(cashNet)}}>{cashMargin}%</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </section>
        );
      })()}

      {/* ── Bills ───────────────────────────────────── */}
      <section className="form-section">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div>
            <h2 style={{ margin:0, borderBottom:"none", paddingBottom:0 }}>Bills</h2>
            {bills.length > 0 && (
              <div style={{ display:"flex", gap:14, marginTop:6 }}>
                <span style={{ fontSize:12, color:"var(--text-muted)" }}>
                  Total:{" "}
                  <strong style={{ color:"var(--text-primary)" }}>
                    ${bills.reduce((s,b)=>s+(b.amount||0),0)
                      .toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                  </strong>
                </span>
                {bills.some(b=>b.status==="unpaid") && (
                  <span style={{ fontSize:12, color:"#f87171" }}>
                    Unpaid:{" "}
                    <strong>
                      ${bills.filter(b=>b.status==="unpaid")
                        .reduce((s,b)=>s+(b.amount||0),0)
                        .toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                    </strong>
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => openAddBill("paste")}
              style={{ padding:"6px 12px", borderRadius:8, border:"1px solid var(--border)",
                background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer", fontSize:12 }}>
              📄 From Invoice
            </button>
            <button onClick={() => openAddBill("manual")}
              style={{ padding:"6px 12px", borderRadius:8, border:"none",
                background:"#059669", color:"white", cursor:"pointer", fontSize:12 }}>
              ➕ Add Bill
            </button>
          </div>
        </div>

        {billsLoading ? (
          <p style={{ fontSize:13, color:"var(--text-muted)" }}>Loading bills…</p>
        ) : bills.length === 0 ? (
          <p style={{ margin:0, fontSize:13, color:"var(--text-muted)" }}>No bills on file for this order.</p>
        ) : (
          <table className="orders-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Description</th>
                <th>Invoice #</th>
                <th>Category</th>
                <th style={{ textAlign:"right" }}>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th>Files</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bills.map(bill => (
                <React.Fragment key={bill._id}>
                <tr>
                  <td style={{ fontWeight:600 }}>{bill.vendor || "—"}</td>
                  <td style={{ fontSize:12, color:"var(--text-secondary)", maxWidth:170,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {bill.description}
                  </td>
                  <td style={{ fontSize:12, color:"#a78bfa", fontFamily:"monospace" }}>
                    {bill.invoiceNumber || "—"}
                  </td>
                  <td>
                    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:12, fontWeight:600,
                      background:`${BILL_CAT_COLORS[bill.category]||"#9ca3af"}22`,
                      color:BILL_CAT_COLORS[bill.category]||"#9ca3af",
                      border:`1px solid ${BILL_CAT_COLORS[bill.category]||"#9ca3af"}44` }}>
                      {bill.category}
                    </span>
                  </td>
                  <td style={{ textAlign:"right", fontWeight:700 }}>
                    ${(bill.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                  </td>
                  <td>
                    {bill.status === "paid"
                      ? <span style={{ fontSize:11, color:"#34d399", fontWeight:600 }}>✓ Paid</span>
                      : <button onClick={() => markBillPaid(bill._id)}
                          style={{ fontSize:11, padding:"3px 10px", borderRadius:8, border:"none",
                            background:"rgba(5,150,105,0.15)", color:"#34d399",
                            cursor:"pointer", fontWeight:600 }}>
                          Mark Paid
                        </button>
                    }
                  </td>
                  <td style={{ fontSize:12, color:"var(--text-muted)" }}>
                    {bill.date ? new Date(bill.date).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ whiteSpace:"nowrap" }}>
                    {bill.billFileName
                      ? <a href={`${API}/api/expenses/${bill._id}/bill`} target="_blank" rel="noreferrer"
                          title="Bill document" style={{ fontSize:16, textDecoration:"none", marginRight:6 }}>📄</a>
                      : null}
                    {bill.receiptFileName
                      ? <a href={`${API}/api/expenses/${bill._id}/receipt`} target="_blank" rel="noreferrer"
                          title="Receipt" style={{ fontSize:16, textDecoration:"none" }}>📎</a>
                      : null}
                    {!bill.billFileName && !bill.receiptFileName
                      ? <span style={{ color:"var(--text-muted)", fontSize:12 }}>—</span>
                      : null}
                  </td>
                  <td>
                    <div style={{ display:"flex", gap:6 }}>
                      <button onClick={() => openEditBill(bill)}
                        style={{ background:"none", border:"1px solid var(--border)", color:"var(--text-secondary)",
                          cursor:"pointer", fontSize:11, padding:"2px 8px", borderRadius:6 }}>
                        Edit
                      </button>
                      <button onClick={() => deleteBill(bill._id)}
                        style={{ background:"none", border:"none", color:"var(--text-muted)",
                          cursor:"pointer", fontSize:16, padding:"2px 6px" }}>
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Sub-lines for extra charges — no separator, indented */}
                {(bill.lineItems || []).map((li, idx) => (
                  <tr key={`${bill._id}-li-${idx}`} style={{ background:"var(--bg-panel)" }}>
                    <td></td>
                    <td style={{ fontSize:12, color:"var(--text-muted)", paddingLeft:24, borderTop:"none" }}>
                      ↳ {li.description}
                    </td>
                    <td colSpan={2}></td>
                    <td style={{ textAlign:"right", fontSize:12, color:"var(--text-muted)", borderTop:"none" }}>
                      ${Number(li.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Notes ───────────────────────────────────── */}
      <section className="form-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, borderBottom: "none", paddingBottom: 0 }}>Notes</h2>
          <button onClick={() => { setNoteText(order.notes || ""); setShowNoteEdit(true); }}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-panel)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12 }}>
            {order.notes ? "✏️ Edit Note" : "📝 Add Note"}
          </button>
        </div>
        {order.notes
          ? <p style={{ margin: 0, fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6,
              padding: "10px 14px", background: "var(--bg-panel)", borderRadius: 8,
              border: "1px solid var(--border-muted)" }}>{order.notes}</p>
          : <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>No notes yet.</p>
        }
        {/* Order type + processed by — small, below notes */}
        <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {order.requestType && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Type: <strong style={{ color: "var(--text-secondary)" }}>{order.requestType}</strong>
            </span>
          )}
          {order.processedBy && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Processed by: <strong style={{ color: "var(--text-secondary)" }}>{order.processedBy}</strong>
            </span>
          )}
        </div>
      </section>

      <section className="form-section">
        <h2>Activity Timeline</h2>

        {sortedTimeline.length > 0 ? (
          <>
            <div className="timeline-list">
              {timelineToShow.map((item, index) => (
                <div
                  className={`timeline-item ${
                    item.action === "Order Created"
                      ? "timeline-created"
                      : item.action === "Status Changed"
                      ? "timeline-status"
                      : item.action === "File Uploaded"
                      ? "timeline-upload"
                      : item.action === "Moved to Voyage"
                      ? "timeline-voyage"
                      : ""
                  }`}
                  key={index}
                >
                  <p>{item.details}</p>

                  <small>
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleString()
                      : ""}
                  </small>
                </div>
              ))}
            </div>

            {sortedTimeline.length > 3 && (
              <button
                onClick={() => setShowFullTimeline(!showFullTimeline)}
                style={{
                  marginTop: "12px",
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#111827",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                {showFullTimeline ? "Show Less" : "Show Full Timeline"}
              </button>
            )}
          </>
        ) : (
          <p>No activity yet.</p>
        )}
      </section>

      {showEdit && (
        <div className="modal-backdrop" onClick={() => setShowEdit(false)}>
          <div
            className="modal-card"
            onClick={e => e.stopPropagation()}
            style={{ width: "680px", maxWidth: "95vw" }}
          >
            <h2 style={{ marginTop: 0 }}>Edit Order #{order.refNumber}</h2>

            {/* Customer */}
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 8 }}>
              Customer
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              {[["customerName","Customer (Billing)"],["buyerName","Buyer Account (Receipt)"],["contactName","Contact Name"],["customerPhone","Phone / WhatsApp"],["customerEmail","Email"]].map(([k,lbl])=>(
                <label key={k} style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {lbl}
                  <input value={editForm[k]||""} onChange={e=>setEditForm(f=>({...f,[k]:e.target.value}))}
                    style={{ display:"block", width:"100%", marginTop:4 }} />
                </label>
              ))}
            </div>

            {/* Vehicle */}
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 8 }}>
              Vehicle
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {[["year","Year"],["make","Make"],["model","Model"],["color","Color"],["vin","VIN"]].map(([k,lbl])=>(
                <label key={k} style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {lbl}
                  <input value={editForm[k]||""} onChange={e=>setEditForm(f=>({...f,[k]:e.target.value}))}
                    style={{ display:"block", width:"100%", marginTop:4,
                      fontFamily: k==="vin" ? "monospace" : "inherit" }} />
                </label>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              {[["lotNumber","Lot#"],["pin","PIN"]].map(([k,lbl])=>(
                <label key={k} style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {lbl}
                  <input value={editForm[k]||""} onChange={e=>setEditForm(f=>({...f,[k]:e.target.value}))}
                    placeholder={k==="pin" ? "Gate release PIN" : "e.g. 12345678"}
                    style={{ display:"block", width:"100%", marginTop:4 }} />
                </label>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Condition
                <select value={editForm.condition||"Runner"}
                  onChange={e=>setEditForm(f=>({...f,condition:e.target.value}))}
                  style={{ display:"block", width:"100%", marginTop:4 }}>
                  <option>Runner</option>
                  <option>Nonrunner</option>
                  <option>Forklift</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Title Status
                <select value={editForm.titleStatus||"Pending"}
                  onChange={e=>setEditForm(f=>({...f,titleStatus:e.target.value}))}
                  style={{ display:"block", width:"100%", marginTop:4 }}>
                  <option>Pending</option>
                  <option>Title</option>
                  <option>No Title</option>
                </select>
              </label>
            </div>

            {/* Locations */}
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 8 }}>
              Locations
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                { label:"Pickup Location", field:"pickupLocation", addrFields:{ name:"pickupName", address:"pickupAddress", city:"pickupCity", state:"pickupState", zip:"pickupZip" } },
                { label:"Delivery / Port Location", field:"deliveryLocation", addrFields:{ name:"deliveryName", address:"deliveryAddress", city:"deliveryCity", state:"deliveryState", zip:"deliveryZip" } },
              ].map(({ label: lbl, field, addrFields }) => (
                <LocationSearch key={field}
                  label={lbl}
                  value={editForm[field]||""}
                  onChange={v => setEditForm(f=>({...f,[field]:v}))}
                  onSelect={item => setEditForm(f=>({
                    ...f,
                    [field]: item.companyName||"",
                    [addrFields.name]:    item.companyName||"",
                    [addrFields.address]: item.address||"",
                    [addrFields.city]:    item.city||"",
                    [addrFields.state]:   item.state||"",
                    [addrFields.zip]:     item.postalCode||"",
                  }))}
                />
              ))}
            </div>

            {/* Shipping */}
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 8 }}>
              Shipping
            </p>

            {/* Request Type toggle */}
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {["RORO","Container"].map(t => (
                <button key={t} type="button"
                  onClick={() => setEditForm(f => ({ ...f, requestType: t, containerSize:"", shippingLine:"", pol:"" }))}
                  style={{
                    padding:"6px 18px", borderRadius:20, cursor:"pointer", fontSize:12, fontWeight:600,
                    border: editForm.requestType === t ? "none" : "1px solid var(--border)",
                    background: editForm.requestType === t ? (t === "Container" ? "#2563eb" : "#059669") : "var(--bg-panel)",
                    color: editForm.requestType === t ? "#fff" : "var(--text-secondary)",
                  }}>{t}</button>
              ))}
            </div>

            {/* Container warehouse quick-picker */}
            {editForm.requestType === "Container" && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, color:"var(--text-muted)", marginBottom:6 }}>Delivery Warehouse</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {[
                    { name:"EZ CARGO",             pol:"NEW YORK"  },
                    { name:"SAVANNAH AUTO EXPORT",  pol:"SAVANNAH"  },
                    { name:"ISHIP",                 pol:"HOUSTON"   },
                    { name:"CEDARS EXPRESS",         pol:"LONG BEACH"},
                  ].map(wh => {
                    const sel = editForm.deliveryLocation === wh.name;
                    return (
                      <button key={wh.name} type="button"
                        onClick={() => setEditForm(f => ({ ...f, deliveryLocation: wh.name, pol: wh.pol }))}
                        style={{
                          padding:"5px 12px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:600,
                          border:`1px solid ${sel ? "rgba(96,165,250,0.6)" : "var(--border)"}`,
                          background: sel ? "rgba(37,99,235,0.15)" : "var(--bg-panel)",
                          color: sel ? "#60a5fa" : "var(--text-secondary)",
                        }}>
                        {wh.name} <span style={{ opacity:0.6, fontWeight:400 }}>({wh.pol})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Shipping Line
                <select value={editForm.shippingLine||""}
                  onChange={e=>setEditForm(f=>({...f,shippingLine:e.target.value}))}
                  style={{ display:"block", width:"100%", marginTop:4 }}>
                  <option value="">Choose...</option>
                  {editForm.requestType === "Container" ? (
                    <>
                      <option>OOCL</option>
                      <option>MAERSK</option>
                      <option>HAPAG LLOYD</option>
                      <option>ARKAS</option>
                      <option>MSC</option>
                      <option>CMA CGM</option>
                    </>
                  ) : (
                    <>
                      <option>ACL</option>
                      <option>SALLAUM</option>
                    </>
                  )}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Port of Loading
                <select value={editForm.pol||""} onChange={e=>setEditForm(f=>({...f,pol:e.target.value}))}
                  style={{ display:"block", width:"100%", marginTop:4 }}>
                  <option value="">Choose...</option>
                  {editForm.requestType === "Container" ? (
                    <>
                      <option>NEW YORK</option>
                      <option>SAVANNAH</option>
                      <option>LONG BEACH</option>
                      <option>HOUSTON</option>
                    </>
                  ) : (
                    <>
                      <option>BALTIMORE</option>
                      <option>JACKSONVILLE</option>
                      <option>PROVIDENCE</option>
                      <option>FREEPORT</option>
                      <option>WILMINGTON</option>
                      <option>BRUNSWICK</option>
                      <option>NEWARK</option>
                    </>
                  )}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Port of Discharge
                <select value={editForm.pod||""} onChange={e => {
                  const pod = e.target.value;
                  const lineMap = { LAGOS: "SALLAUM", COTONOU: "SALLAUM", LOME: "SALLAUM", TEMA: "ACL" };
                  const line = editForm.requestType !== "Container" ? (lineMap[pod] || "") : "";
                  setEditForm(f => ({ ...f, pod, ...(line ? { shippingLine: line } : {}) }));
                }}
                  style={{ display:"block", width:"100%", marginTop:4 }}>
                  <option value="">Choose...</option>
                  <option>LAGOS</option>
                  <option>TEMA</option>
                  <option>COTONOU</option>
                  <option>LOME</option>
                  <option>DAKAR</option>
                  <option>DURBAN</option>
                  <option>ABIDJAN</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Booking #
                <input value={editForm.bookingNumber||""} onChange={e=>setEditForm(f=>({...f,bookingNumber:e.target.value}))}
                  style={{ display:"block", width:"100%", marginTop:4 }} />
              </label>

              {/* Container-only fields */}
              {editForm.requestType === "Container" && (
                <label style={{ fontSize: 12, color: "var(--text-secondary)", gridColumn:"1 / -1" }}>
                  Container Size
                  <div style={{ display:"flex", gap:8, marginTop:6, flexWrap:"wrap" }}>
                    {["FULL 40' HC","CONSOLIDATED SPOT","20'"].map(sz => {
                      const sel = editForm.containerSize === sz;
                      // Find matching rate for live price preview
                      const pol  = (editForm.pol||"").toUpperCase();
                      const line = (editForm.shippingLine||"").toUpperCase();
                      const rate = oceanRates.find(r =>
                        r.requestType === "CONTAINER" && r.pol === pol && r.containerSize === sz && r.shippingLine === line
                      ) || oceanRates.find(r =>
                        r.requestType === "CONTAINER" && r.pol === pol && r.containerSize === sz
                      );
                      return (
                        <button key={sz} type="button"
                          onClick={() => setEditForm(f => ({ ...f, containerSize: sz }))}
                          style={{
                            padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600,
                            border:`1px solid ${sel ? "rgba(52,211,153,0.6)" : "var(--border)"}`,
                            background: sel ? "rgba(5,150,105,0.15)" : "var(--bg-panel)",
                            color: sel ? "#34d399" : "var(--text-secondary)",
                          }}>
                          {sz}
                          {rate?.portPrice ? <span style={{ marginLeft:6, fontSize:11, opacity:0.8 }}>${Number(rate.portPrice).toLocaleString()}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </label>
              )}

              {editForm.requestType === "Container" && (
                <>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Container #
                    <input value={editForm.containerNumber||""} onChange={e=>setEditForm(f=>({...f,containerNumber:e.target.value.toUpperCase()}))}
                      placeholder="e.g. MSCU1234567"
                      style={{ display:"block", width:"100%", marginTop:4 }} />
                  </label>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Seal #
                    <input value={editForm.sealNumber||""} onChange={e=>setEditForm(f=>({...f,sealNumber:e.target.value.toUpperCase()}))}
                      placeholder="e.g. SL123456"
                      style={{ display:"block", width:"100%", marginTop:4 }} />
                  </label>
                </>
              )}
            </div>

            {/* Notes */}
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Notes
              <textarea value={editForm.notes||""}
                onChange={e=>setEditForm(f=>({...f,notes:e.target.value}))}
                rows={3}
                style={{ display:"block", width:"100%", marginTop:4, resize:"vertical" }} />
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="button" onClick={saveEdit}>Save Changes</button>
              <button type="button" onClick={() => setShowEdit(false)}
                style={{ background: "var(--bg-panel)", border: "1px solid var(--border)",
                  color: "var(--text-secondary)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DR Preview Modal ─────────────────────────── */}
      {showDrPreview && (
        <div className="modal-backdrop" onClick={() => setShowDrPreview(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}
            style={{ width: "700px", maxWidth: "95vw" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <h2 style={{ margin:0 }}>Dock Receipt — Review &amp; Confirm</h2>
              <button type="button" onClick={() => openDrPreview(true)}
                title="Discard edits and reload from order data"
                style={{ padding:"5px 12px", borderRadius:7, border:"1px solid var(--border)",
                  background:"var(--bg-panel)", color:"var(--text-muted)", cursor:"pointer", fontSize:12 }}>
                🔄 Refresh from Order
              </button>
            </div>

            {drLoading ? (
              <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0" }}>
                Loading DR data...
              </p>
            ) : (() => {
              const d = drPayload || order;
              return (
                <>
                  {/* Route */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18,
                    padding: "14px 18px", background: "var(--bg-panel)", borderRadius: 10,
                    border: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em" }}>Port of Loading</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>
                        {d.pol || d.portOfLoading || "—"}
                      </div>
                    </div>
                    <span style={{ fontSize: 22, color: "var(--text-muted)" }}>→</span>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em" }}>Port of Discharge</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)" }}>
                        {d.pod || d.portOfDischarge || "—"}
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em" }}>Booking #</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                        {d.bookingNumber || "—"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    {/* Vehicle */}
                    <div style={{ padding: "12px 14px", background: "var(--bg-panel)", borderRadius: 9,
                      border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em", marginBottom: 6 }}>Vehicle</div>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                        {d.vehicleYearMakeModel ||
                          [d.year, d.make, d.model].filter(Boolean).join(" ") || "—"}
                      </div>
                      <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>
                        {d.vin || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                        {d.condition} · Title: {d.titleStatus}
                      </div>
                    </div>

                    {/* Consignee */}
                    <div style={{ padding: "12px 14px", background: "var(--bg-panel)", borderRadius: 9,
                      border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em", marginBottom: 6 }}>Consignee</div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.consigneeName || "—"}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                        {[d.consigneeAddress, d.consigneeCity, d.consigneeCountry].filter(Boolean).join(", ")}
                      </div>
                    </div>

                    {/* Exporter */}
                    <div style={{ padding: "12px 14px", background: "var(--bg-panel)", borderRadius: 9,
                      border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em", marginBottom: 6 }}>Exporter / USPPI</div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.exporterName || "—"}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
                        {[d.exporterAddress, d.exporterCity, d.exporterState, d.exporterCountry].filter(Boolean).join(", ")}
                      </div>
                    </div>

                    {/* Schedule */}
                    <div style={{ padding: "12px 14px", background: "var(--bg-panel)", borderRadius: 9,
                      border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em", marginBottom: 6 }}>Schedule</div>
                      <div style={{ fontSize: 13 }}>
                        <strong>Vessel:</strong> {d.vessel || "—"} {d.voyage ? `V: ${d.voyage}` : ""}<br />
                        <strong>Cutoff:</strong> {d.cutoffDate || "—"}&nbsp;&nbsp;
                        <strong>Sail:</strong> {d.sailDate || "—"}<br />
                        <strong>AES ITN:</strong> {d.aesItn || "—"}
                      </div>
                    </div>

                    {/* Pickup */}
                    <div style={{ padding: "12px 14px", background: "var(--bg-panel)", borderRadius: 9,
                      border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em", marginBottom: 6 }}>Pickup</div>
                      <div style={{ fontSize: 13 }}>
                        {d.pickupName || d.pickupLocation || "—"}<br />
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          {[d.pickupAddress, d.pickupCity, d.pickupState].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    </div>

                    {/* Delivery */}
                    <div style={{ padding: "12px 14px", background: "var(--bg-panel)", borderRadius: 9,
                      border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                        letterSpacing: "0.06em", marginBottom: 6 }}>Delivery</div>
                      <div style={{ fontSize: 13 }}>
                        {d.deliveryName || d.deliveryLocation || "—"}<br />
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          {[d.deliveryAddress, d.deliveryCity, d.deliveryState].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Drive docs */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)",
                      textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Documents on File
                    </div>
                    {driveFiles.filter(f => /aes|dispatch/i.test(f.name)).length > 0
                      ? driveFiles.filter(f => /aes|dispatch/i.test(f.name)).map(f => (
                          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8,
                            padding: "7px 12px", background: "var(--success-dim)", borderRadius: 7, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "var(--success)" }}>✓</span>
                            <a href={f.webViewLink} target="_blank" rel="noreferrer"
                              style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none" }}>
                              {f.name}
                            </a>
                          </div>
                        ))
                      : <p style={{ fontSize: 12, color: "var(--warning)", margin: 0 }}>
                          ⚠ No AES / Dispatch found. Upload them first for full data.
                        </p>
                    }
                  </div>

                  {/* ── Weight — prominent required field ──────────────── */}
                  <div style={{
                    border: drWeightOverride
                      ? "1px solid rgba(16,185,129,0.4)"
                      : "1px solid rgba(245,158,11,0.5)",
                    background: drWeightOverride
                      ? "rgba(16,185,129,0.06)"
                      : "rgba(245,158,11,0.08)",
                    borderRadius: 10,
                    padding: "14px 16px",
                    marginBottom: 14,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8,
                      color: drWeightOverride ? "#6ee7b7" : "#fcd34d" }}>
                      {drWeightOverride ? "✅ Gross Weight" : "⚠️ Gross Weight — Required for DR"}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        type="number"
                        value={drWeightOverride}
                        onChange={e => setDrWeightOverride(e.target.value)}
                        placeholder="Enter KGS (e.g. 1450)"
                        style={{
                          flex: 1, padding: "8px 12px", borderRadius: 7, fontSize: 15,
                          border: drWeightOverride
                            ? "1px solid rgba(16,185,129,0.5)"
                            : "1px solid rgba(245,158,11,0.5)",
                          background: "var(--bg-elevated)",
                          color: "var(--text-primary)",
                          fontWeight: 700,
                        }}
                      />
                      <span style={{ fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>KGS</span>
                      {drWeightOverride && (
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          = {Math.round(Number(drWeightOverride) * 2.20462).toLocaleString()} LBS
                        </span>
                      )}
                    </div>
                    {!drWeightOverride && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                        Weight was not found in the AES. Type it above — it will appear on the DR.
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button"
                      onClick={() => {
                        setShowDrPreview(false);
                        generateDockReceipt({ ...d, weightKgs: drWeightOverride || d.weightKgs || "" });
                      }}
                      style={{ padding: "10px 18px", borderRadius: 9, border: "none",
                        background: "#059669", color: "white", cursor: "pointer", fontWeight: 600 }}>
                      ✓ Confirm &amp; Generate DR
                    </button>
                    <button type="button"
                      onClick={() => {
                        const base = drPayload || order;
                        // Store date fields as YYYY-MM-DD so the native picker doesn't flicker
                        const toISO = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? "" : d.toISOString().slice(0,10); };
                        setDrEditForm({
                          ...base,
                          sailDate:    toISO(base.sailDate),
                          arrivalDate: toISO(base.arrivalDate),
                          cutoffDate:  toISO(base.cutoffDate),
                          weightKgs:   drWeightOverride || base.weightKgs || "",
                        });
                        setShowDrEdit(true);
                      }}
                      style={{ padding: "10px 16px", borderRadius: 9, border: "1px solid var(--border)",
                        background: "var(--bg-panel)", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
                      ✏️ Edit Fields
                    </button>
                    <button type="button" onClick={() => setShowDrPreview(false)}
                      style={{ padding: "10px 14px", borderRadius: 9, border: "1px solid var(--border)",
                        background: "var(--bg-panel)", color: "var(--text-secondary)", cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── DR Edit Fields Modal ─────────────────────── */}
      {showDrEdit && (
        <DrEditModal
          form={drEditForm}
          onFormChange={setDrEditForm}
          onApply={(finalPayload) => {
            setDrPayload(finalPayload);
            setDrWeightOverride(finalPayload.weightKgs || "");
            setShowDrEdit(false);
          }}
          onClose={() => setShowDrEdit(false)}
        />
      )}

      {/* ── Note Edit Modal ───────────────────────────── */}
      {showNoteEdit && (
        <div className="modal-backdrop" onClick={() => setShowNoteEdit(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}
            style={{ width: "520px", maxWidth: "95vw" }}>
            <h2 style={{ marginTop: 0 }}>Order Note</h2>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={6}
              placeholder="Enter internal notes, special instructions, customer requests..."
              style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button type="button" onClick={saveNote}>Save Note</button>
              <button type="button" onClick={() => setShowNoteEdit(false)}
                style={{ background: "var(--bg-panel)", border: "1px solid var(--border)",
                  color: "var(--text-secondary)" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Towing Cost Verification Modal ──────────── */}
      {towingVerify && (
        <div className="modal-backdrop" onClick={() => setTowingVerify(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <span style={{ fontSize:22 }}>🚛</span>
              <h2 style={{ margin:0 }}>Towing Cost Mismatch</h2>
            </div>

            <p style={{ fontSize:13, color:"var(--text-secondary)", margin:"0 0 16px" }}>
              The dispatch sheet was scanned and found a towing cost that differs from what's stored on this order.
            </p>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
              <div style={{ padding:"12px 16px", borderRadius:10, background:"var(--bg-panel)",
                border:"2px solid rgba(251,191,36,0.4)", textAlign:"center" }}>
                <div style={{ fontSize:11, color:"var(--text-muted)", textTransform:"uppercase",
                  letterSpacing:1, marginBottom:6 }}>Dispatch Sheet</div>
                <div style={{ fontSize:26, fontWeight:900, color:"#fbbf24" }}>
                  ${towingVerify.dispatchCost.toLocaleString()}
                </div>
              </div>
              <div style={{ padding:"12px 16px", borderRadius:10, background:"var(--bg-panel)",
                border:"1px solid var(--border)", textAlign:"center" }}>
                <div style={{ fontSize:11, color:"var(--text-muted)", textTransform:"uppercase",
                  letterSpacing:1, marginBottom:6 }}>Currently Stored</div>
                <div style={{ fontSize:26, fontWeight:900,
                  color: towingVerify.currentCost === 0 ? "var(--text-muted)" : "var(--text-primary)" }}>
                  {towingVerify.currentCost === 0 ? "—" : `$${towingVerify.currentCost.toLocaleString()}`}
                </div>
              </div>
            </div>

            {/* Checkbox: also update pricing table */}
            <TowingVerifyForm
              verify={towingVerify}
              orderId={id}
              onDone={(updated) => {
                setTowingVerify(null);
                if (updated) fetchOrder();
              }}
            />
          </div>
        </div>
      )}

      {showCosts && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCosts(false)}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "520px" }}
          >
            <h2 style={{ marginTop: 0 }}>Additional Costs</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

              {/* Customer-facing sell prices */}
              <div style={{ fontSize:11, fontWeight:700, color:"var(--accent)", textTransform:"uppercase",
                letterSpacing:1, padding:"4px 0 2px" }}>Sell Prices (Customer-Facing)</div>
              <CostRow
                label="Towing Charge"
                value={charges.towingCharge}
                onChange={(v) => updateCharge("towingCharge", v)}
              />
              <CostRow
                label="Ocean Freight"
                value={charges.oceanFreight}
                onChange={(v) => updateCharge("oceanFreight", v)}
              />

              {/* Internal costs */}
              <div style={{ fontSize:11, fontWeight:700, color:"#f87171", textTransform:"uppercase",
                letterSpacing:1, padding:"8px 0 2px", borderTop:"1px solid var(--border)", marginTop:4 }}>
                Internal Costs (Not Printed)
              </div>
              <CostRow
                label="Towing Cost"
                value={charges.towingCost}
                onChange={(v) => updateCharge("towingCost", v)}
              />
              <CostRow
                label="Ocean Cost"
                value={charges.oceanCost}
                onChange={(v) => updateCharge("oceanCost", v)}
              />

              <div style={{ borderTop:"1px solid var(--border)", marginTop:4, paddingTop:8 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 120px", gap:8, fontSize:11,
                  fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>
                  <span style={{ color:"var(--text-muted)" }}>Additional Fees</span>
                  <span style={{ color:"var(--accent)", textAlign:"right" }}>Sell</span>
                  <span style={{ color:"#f87171", textAlign:"right" }}>Cost</span>
                </div>
              </div>
              {feeRows.map(([key, label, opts = {}]) => {
                // Show empty string when value is zero so placeholder is visible
                const sellVal = Number(charges[key] || 0);
                const displaySell = sellVal === 0 ? "" : (charges[key] || "");
                return (
                <div key={key}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 120px", gap:8, alignItems:"center", fontSize:13 }}>
                    <label style={{ fontSize:13 }}>{label}</label>
                    <input
                      type="number"
                      placeholder={opts.defaultSell ? `$${opts.defaultSell}` : "Sell"}
                      value={displaySell}
                      onFocus={() => {
                        if (opts.defaultSell && sellVal === 0) {
                          updateCharge(key, String(opts.defaultSell));
                        }
                      }}
                      onChange={e => updateCharge(key, e.target.value)}
                      style={{ padding:"7px 8px", fontSize:13, textAlign:"right",
                        border:"1px solid var(--border)", borderRadius:5,
                        background:"var(--bg-input)", color:"var(--accent)" }}
                    />
                    <input
                      type="number"
                      placeholder="Cost"
                      value={Number(charges[key + "Cost"] || 0) === 0 ? "" : (charges[key + "Cost"] || "")}
                      onChange={e => updateCharge(key + "Cost", e.target.value)}
                      style={{ padding:"7px 8px", fontSize:13, textAlign:"right",
                        border:"1px solid var(--border)", borderRadius:5,
                        background:"var(--bg-input)", color:"#f87171" }}
                    />
                  </div>
                  {/* Description box — always visible for Mechanical Charges */}
                  {opts.hasDesc && (
                    <input
                      type="text"
                      placeholder="Describe work done e.g. tire change, battery, oil…"
                      value={charges[key + "Desc"] || ""}
                      onChange={e => updateCharge(key + "Desc", e.target.value)}
                      style={{
                        width: "calc(100% - 250px)", padding: "3px 8px", fontSize: 11,
                        marginTop: 3, borderRadius: 5,
                        border: "1px solid var(--border)",
                        background: "var(--bg-input)", color: "var(--text-secondary)",
                        fontStyle: "italic",
                      }}
                    />
                  )}
                </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button type="button" onClick={saveCharges}>
                Save Costs
              </button>

              <button type="button" onClick={() => setShowCosts(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvoice && (
        <div className="modal-backdrop" onClick={() => setShowInvoice(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: "760px" }}>
            <h2 style={{ marginTop: 0 }}>Generate Invoice</h2>

            <p style={{ color: "#6b7280", fontSize: "13px", marginTop: 0 }}>
              Order #{order.refNumber} &mdash; {order.year} {order.make} {order.model}
              {order.vin && <span style={{ fontFamily: "monospace", marginLeft: 6, color: "#9ca3af" }}>
                {order.vin}
              </span>}
            </p>

            {/* Line items */}
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
              Line Items
            </div>
            <div style={{ display: "grid", gap: "8px", marginBottom: 10 }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 34px", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 2 }}>Description</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>Amount</span>
                <span />
              </div>
              {invoiceItems.map((item, index) => (
                <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 140px 34px", gap: "8px", alignItems: "center" }}>
                  <input
                    value={item.description}
                    onChange={(e) => updateInvoiceItem(index, "description", e.target.value)}
                    placeholder="Description"
                  />
                  <input
                    value={item.amount}
                    onChange={(e) => updateInvoiceItem(index, "amount", e.target.value)}
                    placeholder="0.00"
                    style={{ textAlign: "right", fontFamily: "monospace" }}
                  />
                  <button type="button" onClick={() => removeInvoiceItem(index)}
                    style={{ background: "none", border: "none", color: "#f87171",
                      cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}>
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button type="button" onClick={addInvoiceItem}
              style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6,
                border: "1px dashed var(--border)", background: "transparent",
                color: "var(--text-muted)", cursor: "pointer", marginBottom: 16 }}>
              + Add Line Item
            </button>

            {/* Total */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}>
              <div style={{ padding: "12px 20px", borderRadius: 10, background: "var(--bg-panel)",
                border: "1px solid var(--border)", minWidth: 180, textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase",
                  letterSpacing: 1, marginBottom: 4 }}>Total Due</div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: "var(--accent)" }}>
                  ${invoiceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Due date + notes */}
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, marginBottom: 18 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Due Date (optional)
                <input type="date" value={invoiceDueDate}
                  onChange={e => setInvoiceDueDate(e.target.value)}
                  style={{ display: "block", width: "100%", marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Notes (optional)
                <input value={invoiceNotes}
                  onChange={e => setInvoiceNotes(e.target.value)}
                  placeholder="Payment instructions, bank details, etc."
                  style={{ display: "block", width: "100%", marginTop: 4, boxSizing: "border-box" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button type="button" onClick={generateInvoicePdf} disabled={invoiceSaving}
                style={{ padding: "10px 22px", borderRadius: 8, border: "none",
                  background: "#2563eb", color: "white", cursor: invoiceSaving ? "default" : "pointer",
                  fontWeight: 700, opacity: invoiceSaving ? 0.7 : 1 }}>
                {invoiceSaving ? "Saving…" : "💾 Save & Download PDF"}
              </button>
              <button type="button" onClick={() => setShowInvoice(false)}
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--bg-panel)", color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Add Bill Modal ───────────────────────────── */}
      {showAddBill && (
        <div className="modal-backdrop" onClick={() => setShowAddBill(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}
            style={{ width:"620px", maxWidth:"95vw" }}>

            {/* Header + tab switcher */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <h2 style={{ margin:0 }}>{editingBill ? "Edit Bill" : "Add Bill"} — Order #{order.refNumber}</h2>
              <div style={{ display:"flex", gap:4, background:"var(--bg-panel)", borderRadius:8, padding:3 }}>
                <button type="button" onClick={() => setBillMode("manual")}
                  style={{ padding:"5px 14px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12,
                    background:billMode==="manual" ? "var(--accent)" : "transparent",
                    color:billMode==="manual" ? "white" : "var(--text-secondary)" }}>
                  ✏️ Manual
                </button>
                <button type="button"
                  onClick={() => { setBillMode("paste"); setBillParseResult(null); }}
                  style={{ padding:"5px 14px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12,
                    background:billMode==="paste" ? "var(--accent)" : "transparent",
                    color:billMode==="paste" ? "white" : "var(--text-secondary)" }}>
                  📄 From Invoice
                </button>
              </div>
            </div>

            {/* Order context badge */}
            <div style={{ fontSize:12, color:"var(--text-muted)", marginBottom:16 }}>
              Linked to: <strong style={{ color:"var(--accent)" }}>{order.refNumber}</strong>
              {(order.year || order.make) && (
                <span style={{ marginLeft:8 }}>
                  · {[order.year, order.make, order.model].filter(Boolean).join(" ")}
                </span>
              )}
            </div>

            {/* ── Paste / parse mode ── */}
            {billMode === "paste" && (
              <div>
                <p style={{ fontSize:13, color:"var(--text-secondary)", marginBottom:10 }}>
                  Paste the text from a dispatch sheet, invoice, or bill — we'll extract the key fields automatically.
                </p>
                <textarea
                  value={billDocPaste}
                  onChange={e => setBillDocPaste(e.target.value)}
                  rows={10}
                  placeholder="Paste invoice / dispatch text here…"
                  style={{ width:"100%", resize:"vertical", boxSizing:"border-box",
                    fontFamily:"monospace", fontSize:12 }}
                />
                <div style={{ display:"flex", gap:10, marginTop:10 }}>
                  <button type="button"
                    disabled={!billDocPaste.trim() || billParsing}
                    onClick={async () => {
                      setBillParsing(true);
                      try {
                        const r = await fetch(`${API}/api/vendors/parse-document`, {
                          method:  "POST",
                          headers: { "Content-Type": "application/json" },
                          body:    JSON.stringify({ text: billDocPaste }),
                        });
                        const parsed = await r.json();
                        setBillForm(prev => ({
                          ...prev,
                          vendor:        parsed.vendor        || prev.vendor        || "",
                          amount:        parsed.amount        || prev.amount        || "",
                          date:          parsed.date          || prev.date          || new Date().toISOString().slice(0,10),
                          category:      parsed.category      || prev.category      || "Towing / Transport",
                          description:   parsed.description   || prev.description   || "",
                          invoiceNumber: parsed.invoiceNumber || prev.invoiceNumber || "",
                          notes:         parsed.orderRef      ? `Ref: ${parsed.orderRef}` : prev.notes || "",
                        }));
                        setBillParseResult(parsed);
                        setBillMode("manual");
                      } catch { alert("Parse failed — try manual entry."); }
                      setBillParsing(false);
                    }}
                    style={{ padding:"10px 20px", borderRadius:8, border:"none", fontWeight:600,
                      background: billDocPaste.trim() ? "#2563eb" : "var(--bg-panel)",
                      color:      billDocPaste.trim() ? "white"   : "var(--text-muted)",
                      cursor:     billDocPaste.trim() ? "pointer" : "default" }}>
                    {billParsing ? "Parsing…" : "⚡ Parse Document"}
                  </button>
                  <button type="button" onClick={() => setShowAddBill(false)}
                    style={{ padding:"10px 14px", borderRadius:8, border:"1px solid var(--border)",
                      background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Manual / review form ── */}
            {billMode === "manual" && (
              <div>
                {billParseResult && (
                  <div style={{ marginBottom:12, padding:"8px 12px", borderRadius:8, fontSize:12,
                    background:"rgba(5,150,105,0.1)", border:"1px solid rgba(5,150,105,0.3)", color:"#34d399" }}>
                    ✅ Document parsed — review the fields below then save.
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                    Category *
                    <select value={billForm.category||""}
                      onChange={e => setBillForm(f=>({...f,category:e.target.value}))}
                      style={{ display:"block", width:"100%", marginTop:4 }}>
                      {BILL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                    Date
                    <input type="date" value={billForm.date||""}
                      onChange={e => setBillForm(f=>({...f,date:e.target.value}))}
                      style={{ display:"block", width:"100%", marginTop:4 }} />
                  </label>
                </div>

                <label style={{ fontSize:12, color:"var(--text-secondary)", display:"block", marginBottom:10 }}>
                  Vendor
                  <input value={billForm.vendor||""} list="bill-vendor-list"
                    onChange={e => setBillForm(f=>({...f,vendor:e.target.value}))}
                    placeholder="Type or select vendor…" autoComplete="off"
                    style={{ display:"block", width:"100%", marginTop:4, boxSizing:"border-box" }} />
                  {billVendors.length > 0 && (
                    <datalist id="bill-vendor-list">
                      {billVendors.map(v => <option key={v._id} value={v.name} />)}
                    </datalist>
                  )}
                </label>

                <label style={{ fontSize:12, color:"var(--text-secondary)", display:"block", marginBottom:10 }}>
                  Description *
                  <input value={billForm.description||""}
                    onChange={e => setBillForm(f=>({...f,description:e.target.value}))}
                    placeholder="e.g. 2019 Toyota Camry — VIN: 1G1BE5…"
                    style={{ display:"block", width:"100%", marginTop:4, boxSizing:"border-box" }} />
                </label>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
                  <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                    Amount ($) *
                    <input type="number" min="0" step="0.01" value={billForm.amount||""}
                      onChange={e => setBillForm(f=>({...f,amount:e.target.value}))}
                      placeholder="0.00"
                      style={{ display:"block", width:"100%", marginTop:4, textAlign:"right" }} />
                  </label>
                  <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                    Order Ref
                    <input value={billForm.orderRef||""}
                      onChange={e => setBillForm(f=>({...f,orderRef:e.target.value}))}
                      style={{ display:"block", width:"100%", marginTop:4 }} />
                  </label>
                  <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                    Invoice #
                    <input value={billForm.invoiceNumber||""}
                      onChange={e => setBillForm(f=>({...f,invoiceNumber:e.target.value}))}
                      placeholder="e.g. INV-0042"
                      style={{ display:"block", width:"100%", marginTop:4 }} />
                  </label>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                    Payment Status
                    <select value={billForm.status||"unpaid"}
                      onChange={e => setBillForm(f=>({...f,status:e.target.value}))}
                      style={{ display:"block", width:"100%", marginTop:4 }}>
                      <option value="unpaid">Unpaid</option>
                      <option value="paid">Paid</option>
                    </select>
                  </label>
                  {billForm.status === "paid" && (
                    <label style={{ fontSize:12, color:"var(--text-secondary)" }}>
                      Paid Date
                      <input type="date" value={billForm.paidDate||""}
                        onChange={e => setBillForm(f=>({...f,paidDate:e.target.value}))}
                        style={{ display:"block", width:"100%", marginTop:4 }} />
                    </label>
                  )}
                </div>

                <label style={{ fontSize:12, color:"var(--text-secondary)", display:"block", marginBottom:12 }}>
                  Notes
                  <textarea value={billForm.notes||""}
                    onChange={e => setBillForm(f=>({...f,notes:e.target.value}))}
                    rows={2}
                    style={{ display:"block", width:"100%", marginTop:4, resize:"vertical", boxSizing:"border-box" }} />
                </label>

                {/* ── Extra Charge Lines ── */}
                <div style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                    <span style={{ fontSize:12, color:"var(--text-secondary)" }}>Extra Charges</span>
                    <button type="button"
                      onClick={() => setBillExtraLines(l => [...l, { description: "", amount: "" }])}
                      style={{ fontSize:11, padding:"3px 10px", borderRadius:6, border:"1px solid var(--border)",
                        background:"none", color:"var(--success)", cursor:"pointer" }}>
                      + Add Line
                    </button>
                  </div>
                  {billExtraLines.map((line, i) => (
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 120px 28px", gap:6, alignItems:"center", marginBottom:6 }}>
                      <input
                        value={line.description}
                        onChange={e => setBillExtraLines(ls => ls.map((l, j) => j===i ? {...l, description: e.target.value} : l))}
                        placeholder="e.g. Storage Fee, Gate Fee…"
                        style={{ padding:"6px 10px", borderRadius:6, border:"1px solid var(--border)",
                          background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13, boxSizing:"border-box" }} />
                      <input
                        type="number" min="0" step="0.01"
                        value={line.amount}
                        onChange={e => setBillExtraLines(ls => ls.map((l, j) => j===i ? {...l, amount: e.target.value} : l))}
                        placeholder="0.00"
                        style={{ padding:"6px 10px", borderRadius:6, border:"1px solid var(--border)",
                          background:"var(--bg-input)", color:"var(--success)", fontSize:13, fontWeight:600, boxSizing:"border-box", textAlign:"right" }} />
                      <button type="button"
                        onClick={() => setBillExtraLines(ls => ls.filter((_, j) => j !== i))}
                        style={{ background:"none", border:"none", color:"var(--danger)", cursor:"pointer", fontSize:16, padding:0 }}>✕</button>
                    </div>
                  ))}
                  {billExtraLines.length > 0 && (
                    <div style={{ textAlign:"right", fontSize:12, color:"var(--text-muted)" }}>
                      Total incl. extras: <strong style={{ color:"var(--success)" }}>
                        ${(Number(billForm.amount||0) + billExtraLines.reduce((s,l) => s + Number(l.amount||0), 0)).toFixed(2)}
                      </strong>
                    </div>
                  )}
                </div>

                {/* File drop zones */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
                  <DropZone
                    label="Bill / Invoice Document"
                    hint="Drop the vendor's invoice"
                    file={billDocFile} setFile={setBillDocFile}
                    existingUrl={editingBill?.billFileName
                      ? `${API}/api/expenses/${editingBill._id}/bill` : null}
                    existingName="View bill"
                    onRemoveExisting={() => removeBillFile("bill")}
                  />
                  <DropZone
                    label="Payment Receipt"
                    hint="Drop proof of payment"
                    file={billReceiptFile} setFile={setBillReceiptFile}
                    existingUrl={editingBill?.receiptFileName
                      ? `${API}/api/expenses/${editingBill._id}/receipt` : null}
                    existingName="View receipt"
                    onRemoveExisting={() => removeBillFile("receipt")}
                  />
                </div>

                <div style={{ display:"flex", gap:10 }}>
                  <button type="button" onClick={saveBill} disabled={billSaving}
                    style={{ padding:"10px 20px", borderRadius:8, border:"none",
                      background:"#059669", color:"white", cursor:"pointer", fontWeight:700 }}>
                    {billSaving ? "Saving…" : editingBill ? "💾 Update Bill" : "💾 Save Bill"}
                  </button>
                  <button type="button" onClick={() => setShowAddBill(false)}
                    style={{ padding:"10px 14px", borderRadius:8, border:"1px solid var(--border)",
                      background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DR Send Modal ── */}
      {drSendModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#1c2130", border:"1px solid #2a3245", borderRadius:12, padding:28, width:480, maxWidth:"95vw" }}>
            <h3 style={{ margin:"0 0 18px", color:"#e6edf3" }}>✉️ Send Dock Receipt</h3>
            {[
              { label:"Customer Email", value: drSendTo, set: setDrSendTo, placeholder:"customer@example.com" },
              { label:"Trucker Email (optional)", value: drSendTrucker, set: setDrSendTrucker, placeholder:"trucker@example.com" },
              { label:"Subject", value: drSendSubject, set: setDrSendSubject, placeholder:"Subject" },
            ].map(({ label, value, set, placeholder }) => (
              <label key={label} style={{ display:"block", marginBottom:12, fontSize:12, color:"#8b949e" }}>
                {label}
                <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                  style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, boxSizing:"border-box" }} />
              </label>
            ))}
            <label style={{ display:"block", marginBottom:18, fontSize:12, color:"#8b949e" }}>
              Message
              <textarea value={drSendBody} onChange={e => setDrSendBody(e.target.value)} rows={5}
                style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, resize:"vertical", boxSizing:"border-box" }} />
            </label>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setDrSendModal(null)} style={{ padding:"8px 18px", background:"none", border:"1px solid #2a3245", borderRadius:8, color:"#8b949e", cursor:"pointer" }}>Skip</button>
              <button onClick={sendDrEmail} disabled={drSending} style={{ padding:"8px 20px", background:"#059669", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:600 }}>
                {drSending ? "Sending…" : "Send DR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invoice Send Modal ── */}
      {invoiceSendModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#1c2130", border:"1px solid #2a3245", borderRadius:12, padding:28, width:480, maxWidth:"95vw" }}>
            <h3 style={{ margin:"0 0 18px", color:"#e6edf3" }}>✉️ Send Invoice #{invoiceSendModal.invoiceNumber}</h3>
            <label style={{ display:"block", marginBottom:12, fontSize:12, color:"#8b949e" }}>
              Customer Email
              <input value={invSendTo} onChange={e => setInvSendTo(e.target.value)} placeholder="customer@example.com"
                style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, boxSizing:"border-box" }} />
            </label>
            <label style={{ display:"block", marginBottom:12, fontSize:12, color:"#8b949e" }}>
              Subject
              <input value={invSubject} onChange={e => setInvSubject(e.target.value)}
                style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, boxSizing:"border-box" }} />
            </label>
            <label style={{ display:"block", marginBottom:18, fontSize:12, color:"#8b949e" }}>
              Message
              <textarea value={invBody} onChange={e => setInvBody(e.target.value)} rows={5}
                style={{ display:"block", width:"100%", marginTop:4, padding:"8px 10px", background:"#0d1117", border:"1px solid #2a3245", borderRadius:6, color:"#e6edf3", fontSize:13, resize:"vertical", boxSizing:"border-box" }} />
            </label>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setInvoiceSendModal(null)} style={{ padding:"8px 18px", background:"none", border:"1px solid #2a3245", borderRadius:8, color:"#8b949e", cursor:"pointer" }}>Skip</button>
              <button onClick={sendInvoiceEmail} disabled={invSending} style={{ padding:"8px 20px", background:"#059669", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:600 }}>
                {invSending ? "Sending…" : "Send Invoice"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Doc Preview Popup ── */}
      {docPreview && (
        <div className="modal-backdrop" onClick={() => setDocPreview(null)}
          style={{ zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{
              background: "var(--bg-card)", borderRadius: 12, overflow: "hidden",
              width: "80vw", height: "88vh", display: "flex", flexDirection: "column",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {docPreview.name}
              </span>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
                {/* PIN badge — shown when previewing Buyer Receipt and order has a PIN */}
                {docPreview.label === "Buyer Receipt" && order.pin && (
                  <button
                    onClick={() => navigator.clipboard?.writeText(order.pin).then(() => setMessage("PIN copied!"))}
                    title="Click to copy PIN"
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 12px", borderRadius: 8,
                      background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)",
                      color: "#fbbf24", cursor: "pointer", fontSize: 13, fontWeight: 700,
                      fontFamily: "monospace", letterSpacing: "0.06em",
                    }}>
                    🔑 PIN: {order.pin}
                  </button>
                )}
                <a href={docPreview.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
                  ↗ Open in new tab
                </a>
                <button onClick={() => setDocPreview(null)}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
                  ✕
                </button>
              </div>
            </div>
            <iframe
              src={(() => {
                const m = docPreview.url.match(/\/d\/([a-zA-Z0-9_-]+)/);
                // Proxy through backend — avoids Google auth wall and enables copy/paste
                return m ? `${API}/api/drive-proxy/${m[1]}` : docPreview.url;
              })()}
              style={{ flex: 1, border: "none", width: "100%" }}
              title={docPreview.name}
              allow="autoplay"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── DR Edit modal helpers — defined at MODULE LEVEL so React never remounts them ──
// (Defining components inside a render function gives them a new type each render,
//  causing React to unmount+remount and losing input focus.)

function DrSection({ title }) {
  return (
    <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1,
      color:"var(--accent)", borderBottom:"1px solid var(--border)", paddingBottom:4,
      marginTop:16, marginBottom:8 }}>{title}</div>
  );
}

function DrField({ label, children }) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"145px 1fr", gap:8,
      alignItems:"center", fontSize:13, marginBottom:2 }}>
      <label style={{ color:"var(--text-muted)", fontSize:12 }}>{label}</label>
      {children}
    </div>
  );
}

function DrEditModal({ form, onFormChange, onApply, onClose }) {
  const set = (k, v) => onFormChange(prev => ({ ...prev, [k]: v }));

  const DATE_KEYS = ["sailDate", "arrivalDate", "cutoffDate"];

  // Convert YYYY-MM-DD → "2/28/2026" only when saving; during editing keep raw ISO string
  const isoToReadable = (s) => {
    if (!s) return "";
    const d = new Date(s + "T12:00:00"); // +T12 avoids timezone off-by-one
    return isNaN(d) ? s : d.toLocaleDateString("en-US"); // "2/28/2026"
  };

  const IS = { padding:"6px 9px", borderRadius:6, border:"1px solid var(--border)",
    background:"var(--bg-input)", color:"var(--text-primary)", fontSize:13,
    width:"100%", boxSizing:"border-box" };

  // inp returns a native <input> — stable reconciliation, no focus loss
  const inp = (k, ph, type = "text") => (
    <input type={type} value={form[k] || ""} placeholder={ph}
      onChange={e => set(k, e.target.value)} style={IS} />
  );
  const sel = (k, opts) => (
    <select value={form[k] || opts[0]} onChange={e => set(k, e.target.value)} style={IS}>
      {opts.map(o => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}
        style={{ width:"620px", maxWidth:"95vw", maxHeight:"85vh", overflowY:"auto" }}>
        <h2 style={{ marginTop:0 }}>✏️ Edit DR Fields</h2>

        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <DrSection title="Dates & Schedule" />
          <DrField label="Port Cutoff">{inp("cutoffDate", "", "date")}</DrField>
          <DrField label="Est. Sail Date">{inp("sailDate", "", "date")}</DrField>
          <DrField label="Est. Arrival Date">{inp("arrivalDate", "", "date")}</DrField>
          <DrField label="Vessel / Carrier">{inp("vessel", "e.g. GLOVIS SUNLIGHT")}</DrField>
          <DrField label="Voyage">{inp("voyage", "e.g. V.001")}</DrField>

          <DrSection title="Booking & AES" />
          <DrField label="Booking Number">{inp("bookingNumber", "e.g. SLSE-262651")}</DrField>
          <DrField label="AES ITN">{inp("aesItn", "e.g. X20260202869694")}</DrField>
          <DrField label="Declared Value">{inp("value", "e.g. 4650.00", "number")}</DrField>
          <DrField label="Weight (KGS)">{inp("weightKgs", "e.g. 1802", "number")}</DrField>

          <DrSection title="Ports" />
          <DrField label="Port of Loading">{inp("pol", "e.g. JACKSONVILLE")}</DrField>
          <DrField label="Port of Discharge">{inp("pod", "e.g. LAGOS")}</DrField>
          <DrField label="Loading Pier / Terminal">{inp("loadingTerminal", "e.g. SALLAUM TERMINAL")}</DrField>

          <DrSection title="Vehicle" />
          <DrField label="Year / Make / Model">{inp("vehicleYearMakeModel", "e.g. 2016 Mercedes GLC300")}</DrField>
          <DrField label="VIN">{inp("vin", "17-digit VIN")}</DrField>
          <DrField label="Condition">{sel("condition", ["Runner","Nonrunner","Forklift"])}</DrField>
          <DrField label="Title Status">{sel("titleStatus", ["Title","Pending","No Title"])}</DrField>

          <DrSection title="Exporter / USPPI" />
          <DrField label="Name">{inp("exporterName", "Exporter name")}</DrField>
          <DrField label="Address">{inp("exporterAddress", "Street address")}</DrField>
          <DrField label="City">{inp("exporterCity", "City")}</DrField>
          <DrField label="State">{inp("exporterState", "State")}</DrField>
          <DrField label="Zip">{inp("exporterZip", "Zip")}</DrField>
          <DrField label="Country">{inp("exporterCountry", "Country")}</DrField>

          <DrSection title="Consignee" />
          <DrField label="Name">{inp("consigneeName", "Consignee name")}</DrField>
          <DrField label="Address">{inp("consigneeAddress", "Street address")}</DrField>
          <DrField label="City">{inp("consigneeCity", "City")}</DrField>
          <DrField label="Country">{inp("consigneeCountry", "Country")}</DrField>

          <DrSection title="Empty Pick Up" />
          <DrField label="Name">{inp("pickupName", "Auction / location name")}</DrField>
          <DrField label="Address">{inp("pickupAddress", "Street address")}</DrField>
          <DrField label="City">{inp("pickupCity", "City")}</DrField>
          <DrField label="State">{inp("pickupState", "State")}</DrField>

          <DrSection title="Return / Delivery" />
          <DrField label="Name">{inp("deliveryName", "Port / terminal name")}</DrField>
          <DrField label="Address">{inp("deliveryAddress", "Street address")}</DrField>
          <DrField label="City">{inp("deliveryCity", "City")}</DrField>
          <DrField label="State">{inp("deliveryState", "State")}</DrField>
          <DrField label="Zip">{inp("deliveryZip", "Zip")}</DrField>
        </div>

        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button type="button"
            onClick={() => {
              const final = { ...form };
              DATE_KEYS.forEach(k => { if (form[k]) final[k] = isoToReadable(form[k]); });
              onApply(final);
            }}
            style={{ padding:"10px 20px", borderRadius:9, border:"none",
              background:"#059669", color:"white", cursor:"pointer", fontWeight:600 }}>
            ✓ Apply Changes
          </button>
          <button type="button" onClick={onClose}
            style={{ padding:"10px 14px", borderRadius:9, border:"1px solid var(--border)",
              background:"var(--bg-panel)", color:"var(--text-secondary)", cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CostRow({ label, value, onChange }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 120px",
        gap: "10px",
        alignItems: "center",
        fontSize: "13px",
      }}
    >
      <label>{label}</label>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "7px 8px",
          fontSize: "13px",
          textAlign: "right",
        }}
      />
    </div>
  );
}