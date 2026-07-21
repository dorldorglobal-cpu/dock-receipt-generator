#!/usr/bin/env python3
"""
ACL RoRo Schedule PDF Parser
Uses pdfplumber to extract vessel/voyage/port/date data with proper column alignment.

The ACL weekly schedule PDF has this structure per section:
  Row 0: vessel names  → "Grande Dakar  Grande Lagos  Grande Sicilia ..."
  Row 1: voyage codes  → "GDK0626  GLG0326  GSI0526 ..."
  Row 2: POL header    → "POL  ETA  Latest Delivery  ETA  Latest Delivery ..."
  Rows:  POL data      → "Baltimore  6/7  6/1  6/5  5/29  ..."  (ETA=sail, Latest Delivery=cutoff)
  Row:   POD header    → "POD  ETA  ETA  ETA ..."
  Rows:  POD data      → "Lagos  6/23  6/22  6/23  ..."
  (page may have 2 such sections for the following week's sailings)

Column alignment is determined by the x-positions of the voyage-code tokens.
"""

import sys, json, re
from collections import defaultdict
from datetime import date

NA_POLS = {"FREEPORT", "JACKSONVILLE", "BALTIMORE", "WILMINGTON", "PROVIDENCE", "BRUNSWICK"}
WA_PODS = {"LAGOS", "COTONOU", "LOME", "TEMA", "DAKAR"}

# ── helpers ───────────────────────────────────────────────────────────────────

def normalize_port(text):
    u = text.upper()
    if "BALTIMORE"    in u or "LOCUST"     in u or "TRADEPOINT" in u: return "BALTIMORE"
    if "PROVIDENCE"   in u or "DAVISVILLE" in u or "NORAD"      in u: return "PROVIDENCE"
    if "JACKSONVILLE" in u or "JAX"        in u:                       return "JACKSONVILLE"
    if "FREEPORT"     in u:                                            return "FREEPORT"
    if "WILMINGTON"   in u:                                            return "WILMINGTON"
    if "BRUNSWICK"    in u:                                            return "BRUNSWICK"
    if "NEWARK"       in u:                                            return "NEWARK"
    if "LAGOS"        in u:                                            return "LAGOS"
    if "TEMA"         in u:                                            return "TEMA"
    if "COTONOU"      in u:                                            return "COTONOU"
    if "LOME"         in u or "LOMÉ" in u:                       return "LOME"
    if "DAKAR"        in u:                                            return "DAKAR"
    return ""

def is_date(s):
    return bool(re.match(r"^\d{1,2}/\d{1,2}$", s.strip()))

