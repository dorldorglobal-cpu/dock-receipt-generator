#!/usr/bin/env python3
"""
highlight_pdf.py <input_pdf> <output_pdf> <vin>
Adds a yellow Highlight annotation to the table row containing the given VIN.
Handles encrypted PDFs with empty-password restriction encryption.
"""
import sys, subprocess

for pkg in ["pdfplumber", "pypdf"]:
    try:
        __import__(pkg)
    except ImportError:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", pkg],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

import pdfplumber
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Highlight
from pypdf.generic import ArrayObject, FloatObject


def main():
    if len(sys.argv) != 4:
        print("Usage: highlight_pdf.py <input> <output> <vin>", file=sys.stderr)
        sys.exit(1)

    input_path, output_path, vin = sys.argv[1], sys.argv[2], sys.argv[3].upper()

    reader = PdfReader(input_path)
    if reader.is_encrypted:
        reader.decrypt("")

    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)

    found = False
    try:
        with pdfplumber.open(input_path, password="") as pdf:
            for page_num, plumb_page in enumerate(pdf.pages):
                words = plumb_page.extract_words(x_tolerance=5, y_tolerance=5)

                # Find the word that contains (or partially contains) the VIN.
                # The VIN may be concatenated with adjacent column values in PDF text.
                vin_word = None
                for w in words:
                    text = w["text"].upper()
                    # Match full VIN or first 12 chars (safe unique prefix)
                    if vin in text or vin[:12] in text:
                        vin_word = w
                        break

                if not vin_word:
                    continue

                found = True
                row_y = vin_word["top"]
                # Collect all words on the same row (within 8pt vertical tolerance)
                row_words = [w for w in words if abs(w["top"] - row_y) <= 8]

                y_top    = min(w["top"]    for w in row_words)
                y_bottom = max(w["bottom"] for w in row_words)
                page_h   = float(plumb_page.height)
                page_w   = float(plumb_page.width)

                # pdfplumber: origin top-left.  PDF: origin bottom-left.
                pdf_y0 = page_h - y_bottom   # bottom of row
                pdf_y1 = page_h - y_top      # top of row
                pad    = 3.0

                x0, x1 = pad, page_w - pad
                ry0, ry1 = pdf_y0 - pad, pdf_y1 + pad

                hl = Highlight(
                    rect=(x0, ry0, x1, ry1),
                    quad_points=ArrayObject([
                        FloatObject(x0),  FloatObject(ry1),   # top-left
                        FloatObject(x1),  FloatObject(ry1),   # top-right
                        FloatObject(x0),  FloatObject(ry0),   # bottom-left
                        FloatObject(x1),  FloatObject(ry0),   # bottom-right
                    ]),
                    highlight_color=(1, 1, 0),
                )
                writer.add_annotation(page_number=page_num, annotation=hl)

    except Exception as e:
        print(f"highlight warning: {e}", file=sys.stderr)

    with open(output_path, "wb") as f:
        writer.write(f)

    if not found:
        print(f"VIN {vin} not found in PDF — unhighlighted copy written", file=sys.stderr)


if __name__ == "__main__":
    main()
