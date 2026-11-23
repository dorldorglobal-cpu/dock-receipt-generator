import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Bank account last 4 for a list of vendor names → { [name]: { vendor, last4, bankName } }.
// Names are matched loosely on the server, same as bill imports.
export function useVendorAcct(names) {
  const key = [...new Set((names || []).map(n => String(n || "").trim()).filter(Boolean))].sort().join("|");
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    fetch(`${API}/api/vendors/bank-last4?names=${encodeURIComponent(key)}`)
      .then(r => (r.ok ? r.json() : {}))
      .then(d => { if (live) setMap(m => ({ ...m, ...d })); })
      .catch(() => {});
    return () => { live = false; };
  }, [key]);
  return map;
}

// "acc# ••1234" (green) or "acc# —" (orange) under a vendor name
export function VendorAcct({ info }) {
  if (!info) return null;
  return (
    <div title={info.vendor ? `Vendor: ${info.vendor}${info.bankName ? ` · ${info.bankName}` : ""}` : "No vendor record for this name yet"}
      style={{ fontSize: 11, marginTop: 2, fontFamily: "monospace", fontWeight: 400, color: info.last4 ? "#16a34a" : "var(--warning, #d97706)" }}>
      acc# {info.last4 ? `••${info.last4}` : "—"}
    </div>
  );
}