def fmt_date(s):
    """Attach a year to a bare 'M/D' schedule date, inferring rollover near year boundaries
    (e.g. a schedule parsed in December for a January sailing is next year, not this one)."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})$", s.strip())
    if not m:
        return s.strip()
    month = int(m.group(1))
    today = date.today()
    year = today.year + 1 if month < today.month - 6 else today.year
    return f"{m.group(1)}/{m.group(2)}/{year}"

def cx(word):
    """horizontal centre of a pdfplumber word dict"""
    return (word["x0"] + word["x1"]) / 2

def nearest(x, xs):
    if not xs: return 0
    return min(range(len(xs)), key=lambda i: abs(xs[i] - x))

def group_into_rows(words, y_tol=4):
    if not words:
        return []
    rows, cur, cur_y = [], [], words[0]["top"]
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if abs(w["top"] - cur_y) <= y_tol:
            cur.append(w)
        else:
            if cur:
                rows.append(sorted(cur, key=lambda w: w["x0"]))
            cur, cur_y = [w], w["top"]
    if cur:
        rows.append(sorted(cur, key=lambda w: w["x0"]))
    return rows

# ── section parser ────────────────────────────────────────────────────────────

def parse_section(rows):
    """
    rows  : list of word-rows (each row = list of pdfplumber word dicts, sorted left→right)
    returns list of schedule-row dicts
    """
    if not rows:
        return []

    # ── vessels from row 0 ("Grande Dakar  Grande Lagos  ...") ────────────────
    vessels, vessel_xs = [], []
    vrow = rows[0]
    i = 0
    while i < len(vrow):
        if vrow[i]["text"].capitalize() == "Grande" and i + 1 < len(vrow):
            name    = f"GRANDE {vrow[i+1]['text'].upper()}"
            x_ctr   = (vrow[i]["x0"] + vrow[i+1]["x1"]) / 2
            vessels.append(name)
            vessel_xs.append(x_ctr)
            i += 2
        else:
            i += 1

    if not vessels:
        return []

    # ── voyage codes from row 1 ("GDK0626  GLG0326  ...") ────────────────────
    voyages, voyage_xs = [], []
    if len(rows) > 1:
        for w in rows[1]:
            if re.match(r"^[A-Z]{3}\d{4}$", w["text"], re.I):
                voyages.append(w["text"].upper())
                voyage_xs.append(cx(w))

    # Use voyage-code x-positions for column alignment (more precise than name positions)
    if len(voyage_xs) == len(vessels):
        col_xs = voyage_xs
    else:
        col_xs  = vessel_xs
        voyages = [""] * len(vessels)

    # Pad/trim voyages list to match vessel count
    while len(voyages) < len(vessels):
        voyages.append("")
    voyages = voyages[: len(vessels)]

    # ── find POL-header and POD-header row indices ────────────────────────────
    pol_hdr = pod_hdr = None
    for idx, row in enumerate(rows):
        txt = " ".join(w["text"] for w in row).upper()
        if re.match(r"^POL\b", txt) and "ETA" in txt and pol_hdr is None:
            pol_hdr = idx
        elif re.match(r"^POD\b", txt) and "ETA" in txt:
            pod_hdr = idx

    if pol_hdr is None:
        return []

    # ── build ETA / Latest-Delivery column classifier from the POL header ─────
    # (used to distinguish sail-date from cutoff-date in POL data rows)
    hdr_row  = rows[pol_hdr]
    eta_xs_h, cutoff_xs_h = [], []
    for w in hdr_row:
        t = w["text"].upper()
        if t == "ETA":
            eta_xs_h.append(cx(w))
        elif t == "LATEST":
            cutoff_xs_h.append(cx(w))

    def col_type(x):
        best, best_d = "eta", float("inf")
        for ex in eta_xs_h:
            if abs(x - ex) < best_d:
                best, best_d = "eta", abs(x - ex)
        for fx in cutoff_xs_h:
            if abs(x - fx) < best_d:
                best, best_d = "cutoff", abs(x - fx)
        return best

    # ── parse POL data rows ───────────────────────────────────────────────────
    pol_end  = pod_hdr if pod_hdr else len(rows)
    pol_data = {}   # port → {vessel_idx: {"sail": .., "cutoff": ..}}

    min_col_x = min(col_xs) if col_xs else 200

    for row in rows[pol_hdr + 1 : pol_end]:
        if not row:
            continue
        if re.match(r"^(Please|Other|Shaded|Forklift)", row[0]["text"], re.I):
            continue

        # Port name = words to the LEFT of the first data column
        port_text = " ".join(w["text"] for w in row if w["x1"] < min_col_x - 10)
        port = normalize_port(port_text)
        if port not in NA_POLS:
            continue

        # Assign each date to nearest vessel column, then classify eta/cutoff
        vessel_dates = defaultdict(list)   # vi → [(x, date)]
        for w in row:
            if not is_date(w["text"]):
                continue
            x  = cx(w)
            vi = nearest(x, col_xs)
            vessel_dates[vi].append((x, fmt_date(w["text"])))

        pol_data[port] = {}
        for vi, dlist in vessel_dates.items():
            dlist.sort(key=lambda d: d[0])  # left = sail, right = cutoff
            pol_data[port][vi] = {
                "sail":   dlist[0][1] if dlist         else "",
                "cutoff": dlist[1][1] if len(dlist) > 1 else "",
            }

    # ── parse POD data rows ───────────────────────────────────────────────────
    pod_data = {}   # port → {vessel_idx: arrival_date}

    if pod_hdr is not None:
        for row in rows[pod_hdr + 1 :]:
            if not row:
                continue
            if re.match(r"^(Please|Other|Shaded|Forklift)", row[0]["text"], re.I):
                continue

            port_text = " ".join(w["text"] for w in row if w["x1"] < min_col_x - 10)
            port = normalize_port(port_text)
            if port not in WA_PODS:
                continue

            vessel_dates = defaultdict(list)
            for w in row:
                if not is_date(w["text"]):
                    continue
                x  = cx(w)
                vi = nearest(x, col_xs)
                vessel_dates[vi].append(fmt_date(w["text"]))

            pod_data[port] = {vi: dlist[0] for vi, dlist in vessel_dates.items() if dlist}

    # ── build schedule rows ───────────────────────────────────────────────────
    out = []
    for pol, pol_vessels in pol_data.items():
        for vi in range(len(vessels)):
            pi     = pol_vessels.get(vi, {})
            sail   = pi.get("sail",   "")
            cutoff = pi.get("cutoff", "")
            if not sail and not cutoff:
                continue

            for pod, pod_vessels in pod_data.items():
                arrival = pod_vessels.get(vi, "")
                out.append({
                    "carrier":     "ACL",
                    "vessel":      vessels[vi],
                    "voyage":      voyages[vi],
                    "pol":         pol,
                    "pod":         pod,
                    "cutoffDate":  cutoff,
                    "sailDate":    sail,
                    "arrivalDate": arrival,
                })

    return out

# ── top-level PDF parser ──────────────────────────────────────────────────────

def parse_acl_pdf(path):
    import pdfplumber   # imported here so import error is captured below

    all_rows = []

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=3, y_tolerance=3)
            if not words:
                continue

            text_rows = group_into_rows(words, y_tol=4)

            # Each section begins with a row whose first word is "Grande"
            sec_starts = [
                i for i, row in enumerate(text_rows)
                if row and row[0]["text"].capitalize() == "Grande"
            ]

            for si, start in enumerate(sec_starts):
                end = sec_starts[si + 1] if si + 1 < len(sec_starts) else len(text_rows)
                rows = parse_section(text_rows[start:end])
                all_rows.extend(rows)

    return {"scheduleRows": all_rows, "rowCount": len(all_rows)}

# ── entry point ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_acl_pdf.py <pdf_path>"}))
        sys.exit(1)

    try:
        result = parse_acl_pdf(sys.argv[1])
        print(json.dumps(result))
    except ImportError:
        print(json.dumps({"error": "pdfplumber not installed. Run: pip install pdfplumber"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
