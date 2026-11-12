"""
Redact a bank payment proof (Metropolitan Commercial Bank "Operation Proof") so a
vendor only sees their own payment.

usage: python redact_proof.py <in.pdf> <out.pdf> "<PAYEE 1>|<PAYEE 2>"

Each payment in the proof is a block of label/value lines starting at "Payee Name"
(Payee Name, Account Number, Amount, Destination Bank Name, Routing Number, Addenda),
and a block can run over a page break. Every block whose payee is NOT one of the
kept names is blacked out line by line, as are the batch "Total Amount" and our own
"Offset Account". The text under each box is removed (true redaction, not just
covered), so it can't be copied back out. Prints a JSON summary.
"""
import json, re, sys
import pymupdf

LABELS = ("Payee Name", "Account Number", "Amount", "Destination Bank Name", "Routing Number", "Addenda")
HEADER_SECRETS = ("Total Amount", "Offset Account", "Total Payments")
SKIP = ("Operation Proof", "Processed by computer", "Metropolitan Commercial Bank", "Park Ave", "mcbankny.com")

def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())

def lines_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            text = " ".join(s["text"] for s in l["spans"]).strip()
            if text:
                out.append((pymupdf.Rect(l["bbox"]), text))
    # Merge spans on the same row (label and value are separate lines in the dict)
    rows = []
    for rect, text in sorted(out, key=lambda x: (round(x[0].y0), x[0].x0)):
        if rows and abs(rows[-1][0].y0 - rect.y0) < 3:
            rows[-1] = (rows[-1][0] | rect, rows[-1][1] + " " + text)
        else:
            rows.append((rect, text))
    return rows

def main():
    src, dst, keep_arg = sys.argv[1], sys.argv[2], sys.argv[3]
    keep = [norm(k) for k in keep_arg.split("|") if norm(k)]
    doc = pymupdf.open(src)
    blocks, cur = [], None          # each block: {"payee": str, "rows": [(page_no, rect)]}
    secrets = []                    # (page_no, rect) for header values we never show
    other_rows = {}                 # page_no -> count of rows that aren't part of any payee block
    for pno, page in enumerate(doc):
        other_rows[pno] = 0
        for rect, text in lines_of(page):
            if any(s in text for s in SKIP):
                continue
            if text.startswith(HEADER_SECRETS):
                secrets.append((pno, rect))
                continue
            if text.startswith("Payee Name"):
                cur = {"payee": text[len("Payee Name"):].strip(), "rows": []}
                blocks.append(cur)
            if cur is not None and text.startswith(LABELS):
                cur["rows"].append((pno, rect))
            else:
                other_rows[pno] += 1
    kept, redacted = [], []
    for b in blocks:
        p = norm(b["payee"])
        is_kept = any(p == k or p.startswith(k) or k.startswith(p) for k in keep)
        (kept if is_kept else redacted).append(b["payee"])
        if not is_kept:
            for pno, rect in b["rows"]:
                page = doc[pno]
                # the whole row, label and value, across the content width
                doc[pno].add_redact_annot(pymupdf.Rect(40, rect.y0 - 2, page.rect.width - 40, rect.y1 + 2), fill=(0, 0, 0))
    for pno, rect in secrets:
        page = doc[pno]
        doc[pno].add_redact_annot(pymupdf.Rect(40, rect.y0 - 2, page.rect.width - 40, rect.y1 + 2), fill=(0, 0, 0))
    for page in doc:
        page.apply_redactions()
    # Drop pages that held nothing but other payees' payments (they'd be solid black)
    kept_pages = {pno for b in blocks if b["payee"] in kept for pno, _ in b["rows"]}
    drop = [pno for pno in range(len(doc)) if pno not in kept_pages and other_rows.get(pno, 0) == 0
            and any(pno == p for b in blocks for p, _ in b["rows"])]
    for pno in reversed(drop):
        doc.delete_page(pno)
    doc.save(dst, garbage=4, deflate=True)
    print(json.dumps({"blocks": len(blocks), "kept": kept, "redacted": len(redacted),
                      "headerHidden": len(secrets), "pagesDropped": len(drop), "pages": len(doc)}))

if __name__ == "__main__":
    main()
