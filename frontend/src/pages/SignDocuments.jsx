import { useState, useRef, useEffect, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import SignatureModal from "./SignDocuments/SignatureModal";
import "./SignDocuments.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const hexToRgb01 = (hex) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#111111");
  if (!m) return rgb(0.07, 0.07, 0.07);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
};

const dataUrlToBytes = (dataUrl) => {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

let uid = 0;
const nextId = () => `a${Date.now()}_${uid++}`;

export default function SignDocuments() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [pageDims, setPageDims] = useState({}); // { [pageNum]: {w,h} at scale 1 (pt) }

  const [annotations, setAnnotations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [sigModalOpen, setSigModalOpen] = useState(false);

  const fileRef = useRef();
  const canvasRef = useRef();
  const containerRef = useRef();
  const originalBytesRef = useRef(null);
  const renderTaskRef = useRef(null);
  const dragStateRef = useRef(null);

  const selected = annotations.find((a) => a.id === selectedId) || null;

  // ── Load PDF ──────────────────────────────────────────
  const handleFile = async (f) => {
    if (!f || !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    setError("");
    setLoading(true);
    setAnnotations([]);
    setSelectedId(null);
    try {
      const buf = await f.arrayBuffer();
      originalBytesRef.current = buf;
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
      const dims = {};
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        dims[p] = { w: vp.width, h: vp.height };
      }
      setPageDims(dims);
      setPdfDoc(doc);
      setNumPages(doc.numPages);
      setPageNum(1);
      setFile(f);
    } catch (e) {
      setError("Could not read that PDF: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };
  const onFileChange = (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = "";
  };

  const reset = () => {
    setFile(null);
    setPdfDoc(null);
    setNumPages(0);
    setAnnotations([]);
    setSelectedId(null);
    setError("");
    originalBytesRef.current = null;
  };

  // ── Render current page ──────────────────────────────
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      const page = await pdfDoc.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      const ctx = canvas.getContext("2d");
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
      }
      const task = page.render({ canvasContext: ctx, viewport, transform });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch (e) {
        if (e?.name !== "RenderingCancelledException") console.error(e);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, scale]);

  // ── Annotation helpers ────────────────────────────────
  const addTextAnnotation = (initialText = "Text") => {
    const id = nextId();
    setAnnotations((prev) => [...prev, {
      id, page: pageNum, type: "text",
      xFrac: 0.32, yFrac: 0.42, widthFrac: 0.32, heightFrac: 0.09,
      text: initialText, fontSize: 16, color: "#111111",
    }]);
    setSelectedId(id);
  };

  const addDateAnnotation = () => {
    addTextAnnotation(new Date().toLocaleDateString("en-US"));
  };

  const insertImageAnnotation = (dataUrl, aspect) => {
    const dims = pageDims[pageNum] || { w: 612, h: 792 };
    const widthFrac = 0.22;
    const heightFrac = (widthFrac * dims.w) / (aspect * dims.h);
    const id = nextId();
    setAnnotations((prev) => [...prev, {
      id, page: pageNum, type: "image",
      xFrac: 0.34, yFrac: 0.78, widthFrac, heightFrac, dataUrl,
    }]);
    setSelectedId(id);
    setSigModalOpen(false);
  };

  const updateAnnotation = (id, patch) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const deleteAnnotation = (id) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Drag / resize ─────────────────────────────────────
  const beginDrag = (e, ann, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    dragStateRef.current = {
      id: ann.id, mode,
      startX: e.clientX, startY: e.clientY,
      rectW: rect.width, rectH: rect.height,
      orig: { xFrac: ann.xFrac, yFrac: ann.yFrac, widthFrac: ann.widthFrac, heightFrac: ann.heightFrac },
    };
    setSelectedId(ann.id);
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };

  const onDragMove = useCallback((e) => {
    const ds = dragStateRef.current;
    if (!ds) return;
    const dxFrac = (e.clientX - ds.startX) / ds.rectW;
    const dyFrac = (e.clientY - ds.startY) / ds.rectH;
    if (ds.mode === "move") {
      let xFrac = ds.orig.xFrac + dxFrac;
      let yFrac = ds.orig.yFrac + dyFrac;
      xFrac = Math.min(Math.max(xFrac, 0), 1 - ds.orig.widthFrac);
      yFrac = Math.min(Math.max(yFrac, 0), 1 - ds.orig.heightFrac);
      updateAnnotation(ds.id, { xFrac, yFrac });
    } else if (ds.mode === "resize") {
      const widthFrac = Math.min(Math.max(ds.orig.widthFrac + dxFrac, 0.04), 1 - ds.orig.xFrac);
      const heightFrac = Math.min(Math.max(ds.orig.heightFrac + dyFrac, 0.02), 1 - ds.orig.yFrac);
      updateAnnotation(ds.id, { widthFrac, heightFrac });
    }
  }, []);

  const onDragEnd = useCallback(() => {
    dragStateRef.current = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
  }, [onDragMove]);

  // Delete key removes selected annotation (unless typing in a textarea)
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        if (document.activeElement?.tagName === "TEXTAREA") return;
        deleteAnnotation(selectedId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  // ── Download signed PDF ───────────────────────────────
  const downloadSigned = async () => {
    if (!originalBytesRef.current) return;
    setSaving(true);
    setError("");
    try {
      const pdfLibDoc = await PDFDocument.load(originalBytesRef.current.slice(0));
      const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfLibDoc.getPages();
      const imageCache = new Map();

      for (const ann of annotations) {
        const page = pages[ann.page - 1];
        if (!page) continue;
        const { width: pw, height: ph } = page.getSize();

        if (ann.type === "text") {
          const lines = (ann.text || "").split("\n");
          const lineHeight = ann.fontSize * 1.25;
          const startY = ph - ann.yFrac * ph - ann.fontSize;
          lines.forEach((line, i) => {
            page.drawText(line, {
              x: ann.xFrac * pw,
              y: startY - i * lineHeight,
              size: ann.fontSize,
              font,
              color: hexToRgb01(ann.color),
            });
          });
        } else if (ann.type === "image") {
          let img = imageCache.get(ann.dataUrl);
          if (!img) {
            img = await pdfLibDoc.embedPng(dataUrlToBytes(ann.dataUrl));
            imageCache.set(ann.dataUrl, img);
          }
          const w = ann.widthFrac * pw;
          const h = ann.heightFrac * ph;
          page.drawImage(img, { x: ann.xFrac * pw, y: ph - ann.yFrac * ph - h, width: w, height: h });
        }
      }

      const outBytes = await pdfLibDoc.save();
      const blob = new Blob([outBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + "-signed.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Failed to save signed PDF: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const dims = pageDims[pageNum];

  return (
    <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 4, fontSize: 22 }}>Sign Documents</h2>
      <p style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 14 }}>
        Upload a PDF, add a signature, text, or a date, then download the signed copy. Everything happens
        in your browser — the file is never uploaded to a server.
      </p>

      {!file && (
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
          <div style={{ fontSize: 40, marginBottom: 12 }}>✍️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
            {loading ? "Loading PDF…" : "Drop a PDF here or click to browse"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Any PDF document</div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={onFileChange} />
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, marginBottom: 8, padding: "10px 16px", background: "#7f1d1d22", border: "1px solid #ef4444", borderRadius: 8, color: "#ef4444", fontSize: 14 }}>
          {error}
        </div>
      )}

      {file && pdfDoc && (
        <div className="sign-doc-editor">
          {/* Toolbar */}
          <div className="sign-toolbar">
            <button className="btn-ghost" onClick={reset}>← New document</button>
            <div className="sign-toolbar-sep" />
            <button onClick={() => addTextAnnotation()}>+ Text</button>
            <button onClick={addDateAnnotation}>+ Date</button>
            <button onClick={() => setSigModalOpen(true)}>✍️ Signature</button>
            <div className="sign-toolbar-sep" />
            <button className="btn-ghost" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>‹</button>
            <span className="sign-page-indicator">Page {pageNum} / {numPages}</span>
            <button className="btn-ghost" disabled={pageNum >= numPages} onClick={() => setPageNum((p) => p + 1)}>›</button>
            <div className="sign-toolbar-sep" />
            <button className="btn-ghost" onClick={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))}>−</button>
            <span className="sign-page-indicator">{Math.round(scale * 100)}%</span>
            <button className="btn-ghost" onClick={() => setScale((s) => Math.min(2.4, +(s + 0.15).toFixed(2)))}>+</button>
            <div style={{ marginLeft: "auto" }}>
              <button className="btn-success" disabled={saving} onClick={downloadSigned}>
                {saving ? "Saving…" : "⬇ Download Signed PDF"}
              </button>
            </div>
          </div>

          <div className="sign-canvas-scroll">
            <div
              className="sign-canvas-wrap"
              ref={containerRef}
              style={dims ? { width: dims.w * scale, height: dims.h * scale } : undefined}
              onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
            >
              <canvas ref={canvasRef} />
              <div className="sign-overlay">
                {annotations.filter((a) => a.page === pageNum).map((ann) => (
                  <div
                    key={ann.id}
                    className={`sign-annotation${selectedId === ann.id ? " sign-annotation--selected" : ""}`}
                    style={{
                      left: `${ann.xFrac * 100}%`,
                      top: `${ann.yFrac * 100}%`,
                      width: `${ann.widthFrac * 100}%`,
                      height: `${ann.heightFrac * 100}%`,
                    }}
                    onPointerDown={() => setSelectedId(ann.id)}
                  >
                    <div className="sign-annotation-handle" onPointerDown={(e) => beginDrag(e, ann, "move")} title="Drag to move">⠿</div>

                    {ann.type === "text" ? (
                      <textarea
                        className="sign-annotation-text"
                        value={ann.text}
                        onChange={(e) => updateAnnotation(ann.id, { text: e.target.value })}
                        style={{ fontSize: ann.fontSize * scale, color: ann.color }}
                      />
                    ) : (
                      <img className="sign-annotation-image" src={ann.dataUrl} alt="signature" draggable={false} />
                    )}

                    {selectedId === ann.id && (
                      <>
                        <div className="sign-annotation-resize" onPointerDown={(e) => beginDrag(e, ann, "resize")} title="Drag to resize" />
                        <div className="sign-annotation-toolbar">
                          {ann.type === "text" && (
                            <>
                              <button title="Smaller" onClick={() => updateAnnotation(ann.id, { fontSize: Math.max(8, ann.fontSize - 2) })}>A−</button>
                              <button title="Larger" onClick={() => updateAnnotation(ann.id, { fontSize: Math.min(72, ann.fontSize + 2) })}>A+</button>
                              <input
                                type="color"
                                value={ann.color}
                                onChange={(e) => updateAnnotation(ann.id, { color: e.target.value })}
                                title="Text color"
                              />
                            </>
                          )}
                          <button title="Delete" onClick={() => deleteAnnotation(ann.id)}>🗑</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {sigModalOpen && (
        <SignatureModal onCancel={() => setSigModalOpen(false)} onInsert={insertImageAnnotation} />
      )}
    </div>
  );
}
