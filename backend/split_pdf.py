#!/usr/bin/env python3
"""
split_pdf.py  <input_pdf>  <start_page>  <end_page>  <output_pdf>
Pages are 0-indexed, end_page is inclusive.
Handles encrypted PDFs (tries empty password automatically).
"""
import sys
import subprocess

# Auto-install pypdf if not present (happens on fresh Render deploys)
try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--quiet", "pypdf"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    from pypdf import PdfReader, PdfWriter


def main():
    if len(sys.argv) != 5:
        print("Usage: split_pdf.py <input> <start> <end> <output>", file=sys.stderr)
        sys.exit(1)

    input_path  = sys.argv[1]
    start_page  = int(sys.argv[2])
    end_page    = int(sys.argv[3])
    output_path = sys.argv[4]

    reader = PdfReader(input_path)
    if reader.is_encrypted:
        reader.decrypt("")  # empty password (restriction-only encryption)

    writer = PdfWriter()
    for i in range(start_page, end_page + 1):
        writer.add_page(reader.pages[i])

    with open(output_path, "wb") as f:
        writer.write(f)


if __name__ == "__main__":
    main()
