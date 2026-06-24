import { useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const fmt$ = (n) =>
  n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BlSeparator() {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { carrier, bls, sessionId }
  const [selected, setSelected] = useState({}); // key → { selected, createExpense }
  const [attaching, setAttaching] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Inline per-BL upload results: key → { success, error, driveLink, expenseId }
  const [rowResults, setRowResults] = useState({});
  const [error, setError] = useState("");
  const fileRef = useRef();

  const reset = () => {
    setParsed(null);
    setSelected({});
    setRowResults({});
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
    setRowResults({});

    try {
      const fd = new FormData();
      fd.append("pdf", file);
      const res = await fetch(`${API}/api/bl-separator/parse`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");

      setParsed(data);
      const sel = {};
      data.bls.forEach((bl, i) => {
        const k = blKey(bl, i);
        sel[k] = { selected: true, createExpense: bl.type === "rated" && !!bl.orderId };
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
    e.target.value = "";
  };

  const toggleAll = (val) => {
    const next = {};
    parsed.bls.forEach((bl, i) => {
      const k = blKey(bl, i);
      next[k] = { ...selected[k], selected: val };
    });
    setSelected(next);
  };

  const selectedMatched = parsed
    ? parsed.bls.filter((bl, i) => selected[blKey(bl, i)]?.selected && bl.orderId).length
    : 0;
  const selectedAll = parsed
    ? parsed.bls.filter((bl, i) => selected[blKey(bl, i)]?.selected).length
    : 0;

  const attachSelected = async () => {
    const toAttach = parsed.bls
      .map((bl, i) => ({ bl, i, k: blKey(bl, i) }))
      .filter(({ bl, i, k }) => selected[k]?.selected && bl.orderId);

    if (!toAttach.length) { setError("No matched BLs selected."); return; }

    setAttaching(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/bl-separator/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: parsed.sessionId,
          bls: toAttach.map(({ bl, i, k }) => ({
            pages: bl.pages,
            orderId: bl.orderId,
            blNumber: bl.blNumber,
            refNumber: bl.refNumber,
            type: bl.type,
            vin: bl.vin,
            vehicle: bl.vehicle,
            vessel: bl.vessel,
            voyage: bl.voyage,
            charges: bl.charges,
            createExpense: !!selected[k]?.createExpense,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Attach failed");

      // Merge results into rowResults by matching blNumber + refNumber
      setRowResults((prev) => {
        const next = { ...prev };
        data.results.forEach((r) => {
          // Find the matching key
          const match = toAttach.find(
            ({ bl }) => bl.blNumber === r.blNumber && bl.refNumber === r.refNumber
          );
          if (match) next[match.k] = r;
        });
        return next;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setAttaching(false);
    }
  };

  const downloadSelected = async () => {
    const toDownload = parsed.bls
      .map((bl, i) => ({ bl, i }))
      .filter(({ bl, i }) => selected[blKey(bl, i)]?.selected);

    if (!toDownload.length) { setError("No BLs selected."); return; }

    setDownloading(true);
    setError("");
    try {
      for (const { bl } of toDownload) {
        const typeLabel = bl.type === "rated" ? "Rated" : "Draft";
        const ref = bl.refNumber || bl.blNumber || "Unknown";
        const filename = `${ref} ${typeLabel}.pdf`;

        const res = await fetch(`${API}/api/bl-separator/download-bl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: parsed.sessionId, pages: bl.pages, filename }),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Download failed"); }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 4, fontSize: 22 }}>BL Separator</h2>
      <p style={{ color: "#9ca3af", marginBottom: 24, fontSize: 14 }}>
        Upload a Sallaum or ACL/Grimaldi batch BL PDF. The system will parse and separate individual
        BLs, match them to orders by reference number, and let you upload or download each BL.
      </p>

      {!parsed && !parsing && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#6366f1" : "var(--border)"}`,
            borderRadius: 12,
            padding: "60px 40px",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "#1e1b4b22" : "var(--bg-elevated)",
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
        <div style={{ marginTop: 16, marginBottom: 8, padding: "10px 16px", background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, color: "#ef4444", fontSize: 14 }}>
          {error}
        </div>
      )}

      {parsed && (
        <div>
          {/* Action bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ color: "#9ca3af", fontSize: 13 }}>
              <span style={{ color: "#e5e7eb", fontWeight: 600 }}>{parsed.carrier}</span>
              <span style={{ marginLeft: 10 }}>{parsed.bls.length} BLs</span>
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => toggleAll(true)} style={btnStyle("#1e3a5f", "#60a5fa")}>Select All</button>
              <button onClick={() => toggleAll(false)} style={btnStyle("var(--border)", "#9ca3af")}>Deselect All</button>
              <button onClick={reset} style={btnStyle("var(--border)", "#9ca3af")}>Reset</button>

              <button
                onClick={downloadSelected}
                disabled={downloading || selectedAll === 0}
                style={btnStyle(selectedAll > 0 ? "#1a2e1a" : "var(--border)", selectedAll > 0 ? "#4ade80" : "#6b7280", downloading || selectedAll === 0)}
              >
                {downloading ? "Downloading…" : `⬇ Download Selected (${selectedAll})`}
              </button>

              <button
                onClick={attachSelected}
                disabled={attaching || selectedMatched === 0}
                style={btnStyle(selectedMatched > 0 ? "#312e81" : "var(--border)", selectedMatched > 0 ? "#818cf8" : "#6b7280", attaching || selectedMatched === 0)}
              >
                {attaching ? "Uploading…" : `☁ Upload to Orders (${selectedMatched})`}
              </button>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "#6b7280", textAlign: "left" }}>
                <th style={th}>✓</th>
                <th style={th}>BL #</th>
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>VIN</th>
                <th style={th}>Vehicle</th>
                <th style={th}>Type</th>
                <th style={th}>Charges</th>
                {parsed.carrier === "ACL" && <th style={th}>Expense</th>}
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {parsed.bls.map((bl, i) => {
                const k = blKey(bl, i);
                const sel = selected[k] || {};
                const matched = !!bl.orderId;
                const result = rowResults[k];
                return (
                  <tr
                    key={k}
                    style={{
                      borderBottom: "1px solid #1f2937",
                      background: result?.success
                        ? "#052e1611"
                        : sel.selected ? "#1e1b4b11" : "transparent",
                    }}
                  >
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={!!sel.selected}
                        onChange={(e) =>
                          setSelected((prev) => ({
                            ...prev,
                            [k]: { ...prev[k], selected: e.target.checked },
                          }))
                        }
                        style={{ accentColor: "#6366f1", width: 14, height: 14, cursor: "pointer" }}
                      />
                    </td>
                    <td style={td}>
                      <span style={{ color: "#e5e7eb", fontFamily: "monospace" }}>{bl.blNumber || "—"}</span>
                    </td>
                    <td style={td}>
                      {matched ? (
                        <span style={{ color: "#34d399", fontWeight: 600 }}>{bl.refNumber}</span>
                      ) : (
                        <span style={{ color: "#ef4444" }}>
                          {bl.refNumber || "?"} <span style={{ color: "#6b7280", fontSize: 11 }}>(not found)</span>
                        </span>
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
                      <span style={{
                        padding: "2px 8px", borderRadius: 9999, fontSize: 11, fontWeight: 600,
                        background: bl.type === "rated" ? "#78350f22" : "#1e3a5f22",
                        color: bl.type === "rated" ? "#f59e0b" : "#60a5fa",
                        textTransform: "uppercase",
                      }}>
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
                            style={{ accentColor: "#f59e0b", width: 14, height: 14, cursor: "pointer" }}
                          />
                        ) : (
                          <span style={{ color: "var(--border)" }}>—</span>
                        )}
                      </td>
                    )}
                    <td style={td}>
                      {result ? (
                        result.success ? (
                          <span style={{ color: "#34d399", fontSize: 12 }}>
                            ✓ Uploaded
                            {result.expenseId && <span style={{ color: "#f59e0b", marginLeft: 6 }}>+ expense</span>}
                          </span>
                        ) : (
                          <span style={{ color: "#ef4444", fontSize: 12 }}>✗ {result.error}</span>
                        )
                      ) : (
                        <span style={{ color: "var(--border)" }}>—</span>
                      )}
                    </td>
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
