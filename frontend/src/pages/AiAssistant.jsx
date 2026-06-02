import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const SUGGESTIONS = [
  "Which orders are missing AES weight?",
  "What vessel is sailing next?",
  "Show me all New Order status orders",
  "Which expenses are unpaid?",
  "Show me orders going to LAGOS",
  "Which orders are missing a booking number?",
];

export default function AiAssistant() {
  const navigate = useNavigate();

  const createOrder = (fields) => {
    sessionStorage.setItem("ai_prefill", JSON.stringify(fields));
    navigate("/orders/new");
  };

  const saveRules = async () => {
    const lastHistory = messages
      .map(m => `${m.role === "user" ? "Staff" : "AI"}: ${m.content}`)
      .join("\n");
    try {
      await fetch(`${API}/api/claude/upload-chat`, {
        method: "POST",
        body: (() => { const fd = new FormData(); fd.append("message", `Based on this conversation, save the extraction rules the staff taught you. Use <SAVE_RULE> tags.\n\nCONVERSATION:\n${lastHistory}`); fd.append("history", "[]"); return fd; })(),
      });
      setMessages(prev => [...prev, { role: "assistant", content: "✅ Rules saved! I'll apply them automatically on future uploads of the same document type." }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Failed to save rules." }]);
    }
  };

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi! I'm your DDG AI Assistant.\n\nYou can:\n• **Drop a shipping document** (buyer receipt, dispatch, BOL) to extract all order fields\n• **Ask questions** about your orders, expenses, or vessel schedules\n• **Teach me** — if I miss a field, tell me and say \"remember this\" to save it for next time",
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Doc context — persists while chatting about the same uploaded doc
  const [docContext, setDocContext] = useState(null); // { docText, docType, fileName }
  const [extractedFields, setExtractedFields] = useState(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── Send message (with optional file) ────────────────────────────────────
  const send = async (text, file) => {
    const msg = text || input.trim();
    if ((!msg && !file) || loading) return;
    setInput("");

    // User message bubble
    const userContent = file
      ? `📄 ${file.name}${msg ? `\n${msg}` : ""}`
      : msg;
    const next = [...messages, { role: "user", content: userContent }];
    setMessages(next);
    setLoading(true);

    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (msg) fd.append("message", msg);

      // Pass doc context for follow-up messages on same doc
      if (!file && docContext) {
        fd.append("docText", docContext.docText);
        fd.append("docType", docContext.docType);
        fd.append("fileName", docContext.fileName);
      }

      // Build history (skip greeting, skip last user msg we just added)
      const historyForServer = next.slice(1, -1)
        .filter(m => !m._skip)
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      fd.append("history", JSON.stringify(historyForServer));

      const res = await fetch(`${API}/api/claude/upload-chat`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");

      // Save doc context for follow-up messages
      if (data.docText) setDocContext({ docText: data.docText, docType: data.docType, fileName: data.fileName });
      if (data.extractedFields) setExtractedFields(data.extractedFields);

      setMessages([...next, {
        role: "assistant",
        content: data.reply || "No response.",
        extractedFields: data.extractedFields,
        docType: data.docType,
      }]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setLoading(false);
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) send("", file);
  };

  const clearChat = () => {
    setMessages([{
      role: "assistant",
      content: "Hi! I'm your DDG AI Assistant.\n\nYou can:\n• **Drop a shipping document** (buyer receipt, dispatch, BOL) to extract all order fields\n• **Ask questions** about your orders, expenses, or vessel schedules\n• **Teach me** — if I miss a field, tell me and say \"remember this\" to save it for next time",
    }]);
    setDocContext(null);
    setExtractedFields(null);
  };

  const hasDoc = !!docContext;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", maxWidth: 900, margin: "0 auto", padding: "0 16px" }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {dragging && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(26,110,247,0.15)", border: "3px dashed #1a6ef7",
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{ color: "#1a6ef7", fontSize: 22, fontWeight: 700 }}>✦ Drop document to extract fields</div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 0 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>✦</span>
          <div>
            <div style={{ color: "#e6edf3", fontWeight: 700, fontSize: 17 }}>DDG AI Assistant</div>
            <div style={{ color: "#3fb950", fontSize: 11 }}>● Powered by Groq · Live orders, expenses & schedules</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {hasDoc && (
            <div style={{ background: "#1a3a1a", border: "1px solid #2ea043", borderRadius: 8, padding: "4px 10px", fontSize: 11, color: "#3fb950" }}>
              📄 {docContext.docType}
            </div>
          )}
          {extractedFields && (
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(extractedFields, null, 2))}
              style={{ background: "#161b22", border: "1px solid #30363d", color: "#8b949e", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}
              title="Copy extracted fields as JSON"
            >Copy fields</button>
          )}
          <button onClick={clearChat} style={{ background: "#161b22", border: "1px solid #30363d", color: "#8b949e", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 11 }}>
            Clear
          </button>
        </div>
      </div>

      {/* Suggestions — only when fresh */}
      {messages.length <= 1 && (
        <div style={{ paddingBottom: 14 }}>
          {/* Upload prompt */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: "2px dashed #1a6ef755", borderRadius: 10, padding: "14px 18px",
              marginBottom: 10, cursor: "pointer", textAlign: "center",
              color: "#8b949e", fontSize: 13, transition: "border-color 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#1a6ef7"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "#1a6ef755"}
          >
            <span style={{ fontSize: 18 }}>📄</span>  Drop or click to upload a shipping document
            <div style={{ fontSize: 11, marginTop: 4, color: "#484f58" }}>Buyer receipt, dispatch sheet, BOL, booking confirmation…</div>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,.txt" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) send("", e.target.files[0]); }} />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} style={{
                background: "#161b22", border: "1px solid #30363d", borderRadius: 20,
                padding: "5px 12px", fontSize: 11, color: "#8b949e", cursor: "pointer",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#1a6ef7"; e.currentTarget.style.color = "#e6edf3"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#30363d"; e.currentTarget.style.color = "#8b949e"; }}
              >{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", gap: 8 }}>
            {m.role === "assistant" && (
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#1a6ef7,#0e4db5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", flexShrink: 0, marginTop: 2 }}>✦</div>
            )}
            <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{
                padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.65,
                background: m.role === "user" ? "#1a6ef7" : "#161b22",
                color: "#e6edf3",
                border: m.role === "user" ? "none" : "1px solid #21262d",
                whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>

              {/* Extracted fields card */}
              {m.extractedFields && (
                <div style={{ background: "#0d1117", border: "1px solid #1a6ef755", borderRadius: 10, padding: "10px 14px", fontSize: 12 }}>
                  <div style={{ color: "#1a6ef7", fontWeight: 600, marginBottom: 8, fontSize: 11 }}>✦ EXTRACTED FIELDS</div>
                  {[
                    { label: "Vehicle", keys: ["year","make","model","vin","color","mileage","lotNumber","bidAmount"] },
                    { label: "Customer", keys: ["customerName","customerPhone","customerEmail"] },
                    { label: "Pickup", keys: ["pickupName","pickupAddress","pickupCity","pickupState","pickupZip"] },
                    { label: "Delivery", keys: ["deliveryName","deliveryAddress","deliveryCity","deliveryState","deliveryZip"] },
                    { label: "Consignee", keys: ["consigneeName","consigneeAddress","consigneeCity","consigneeCountry"] },
                    { label: "Exporter", keys: ["exporterName","exporterAddress","exporterCity","exporterState","exporterZip"] },
                    { label: "Shipping", keys: ["vessel","voyage","bookingNumber","pol","pod","cutoffDate","sailDate"] },
                    { label: "Notes", keys: ["notes"] },
                  ].map(group => {
                    const items = group.keys.filter(k => m.extractedFields[k]);
                    if (!items.length) return null;
                    return (
                      <div key={group.label} style={{ marginBottom: 8 }}>
                        <div style={{ color: "#484f58", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{group.label}</div>
                        {items.map(k => (
                          <div key={k} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
                            <span style={{ color: "#8b949e", minWidth: 120 }}>{k}</span>
                            <span style={{ color: "#e6edf3" }}>{m.extractedFields[k]}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {m.extractedFields._addressBookMatch && (
                    <div style={{ color: "#3fb950", fontSize: 11, marginTop: 4 }}>✓ Matched address book: {m.extractedFields._addressBookMatch}</div>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => createOrder(m.extractedFields)}
                      style={{ background: "linear-gradient(135deg,#1a6ef7,#0e4db5)", border: "none", borderRadius: 8, color: "#fff", padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                    >✦ Create Order</button>
                    <button
                      onClick={saveRules}
                      style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, color: "#8b949e", padding: "7px 14px", cursor: "pointer", fontSize: 12 }}
                    >💾 Save Rules</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#1a6ef7,#0e4db5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", flexShrink: 0 }}>✦</div>
            <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: "10px 14px", color: "#8b949e", fontSize: 13 }}>Thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{ display: "flex", gap: 8, padding: "10px 0 16px", borderTop: "1px solid #21262d", alignItems: "flex-end" }}>
        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Upload document"
          style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, color: "#8b949e", padding: "10px 12px", cursor: "pointer", fontSize: 16, flexShrink: 0 }}
        >📎</button>
        <input ref={fileInputRef} type="file" accept=".pdf,.txt" style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) { send("", e.target.files[0]); e.target.value = ""; } }} />

        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder={hasDoc ? `Ask about ${docContext.docType}, correct a field, or say "remember this"…` : "Ask about orders, or drop a document above…"}
          style={{ flex: 1, background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "10px 14px", color: "#e6edf3", fontSize: 13, outline: "none" }}
          onFocus={e => e.target.style.borderColor = "#1a6ef7"}
          onBlur={e => e.target.style.borderColor = "#30363d"}
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{ background: loading || !input.trim() ? "#21262d" : "linear-gradient(135deg,#1a6ef7,#0e4db5)", border: "none", borderRadius: 10, color: "#fff", padding: "10px 18px", cursor: loading || !input.trim() ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}
        >Send</button>
      </div>
    </div>
  );
}

