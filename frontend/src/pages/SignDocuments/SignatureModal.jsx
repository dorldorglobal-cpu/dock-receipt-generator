import { useEffect, useRef, useState } from "react";

const FONTS = [
  { key: "cursive1", label: "Signature", family: "'Dancing Script', cursive" },
  { key: "cursive2", label: "Elegant", family: "'Caveat', cursive" },
  { key: "print", label: "Print", family: "'Inter', sans-serif" },
];

// Trims a canvas down to its non-transparent bounding box and returns a new canvas.
function trimCanvas(canvas, padding = 10) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // blank
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return out;
}

export default function SignatureModal({ onCancel, onInsert }) {
  const [tab, setTab] = useState("draw");
  const [typedText, setTypedText] = useState("");
  const [fontKey, setFontKey] = useState(FONTS[0].key);
  const [empty, setEmpty] = useState(true);
  const canvasRef = useRef();
  const drawingRef = useRef(false);
  const lastPtRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e) => {
    drawingRef.current = true;
    lastPtRef.current = getPos(e);
    e.target.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const pt = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;
    setEmpty(false);
  };
  const onPointerUp = () => { drawingRef.current = false; };

  const clearDraw = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  };

  const insertFromDraw = () => {
    const trimmed = trimCanvas(canvasRef.current);
    if (!trimmed) return;
    onInsert(trimmed.toDataURL("image/png"), trimmed.width / trimmed.height);
  };

  const insertFromType = () => {
    const text = typedText.trim();
    if (!text) return;
    const font = FONTS.find((f) => f.key === fontKey);
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 220;
    const ctx = canvas.getContext("2d");
    ctx.font = `72px ${font.family}`;
    ctx.fillStyle = "#111827";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 20, canvas.height / 2);
    const trimmed = trimCanvas(canvas);
    if (!trimmed) return;
    onInsert(trimmed.toDataURL("image/png"), trimmed.width / trimmed.height);
  };

  return (
    <div className="sig-modal-overlay" onClick={onCancel}>
      <div className="sig-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sig-modal-header">
          <h3>Add signature</h3>
          <button className="btn-ghost" onClick={onCancel}>✕</button>
        </div>

        <div className="sig-modal-tabs">
          <button className={tab === "draw" ? "active" : ""} onClick={() => setTab("draw")}>Draw</button>
          <button className={tab === "type" ? "active" : ""} onClick={() => setTab("type")}>Type</button>
        </div>

        {tab === "draw" ? (
          <div>
            <canvas
              ref={canvasRef}
              width={640}
              height={200}
              className="sig-draw-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              style={{ touchAction: "none" }}
            />
            <div className="sig-modal-actions">
              <button className="btn-ghost" onClick={clearDraw}>Clear</button>
              <button className="btn-success" disabled={empty} onClick={insertFromDraw}>Insert</button>
            </div>
          </div>
        ) : (
          <div>
            <input
              type="text"
              placeholder="Type your name"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              style={{ width: "100%", marginBottom: 12 }}
              autoFocus
            />
            <div className="sig-font-picker">
              {FONTS.map((f) => (
                <button
                  key={f.key}
                  className={fontKey === f.key ? "active" : ""}
                  style={{ fontFamily: f.family, fontSize: 22 }}
                  onClick={() => setFontKey(f.key)}
                >
                  {typedText.trim() || "Signature"}
                </button>
              ))}
            </div>
            <div className="sig-modal-actions">
              <button className="btn-ghost" onClick={onCancel}>Cancel</button>
              <button className="btn-success" disabled={!typedText.trim()} onClick={insertFromType}>Insert</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
