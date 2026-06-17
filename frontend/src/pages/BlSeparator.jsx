import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const fmt$ = (n) =>
  n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BlSeparator() {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { carrier, bls, sessionId }
  const [selected, setSelected] = useState({}); // blNumber+type → { selected, createExpense }
  const [attaching, setAttaching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const fileRef = useRef();

  const reset = () => {
    setParsed(null);
    setSelected({});
    setResults(null);
    setError("");
  };

  const blKey = (bl, i) => `${i}-${bl.blNumber}-${bl.type}`;

  const handleFile = async (file) => {
    if (!file || !file.name.endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    setError("");
    setParsing(true);
    setParsed(null);
    setResults(null);

    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(`${API}/api/bl-separator/parse`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");

      setParsed(data);
      // Default: select all with an order match
      const sel = {};
      data.bls.forEach((bl, i) => {
        const k = blKey(bl, i);
        sel[k] = { selected: !!bl.orderId, createExpense: bl.type === "rated" && !!bl.orderId };
      });
      setSelected(sel);
    } catch (e) {
      setError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onFileChange = (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  };

  const toggleAll = (val) => {
    const next = {};
    parsed.bls.forEach((bl, i) => {
      const k = blKey(bl, i);
      next[k] = { ...selected[k], selected: val && !!bl.orderId };
    });
    setSelected(next);
  };

  const attachSelected = async () => {
    const toAttach = parsed.bls
      .map((bl, i) => ({ bl, i }))
      .filter(({ bl, i }) => selected[blKey(bl, i)]?.selected && bl.orderId)
      .map(({ bl, i }) => ({
        pages: bl.pages,
        orderId: bl.orderId,
        blNumber: bl.blNumber,
        refNumber: bl.refNumber,
        type: bl.type,
        vin: bl.vin,
        vehicle: bl.vehicle,
        charges: bl.charges,
        createExpense: !!selected[blKey(bl, i)]?.createExpense,
      }));

    if (!toAttach.length) {
      setError("No BLs selected.");
      return;
    }

    setAttaching(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/bl-separator/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: parsed.sessionId, bls: toAttach }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Attach failed");
      setResults(data.results);
    } catch (e) {
      setError(e.message);
    } finally {
      setAttaching(false);
    }
  };

  const selectedCount = parsed
    ? parsed.bls.filter((bl, i) => selected[blKey(bl, i)]?.selected && bl.orderId).length
    : 0;

  return (
    <div style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 4, fontSize: 22 }}>BL Separator</h2>
      <p style={{ color: "#9ca3af", marginBottom: 24, fontSize: 14 }}>
        Upload a Sallaum or ACL/Grimaldi batch BL PDF. The system will parse and separate individual
        BLs, match them to orders, and upload each BL to the correct order's documents.
      </p>

      {!parsed && !parsing && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#6366f1" : "#374151"}`,
            borderRadius: 12,
            padding: "60px 40px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#1e1b4b22" : "#111827",
            transition: "border-color 0.2s, background 0.2s",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e5e7eb", marginBottom: 6 }}>
            Drop BL PDF here or click to browse
          </div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            Supports Sallaum (SLSE-) and ACL/Grimaldi (S329-)
          </div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={onFileChange} />
        </div>
      )}

      {parsing && (
        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
          Parsing PDF…
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: "10px 16px", background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, color: "#ef4444", fontSize: 14 }}>
          {error}
        </div>
      )}

      {results && (
        <div style={{ marginTop: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Results</h3>
            <button
              onClick={reset}
              style={{ padding: "6px 14px", background: "#374151", color: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
            >
              Upload Another
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  background: r.success ? "#052e1622" : "#7f1d1d22",
                  border: `1px solid ${r.success ? "#34d399" : "#ef4444"}`,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ color: r.success ? "#34d399" : "#ef4444", fontSize: 16 }}>
                  {r.success ? "✓" : "✗"}
                </span>
                <span style={{ color: "#e5e7eb", fontWeight: 600 }}>Order {r.refNumber}</span>
                <span style={{ color: "#9ca3af" }}>BL {r.blNumber}</span>
                {r.error && <span style={{ color: "#ef4444" }}>{r.error}</span>}
                {r.driveLink && (
                  <a href={r.driveLink} target="_blank" rel="noreferrer" style={{ color: "#6366f1", marginLeft: "auto", fontSize: 12 }}>
                    View in Drive ↗
                  </a>
                )}
                {r.expenseId && (
                  <span style={{ color: "#f59e0b", fontSize: 12 }}>+ Ocean Freight expense created</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed && !results && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <div>
              <span style={{ color: "#9ca3af", fontSize: 13 }}>Carrier: </span>
              <span style={{ color: "#e5e7eb", fontWeight: 600 }}>{parsed.carrier}</span>
              <span style={{ color: "#9ca3af", fontSize: 13, marginLeft: 16 }}>{parsed.bls.length} BLs found</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button onClick={() => toggleAll(true)} style={btnStyle("#1e3a5f", "#60a5fa")}>Select All</button>
              <button onClick={() => toggleAll(false)} style={btnStyle("#374151", "#9ca3af")}>Deselect All</button>
              <button onClick={reset} style={btnStyle("#374151", "#9ca3af")}>Reset</button>
              <button
                onClick={attachSelected}
                disabled={attaching || selectedCount === 0}
                style={btnStyle(selectedCount > 0 ? "#312e81" : "#374151", selectedCount > 0 ? "#818cf8" : "#6b7280", attaching)}
              >
                {attaching ? "Uploading…" : `Upload ${selectedCount} BL${selectedCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #374151", color: "#6b7280", textAlign: "left" }}>
                <th style={th}>✓</th>
                <th style={th}>BL #</th>
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>VIN</th>
                <th style={th}>Vehicle</th>
                <th style={th}>Type</th>
                <th style={th}>Charges</th>
                {parsed.carrier === "ACL" && <th style={th}>Create Expense</th>}
              </tr>
            </thead>
            <tbody>
              {parsed.bls.map((bl, i) => {
                const k = blKey(bl, i);
                const sel = selected[k] || {};
                const matched = !!bl.orderId;
                return (
                  <tr
                    key={k}
                    style={{
                      borderBottom: "1px solid #1f2937",
                      background: sel.selected ? "#1e1b4b11" : "transparent",
                      opacity: matched ? 1 : 0.5,
                    }}
                  >
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={!!sel.selected}
                        disabled={!matched}
                        onChange={(e) =>
                          setSelected((prev) => ({
                            ...prev,
                            [k]: { ...prev[k], selected: e.target.checked },
                          }))
                        }
                        style={{ accentColor: "#6366f1", width: 14, height: 14 }}
                      />
                    </td>
                    <td style={td}>
                      <span style={{ color: "#e5e7eb", fontFamily: "monospace" }}>{bl.blNumber || "—"}</span>
                    </td>
                    <td style={td}>
                      {matched ? (
                        <span style={{ color: "#34d399", fontWeight: 600 }}>{bl.refNumber}</span>
                      ) : (
                        <span style={{ color: "#ef4444" }}>{bl.refNumber || "?"} (not found)</span>
                      )}
                    </td>
                    <td style={td}>
                      <span style={{ color: "#9ca3af" }}>{bl.orderCustomer || "—"}</span>
                    </td>
                    <td style={td}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "#d1d5db" }}>
                        {bl.vin || "—"}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ color: "#d1d5db" }}>{bl.vehicle || "—"}</span>
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 9999,
                          fontSize: 11,
                          fontWeight: 600,
                          background: bl.type === "rated" ? "#78350f22" : "#1e3a5f22",
                          color: bl.type === "rated" ? "#f59e0b" : "#60a5fa",
                          textTransform: "uppercase",
                        }}
                      >
                        {bl.type}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{ color: bl.charges ? "#34d399" : "#6b7280" }}>
                        {bl.charges ? fmt$(bl.charges) : "—"}
                      </span>
                    </td>
                    {parsed.carrier === "ACL" && (
                      <td style={td}>
                        {bl.type === "rated" && matched ? (
                          <input
                            type="checkbox"
                            checked={!!sel.createExpense}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [k]: { ...prev[k], createExpense: e.target.checked },
                              }))
                            }
                            style={{ accentColor: "#f59e0b", width: 14, height: 14 }}
                          />
                        ) : (
                          <span style={{ color: "#374151" }}>—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: "8px 12px", fontWeight: 500, fontSize: 12 };
const td = { padding: "10px 12px", verticalAlign: "middle" };
const btnStyle = (bg, color, disabled) => ({
  padding: "7px 14px",
  background: bg,
  color,
  border: "none",
  borderRadius: 6,
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13,
  fontWeight: 500,
  opacity: disabled ? 0.6 : 1,
});
