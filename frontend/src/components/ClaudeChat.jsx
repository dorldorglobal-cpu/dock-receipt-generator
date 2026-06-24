import { useState, useRef, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const SUGGESTIONS = [
  "Which orders are missing AES weight?",
  "What vessel is sailing next?",
  "Show me all pending expenses",
  "Which orders are in New Order status?",
];

export default function ClaudeChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your DDG logistics assistant. Ask me anything about orders, expenses, or schedules." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");
    const next = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/claude/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: next.slice(1, -1), // skip the system greeting, skip the message we just added
        }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error || "No response." }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Connection error. Is the server running?" }]);
    }
    setLoading(false);
  };

  const s = {
    btn: {
      position: "fixed", bottom: 24, right: 24, zIndex: 1000,
      width: 52, height: 52, borderRadius: "50%",
      background: "linear-gradient(135deg, #2563eb, #0e4db5)",
      border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 4px 20px #2563eb55", fontSize: 22, color: "#fff",
      transition: "transform 0.15s",
    },
    panel: {
      position: "fixed", bottom: 88, right: 24, zIndex: 999,
      width: 360, height: 520, borderRadius: 14,
      background: "var(--bg-base)", border: "1px solid var(--border-muted)",
      display: "flex", flexDirection: "column",
      boxShadow: "0 8px 40px #000a",
      overflow: "hidden",
    },
    header: {
      padding: "12px 16px", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border-muted)",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    },
    messages: {
      flex: 1, overflowY: "auto", padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 10,
    },
    bubble: (role) => ({
      maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
      alignSelf: role === "user" ? "flex-end" : "flex-start",
      background: role === "user" ? "#2563eb" : "var(--bg-elevated)",
      color: "var(--text-primary)", border: role === "user" ? "none" : "1px solid var(--border-muted)",
      whiteSpace: "pre-wrap",
    }),
    inputRow: {
      display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--border-muted)",
      background: "var(--bg-base)",
    },
    input: {
      flex: 1, background: "var(--bg-elevated)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "7px 10px", color: "var(--text-primary)", fontSize: 13,
      outline: "none",
    },
    sendBtn: {
      background: "#2563eb", border: "none", borderRadius: 8, color: "#fff",
      padding: "7px 13px", cursor: "pointer", fontSize: 14,
    },
    chips: {
      display: "flex", flexWrap: "wrap", gap: 5, padding: "6px 12px 10px",
    },
    chip: {
      background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 20,
      padding: "4px 10px", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer",
    },
  };

  return (
    <>
      <button style={s.btn} onClick={() => setOpen(o => !o)} title="Ask DDG Assistant">
        {open ? "✕" : "✦"}
      </button>

      {open && (
        <div style={s.panel}>
          <div style={s.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>✦</span>
              <div>
                <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13 }}>DDG Assistant</div>
                <div style={{ color: "#3fb950", fontSize: 11 }}>● Powered by Claude</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>

          <div style={s.messages}>
            {messages.map((m, i) => (
              <div key={i} style={s.bubble(m.role)}>{m.content}</div>
            ))}
            {loading && <div style={s.bubble("assistant")}>Thinking…</div>}
            <div ref={bottomRef} />
          </div>

          {messages.length <= 1 && (
            <div style={s.chips}>
              {SUGGESTIONS.map(s2 => (
                <button key={s2} style={s.chip} onClick={() => send(s2)}>{s2}</button>
              ))}
            </div>
          )}

          <div style={s.inputRow}>
            <input
              style={s.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask about orders, expenses, schedules…"
              autoFocus
            />
            <button style={s.sendBtn} onClick={() => send()} disabled={loading}>➤</button>
          </div>
        </div>
      )}
    </>
  );
}
