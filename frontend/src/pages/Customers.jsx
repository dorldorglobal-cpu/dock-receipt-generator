import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";


function statusColor(s) {
  const m = {
    "Sailed":            "#34d399",
    "Arrived":           "#22d3ee",
    "Paid":              "#4ade80",
    "Completed":         "#86efac",
    "Delivered": "#a78bfa",
    "Waiting to Sail":   "#fb923c",
    "Picked Up":         "#60a5fa",
    "Awaiting Pickup":   "#fbbf24",
    "New Order":         "#9ca3af",
    "Problem / Hold":    "#f87171",
  };
  return m[s] || "#9ca3af";
}

function ago(dateStr) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30)  return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function fmtMoney(n) {
  if (!n) return null;
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Shared form fields helper ──────────────────────────────────────────────── */
function CustomerForm({ form, setForm }) {
  const inp = (key) => ({
    value: form[key] || "",
    onChange: (e) => setForm(f => ({ ...f, [key]: e.target.value })),
  });
  const num = (key) => ({
    value: form[key] || "",
    onChange: (e) => setForm(f => ({ ...f, [key]: e.target.value === "" ? "" : Number(e.target.value) })),
    type: "number",
    step: "0.01",
    min: "0",
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <label style={{ gridColumn: "1 / -1" }}>
        Company / Name *
        <input {...inp("companyName")} />
      </label>
      <label>
        Contact Name
        <input {...inp("contactName")} placeholder="Primary contact" />
      </label>
      <label>
        Phone / WhatsApp
        <input {...inp("phone")} />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Email
        <input {...inp("email")} type="email" />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Address
        <input {...inp("address")} />
      </label>
      <label>City <input {...inp("city")} /></label>
      <label>State <input {...inp("state")} /></label>
      <label>Postal Code <input {...inp("postalCode")} /></label>
      <label>Country <input {...inp("country")} /></label>
      <label>
        Balance ($)
        <input {...num("balance")} placeholder="0.00" />
      </label>
      <label>
        Overdue ($)
        <input {...num("overdue")} placeholder="0.00" />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Notes
        <textarea {...inp("notes")} rows={2} style={{ resize: "vertical" }} />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Ships To (Default Destination)
        <select {...inp("defaultPod")} style={{ marginTop: 4 }}>
          <option value="">— Unknown —</option>
          <option value="LAGOS">🇳🇬 Lagos, Nigeria</option>
          <option value="TEMA">🇬🇭 Tema, Ghana</option>
          <option value="COTONOU">🇧🇯 Cotonou, Benin</option>
          <option value="LOME">🇹🇬 Lomé, Togo</option>
        </select>
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Consignee
        <input {...inp("consignee")} placeholder="Default consignee name" />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        Buyer Accounts (auction names that belong to this customer)
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
          One per line — e.g. GOLDEN NOOR INTERNATIONAL LTD
        </div>
        <textarea
          value={(form.buyerAccounts || []).join("\n")}
          onChange={e => setForm(f => ({ ...f, buyerAccounts: e.target.value.split("\n") }))}
          onBlur={e => setForm(f => ({ ...f, buyerAccounts: e.target.value.split("\n").map(s => s.trim()).filter(Boolean) }))}
          rows={4}
          placeholder={"GOLDEN NOOR INTERNATIONAL LTD\nANOTHER AUCTION ACCOUNT"}
          style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
        />
      </label>
    </div>
  );
}

/* ── Create modal ───────────────────────────────────────────────────────────── */
function CreateModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    companyName: "", contactName: "", phone: "", email: "",
    address: "", city: "", state: "", postalCode: "", country: "",
    balance: "", overdue: "", notes: "", defaultPod: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!form.companyName.trim()) { setErr("Company / Name is required."); return; }
    setSaving(true);
    setErr("");
    const res = await fetch(`${API}/api/customers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, type: "customer" }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setErr(data.error || "Failed to create."); return; }
    onSave(data);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 540 }}>
        <h2 style={{ marginTop: 0, marginBottom: 18 }}>New Customer</h2>
        <CustomerForm form={form} setForm={setForm} />
        {err && <div style={{ color: "#f87171", marginTop: 10, fontSize: 13 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={save} disabled={saving}>{saving ? "Creating…" : "Create Customer"}</button>
          <button onClick={onClose} style={{ background: "var(--bg-panel)" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Edit modal ─────────────────────────────────────────────────────────────── */
function EditModal({ customer, onSave, onClose }) {
  const [form, setForm] = useState({
    companyName:  customer.companyName  || "",
    contactName:  customer.contactName  || "",
    phone:        customer.phone        || "",
    email:        customer.email        || "",
    address:      customer.address      || "",
    city:         customer.city         || "",
    state:        customer.state        || "",
    postalCode:   customer.postalCode   || "",
    country:      customer.country      || "",
    balance:      customer.balance      || "",
    overdue:      customer.overdue      || "",
    notes:        customer.notes        || "",
    defaultPod:     customer.defaultPod   || "",
    consignee:      customer.consignee    || "",
    buyerAccounts:  customer.buyerAccounts || [],
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`${API}/api/customers/${customer._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const updated = await res.json();
    setSaving(false);
    onSave(updated);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 540 }}>
        <h2 style={{ marginTop: 0, marginBottom: 18 }}>Edit Customer</h2>
        <CustomerForm form={form} setForm={setForm} />
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
          <button onClick={onClose} style={{ background: "var(--bg-panel)" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ── Orders drawer ──────────────────────────────────────────────────────────── */
function OrdersDrawer({ customer, onClose }) {
  const [orders, setOrders] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${API}/api/customers/${customer._id}/orders`)
      .then(r => r.json())
      .then(setOrders);
  }, [customer._id]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}
        style={{ width: 700, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>{customer.companyName}</h2>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
              {customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""}
              {customer.phone && <span style={{ marginLeft: 12 }}>📞 {customer.phone}</span>}
              {customer.email && <span style={{ marginLeft: 12 }}>✉️ {customer.email}</span>}
            </div>
            {(customer.buyerAccounts || []).length > 0 && (
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {customer.buyerAccounts.map(b => (
                  <span key={b} style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 12,
                    background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)",
                    color: "#a78bfa", fontWeight: 500,
                  }}>{b}</span>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ fontSize: 18, background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {!orders ? (
            <div style={{ color: "var(--text-muted)", padding: 20, textAlign: "center" }}>Loading…</div>
          ) : orders.length === 0 ? (
            <div style={{ color: "var(--text-muted)", padding: 20, textAlign: "center" }}>No orders yet.</div>
          ) : (
            <table className="orders-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Ref #</th>
                  <th>Vehicle</th>
                  <th>POL → POD</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o._id} style={{ cursor: "pointer" }}
                    onClick={() => { navigate(`/orders/${o._id}`); onClose(); }}>
                    <td style={{ fontWeight: 700, color: "var(--accent)" }}>{o.refNumber}</td>
                    <td>{[o.year, o.make, o.model].filter(Boolean).join(" ") || "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {o.pol || "—"} → {o.pod || "—"}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(o.status) }}>
                        {o.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {ago(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */
export default function Customers() {
  const [customers, setCustomers]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [creating, setCreating]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [viewing, setViewing]       = useState(null);
  const [deleteErr, setDeleteErr]   = useState("");   // error message for failed delete
  const [merging, setMerging]       = useState(null); // { group: [c1, c2], keepId: null }
  const [sortKey, setSortKey]       = useState("companyName");
  const [sortDir, setSortDir]       = useState(1);
  const [activeFilter, setActiveFilter] = useState(null); // "withOrders" | "balance" | "overdue"

  const load = async (q = "") => {
    setLoading(true);
    const res = await fetch(`${API}/api/customers${q ? `?search=${encodeURIComponent(q)}` : ""}`);
    const data = await res.json();
    setCustomers(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(1); }
  };

  const sorted = [...customers].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === "orderCount") return (bv - av) * sortDir;
    if (sortKey === "balance" || sortKey === "overdue") return ((bv || 0) - (av || 0)) * sortDir;
    if (sortKey === "lastOrder") {
      av = a.lastOrder?.createdAt || "";
      bv = b.lastOrder?.createdAt || "";
    }
    return String(av || "").localeCompare(String(bv || "")) * sortDir;
  });

  const downloadStatement = async (c) => {
    try {
      const res = await fetch(`${API}/api/customer-statement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: c.companyName }),
      });
      if (!res.ok) { alert("Failed to generate statement."); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `Statement-${c.companyName.replace(/[^a-z0-9]/gi, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Error generating statement.");
    }
  };

  // ── Duplicate detection ──────────────────────────────────────────────────────
  // Normalize name: lowercase, collapse spaces, expand common abbreviations
  const normName = (s) => (s || "").trim().toLowerCase()
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\bcompany\b/g, "co")
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const nameCount = {};
  customers.forEach(c => {
    const k = normName(c.companyName);
    nameCount[k] = (nameCount[k] || 0) + 1;
  });
  const isDup = (c) => nameCount[normName(c.companyName)] > 1;
  const dupCount = Object.values(nameCount).filter(n => n > 1).reduce((s, n) => s + n, 0);

  const openMerge = (c) => {
    const key = normName(c.companyName);
    const group = customers.filter(x => normName(x.companyName) === key);
    setMerging({ group, keepId: group[0]._id });
  };

  const doMerge = async () => {
    const deleteId = merging.group.find(c => c._id !== merging.keepId)?._id;
    if (!deleteId) return;
    const res = await fetch(`${API}/api/customers/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId: merging.keepId, deleteId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Merge failed"); return; }
    setMerging(null);
    load(search);
  };

  const handleDelete = async (c) => {
    setDeleteErr("");
    if (!window.confirm(`Delete "${c.companyName}"? This cannot be undone.`)) return;
    const res = await fetch(`${API}/api/customers/${c._id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setDeleteErr(data.error || "Delete failed.");
      return;
    }
    setCustomers(cs => cs.filter(x => x._id !== c._id));
  };

  const totalOrders    = customers.reduce((s, c) => s + (c.orderCount || 0), 0);
  const withOrders     = customers.filter(c => c.orderCount > 0).length;
  const totalBalance   = customers.reduce((s, c) => s + (c.balance || 0), 0);
  const totalOverdue   = customers.reduce((s, c) => s + (c.overdue || 0), 0);

  const toggleFilter = (f) => setActiveFilter(a => a === f ? null : f);

  const filtered = sorted.filter(c => {
    if (activeFilter === "withOrders") return c.orderCount > 0;
    if (activeFilter === "balance")    return (c.balance || 0) > 0;
    if (activeFilter === "overdue")    return (c.overdue || 0) > 0;
    if (activeFilter === "dupes")      return isDup(c);
    return true;
  });

  const SortTh = ({ k, children }) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: "pointer", userSelect: "none" }}>
      {children}
      {sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>All customers — auto-updated when orders are created.</p>
        </div>
        <button onClick={() => setCreating(true)} style={{ height: 36 }}>
          + New Customer
        </button>
      </div>

      {/* Summary cards */}
      <div className="dashboard-grid" style={{ marginBottom: 20 }}>
        <div className="dashboard-card">
          <span>Total Customers</span>
          <strong>{customers.length}</strong>
        </div>

        {/* Clickable: With Orders */}
        <div className="dashboard-card" onClick={() => toggleFilter("withOrders")}
          style={{ cursor: "pointer", outline: activeFilter === "withOrders" ? "2px solid var(--accent)" : "none",
            opacity: activeFilter && activeFilter !== "withOrders" ? 0.45 : 1, transition: "opacity .15s" }}>
          <span>With Orders {activeFilter === "withOrders" && <span style={{ fontSize: 10, color: "var(--accent)" }}>✕ clear</span>}</span>
          <strong style={{ color: activeFilter === "withOrders" ? "var(--accent)" : "inherit" }}>{withOrders}</strong>
        </div>

        <div className="dashboard-card">
          <span>Total Orders</span>
          <strong>{totalOrders}</strong>
        </div>

        {/* Clickable: Total Balance */}
        <div className="dashboard-card" onClick={() => toggleFilter("balance")}
          style={{ cursor: "pointer", outline: activeFilter === "balance" ? "2px solid #fb923c" : "none",
            opacity: activeFilter && activeFilter !== "balance" ? 0.45 : 1, transition: "opacity .15s" }}>
          <span>Total Balance {activeFilter === "balance" && <span style={{ fontSize: 10, color: "#fb923c" }}>✕ clear</span>}</span>
          <strong style={{ color: totalBalance > 0 ? "#fb923c" : "inherit" }}>
            {fmtMoney(totalBalance) || "$0.00"}
          </strong>
        </div>

        {/* Duplicates warning */}
        {dupCount > 0 && (
          <div className="dashboard-card" onClick={() => toggleFilter("dupes")}
            style={{ cursor:"pointer", outline: activeFilter === "dupes" ? "2px solid #f97316" : "2px solid #f9731660",
              opacity: activeFilter && activeFilter !== "dupes" ? 0.45 : 1, transition:"opacity .15s" }}>
            <span style={{ color:"#f97316" }}>⚠ Duplicates {activeFilter === "dupes" && <span style={{ fontSize:10 }}>✕ clear</span>}</span>
            <strong style={{ color:"#f97316" }}>{dupCount}</strong>
          </div>
        )}

        {/* Clickable: Total Overdue */}
        <div className="dashboard-card" onClick={() => toggleFilter("overdue")}
          style={{ cursor: "pointer", outline: activeFilter === "overdue" ? "2px solid #f87171" : "none",
            opacity: activeFilter && activeFilter !== "overdue" ? 0.45 : 1, transition: "opacity .15s" }}>
          <span>Total Overdue {activeFilter === "overdue" && <span style={{ fontSize: 10, color: "#f87171" }}>✕ clear</span>}</span>
          <strong style={{ color: totalOverdue > 0 ? "#f87171" : "inherit" }}>
            {fmtMoney(totalOverdue) || "$0.00"}
          </strong>
        </div>
      </div>

      <section className="form-section">
        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 14, gap: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, phone…"
            style={{ maxWidth: 320 }}
          />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {loading ? "Loading…" : `${filtered.length} customer${filtered.length !== 1 ? "s" : ""}${activeFilter ? " (filtered)" : ""}`}
          </div>
        </div>

        {/* Delete error banner */}
        {deleteErr && (
          <div style={{ background: "#451a1a", border: "1px solid #f87171", color: "#f87171",
            borderRadius: 6, padding: "10px 14px", marginBottom: 12, fontSize: 13,
            display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {deleteErr}
            <button onClick={() => setDeleteErr("")}
              style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
        )}

        <table className="orders-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <SortTh k="companyName">Customer</SortTh>
              <th>Phone</th>
              <th>Email</th>
              <th>Country</th>
              <th>Consignee</th>
              <SortTh k="orderCount">Orders</SortTh>
              <SortTh k="lastOrder">Last Order</SortTh>
              <th>Last Status</th>
              <SortTh k="balance">Balance</SortTh>
              <SortTh k="overdue">Overdue</SortTh>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c._id} style={ isDup(c) ? { background:"rgba(249,115,22,0.07)", outline:"1px solid rgba(249,115,22,0.25)" } : {}}>
                {/* Name */}
                <td>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <button onClick={() => setViewing(c)}
                      style={{ background: "none", border: "none", padding: 0,
                        color: "var(--accent)", fontWeight: 700, cursor: "pointer",
                        fontSize: 13, textAlign: "left" }}>
                      {c.companyName || "—"}
                    </button>
                    {isDup(c) && (
                      <span style={{ fontSize:9, fontWeight:700, color:"#f97316",
                        background:"rgba(249,115,22,0.15)", border:"1px solid rgba(249,115,22,0.4)",
                        borderRadius:3, padding:"1px 5px", letterSpacing:"0.04em" }}>
                        DUPE
                      </span>
                    )}
                  </div>
                  {c.contactName && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.contactName}</div>
                  )}
                  {(c.buyerAccounts || []).length > 0 && (
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:3 }}>
                      {c.buyerAccounts.map(b => (
                        <span key={b} style={{
                          fontSize: 10, padding: "1px 6px", borderRadius: 10,
                          background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)",
                          color: "#a78bfa", fontWeight: 500, whiteSpace: "nowrap",
                        }}>{b}</span>
                      ))}
                    </div>
                  )}
                </td>

                {/* Phone */}
                <td style={{ fontSize: 12 }}>{c.phone || <span style={{ color:"var(--text-muted)" }}>—</span>}</td>

                {/* Email */}
                <td style={{ fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.email
                    ? <a href={`mailto:${c.email}`} style={{ color: "var(--text-secondary)" }}>{c.email}</a>
                    : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>

                {/* Country */}
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.country || "—"}</td>

                {/* Consignee */}
                <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.consignee || <span style={{ color:"var(--text-muted)" }}>—</span>}</td>

                {/* Order count */}
                <td>
                  {c.orderCount > 0 ? (
                    <span style={{ fontWeight: 700, color: c.orderCount >= 5 ? "#34d399" :
                      c.orderCount >= 2 ? "var(--accent)" : "var(--text-secondary)" }}>
                      {c.orderCount}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>0</span>
                  )}
                </td>

                {/* Last order */}
                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {c.lastOrder ? (
                    <div>
                      <div style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                        #{c.lastOrder.refNumber}
                      </div>
                      <div>{ago(c.lastOrder.createdAt)}</div>
                    </div>
                  ) : "—"}
                </td>

                {/* Last status */}
                <td>
                  {c.lastOrder?.status ? (
                    <span style={{ fontSize: 11, fontWeight: 600,
                      color: statusColor(c.lastOrder.status) }}>
                      {c.lastOrder.status}
                    </span>
                  ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>

                {/* Balance */}
                <td style={{ fontSize: 12, textAlign: "right" }}>
                  {c.balance > 0
                    ? <span style={{ color: "#fb923c", fontWeight: 600 }}>{fmtMoney(c.balance)}</span>
                    : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>

                {/* Overdue */}
                <td style={{ fontSize: 12, textAlign: "right" }}>
                  {c.overdue > 0
                    ? <span style={{ color: "#f87171", fontWeight: 700 }}>{fmtMoney(c.overdue)}</span>
                    : <span style={{ color: "var(--text-muted)" }}>—</span>}
                </td>

                {/* Actions */}
                <td style={{ whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setEditing(c)}
                      style={{ fontSize: 10, padding: "3px 8px" }}>Edit</button>
                    {c.orderCount > 0 && (
                      <button onClick={() => setViewing(c)}
                        style={{ fontSize: 10, padding: "3px 8px" }}>Orders</button>
                    )}
                    {isDup(c) && (
                      <button onClick={() => openMerge(c)}
                        style={{ fontSize: 10, padding: "3px 8px",
                          background: "rgba(249,115,22,0.15)", color: "#f97316",
                          border: "1px solid rgba(249,115,22,0.4)" }}>
                        ⚠ Merge
                      </button>
                    )}
                    {c.orderCount > 0 && (
                      <button onClick={() => downloadStatement(c)}
                        style={{ fontSize: 10, padding: "3px 8px",
                          background: "var(--bg-panel)", border: "1px solid var(--border)",
                          color: "var(--text-secondary)" }}
                        title="Download PDF statement">
                        📋 Statement
                      </button>
                    )}
                    <button onClick={() => handleDelete(c)}
                      style={{ fontSize: 10, padding: "3px 8px",
                        background: "#451a1a", color: "#f87171",
                        border: "1px solid #7f1d1d" }}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="10" style={{ textAlign: "center", color: "var(--text-muted)", padding: 30 }}>
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Create modal */}
      {creating && (
        <CreateModal
          onSave={(newCustomer) => {
            setCustomers(cs => [{ ...newCustomer, orderCount: 0, lastOrder: null }, ...cs]);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <EditModal
          customer={editing}
          onSave={(updated) => {
            setCustomers(cs => cs.map(c => c._id === updated._id ? { ...c, ...updated } : c));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Orders drawer */}
      {viewing && (
        <OrdersDrawer customer={viewing} onClose={() => setViewing(null)} />
      )}

      {/* Merge modal */}
      {merging && (
        <div className="modal-backdrop" onClick={() => setMerging(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ width: 620 }}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>⚠ Merge Duplicate Customers</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 20 }}>
              Choose which record to <strong style={{ color:"var(--text-primary)" }}>keep</strong>. The other will be deleted and its orders re-linked to the kept record.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {merging.group.map(c => {
                const isKept = merging.keepId === c._id;
                return (
                  <div key={c._id}
                    onClick={() => setMerging(m => ({ ...m, keepId: c._id }))}
                    style={{ border: `2px solid ${isKept ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: 10, padding: 16, cursor: "pointer",
                      background: isKept ? "rgba(59,130,246,0.08)" : "var(--bg-panel)",
                      transition: "all 0.15s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700,
                        color: isKept ? "var(--accent)" : "var(--text-muted)",
                        textTransform:"uppercase", letterSpacing:"0.05em" }}>
                        {isKept ? "✓ Keep this" : "Click to keep"}
                      </span>
                      {c.orderCount > 0 && (
                        <span style={{ fontSize:10, background:"var(--bg-panel)", border:"1px solid var(--border)",
                          borderRadius:4, padding:"1px 6px", color:"var(--text-secondary)" }}>
                          {c.orderCount} order{c.orderCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{c.companyName}</div>
                    {[
                      ["Contact", c.contactName],
                      ["Phone",   c.phone],
                      ["Email",   c.email],
                      ["Country", c.country],
                      ["Balance", c.balance > 0 ? fmtMoney(c.balance) : null],
                    ].filter(([, v]) => v).map(([label, val]) => (
                      <div key={label} style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3 }}>
                        <span style={{ color:"var(--text-muted)", marginRight:4 }}>{label}:</span>{val}
                      </div>
                    ))}
                    {c.defaultPod && (
                      <div style={{ marginTop: 8, padding: "5px 10px", borderRadius: 6,
                        background: "rgba(37,99,235,0.12)", border: "1px solid rgba(96,165,250,0.3)",
                        fontSize: 13, fontWeight: 700, color: "#60a5fa", textAlign: "center" }}>
                        ✈ Ships to {c.defaultPod}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setMerging(null)}
                style={{ background: "var(--bg-panel)" }}>Cancel</button>
              <button onClick={doMerge}
                style={{ background: "#f97316", color: "#fff", border: "none" }}>
                Merge — Keep Selected, Delete Other
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
