#!/usr/bin/env python3
"""
Sallaum Lines RoRo Schedule PDF Parser — pdfplumber edition
Locked rules:
  POL order: Freeport, Jacksonville, Tradepoint(SKIP), South Locus=BALTIMORE,
             Brunswick(SKIP), NORAD Davisville=PROVIDENCE
  POD order: Cotonou, Lome, Lagos, Durban(SKIP)
Dates: positional pairs (cutoff, sail) per vessel in POL rows;
       single arrival per vessel in POD rows.
"""

import sys, json, re
from collections import defaultdict
from datetime import date

# ── Port rules ────────────────────────────────────────────────────────────────

POL_MAP = [
    (re.compile(r'freeport',          re.I), 'FREEPORT'),
    (re.compile(r'jacksonville',      re.I), 'JACKSONVILLE'),
    (re.compile(r'tradepoint',        re.I), None),           # SKIP
    (re.compile(r'south|locus',       re.I), 'BALTIMORE'),
    (re.compile(r'brunswick',         re.I), None),           # SKIP
    (re.compile(r'norad|davisville',  re.I), 'PROVIDENCE'),
]

POD_MAP = [
    (re.compile(r'cotonou',      re.I), 'COTONOU'),
    (re.compile(r'lome|lomé', re.I), 'LOME'),
    (re.compile(r'lagos',        re.I), 'LAGOS'),
    (re.compile(r'durban',       re.I), None),                # SKIP
]

def identify_pol(text):
    for pat, port in POL_MAP:
        if pat.search(text):
            return port   # None = explicit skip
    return 'UNKNOWN'

def identify_pod(text):
    for pat, port in POD_MAP:
        if pat.search(text):
            return port
    return 'UNKNOWN'

# ── Date helpers ──────────────────────────────────────────────────────────────

MONTH = {'jan':'1','feb':'2','mar':'3','apr':'4','may':'5','jun':'6',
          'jul':'7','aug':'8','sep':'9','oct':'10','nov':'11','dec':'12'}

def parse_date(s):
    """20-Apr  →  4/20/<year>, inferring rollover near year boundaries
    (e.g. a schedule parsed in December for a January sailing is next year)."""
    if not s or s.upper() == 'N/A':
        return ''
    m = re.match(r'^(\d{1,2})-([A-Za-z]{3})', s.strip())
    if m:
        mon = MONTH.get(m.group(2).lower(), '')
        if not mon:
            return s.strip()
        today = date.today()
        year = today.year + 1 if int(mon) < today.month - 6 else today.year
        return f"{mon}/{m.group(1)}/{year}"
    return s.strip()

def is_date_token(s):
    return bool(re.match(r'^\d{1,2}-[A-Za-z]{3}$', s.strip())) or s.strip().upper() == 'N/A'

def cx(word):
    return (word['x0'] + word['x1']) / 2.0

def group_rows(words, y_tol=5):
    if not words:
        return []
    rows, cur, cur_y = [], [], words[0]['top']
    for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
        if abs(w['top'] - cur_y) <= y_tol:
            cur.append(w)
        else:
            if cur:
                rows.append(sorted(cur, key=lambda w: w['x0']))
            cur, cur_y = [w], w['top']
    if cur:
        rows.append(sorted(cur, key=lambda w: w['x0']))
    return rows

# ── Main ──────────────────────────────────────────────────────────────────────

VOYAGE_RE = re.compile(r'^2[0-9][A-Z]{2,3}\d{1,3}[A-Z]?$')
SKIP_NAME  = re.compile(r'^\d+(\.\d+)?\s*(MT|m)$', re.I)

def parse_sallaum_pdf(path):
    import pdfplumber

    schedule_rows = []

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=3, y_tolerance=3)
            if not words:
                continue

            text_rows = group_rows(words, y_tol=5)

            # ── Find voyage code row ─────────────────────────────────────────
            voyage_row_idx, voyage_codes = -1, []
            for i, row in enumerate(text_rows):
                codes = [w for w in row if VOYAGE_RE.match(w['text'])]
                if len(codes) >= 3:
                    voyage_row_idx, voyage_codes = i, codes
                    break
            if voyage_row_idx == -1:
                continue

            num_vessels  = len(voyage_codes)
            voyage_texts = [w['text'].upper() for w in voyage_codes]
            voyage_xs    = [cx(w) for w in voyage_codes]

            # Column x-bands (midpoints between adjacent voyage code centers)
            col_bands = []
            for v in range(num_vessels):
                left  = (voyage_xs[v] + voyage_xs[v-1]) / 2 if v > 0           else voyage_xs[v] - 200
                right = (voyage_xs[v] + voyage_xs[v+1]) / 2 if v < num_vessels-1 else voyage_xs[v] + 200
                col_bands.append((left, right))

            # ── Vessel names (row(s) above voyage codes) ─────────────────────
            vessel_names = list(voyage_texts)   # fallback = voyage code
            for above in range(1, 4):
                if voyage_row_idx - above < 0:
                    break
                name_row = text_rows[voyage_row_idx - above]
                name_words = [w for w in name_row
                              if re.match(r'^[A-Z][A-Za-z]', w['text'])
                              and len(w['text']) > 2
                              and not VOYAGE_RE.match(w['text'])
                              and not SKIP_NAME.match(w['text'])]
                if not name_words:
                    continue
                col_tokens = defaultdict(list)
                for nw in name_words:
                    x = cx(nw)
                    for v, (left, right) in enumerate(col_bands):
                        if left <= x < right:
                            col_tokens[v].append(nw['text'])
                            break
                if col_tokens:
                    for v, tokens in col_tokens.items():
                        vessel_names[v] = ' '.join(tokens).upper()
                    break

            print(f"[Sallaum] voyages: {voyage_texts}", file=sys.stderr)
            print(f"[Sallaum] vessels: {vessel_names}", file=sys.stderr)

            # ── Parse POL / POD sections ──────────────────────────────────────
            pol_data = {}   # pol -> {voyage -> {cutoff, sail}}
            pod_data = {}   # pod -> {voyage -> arrival}
            mode = None

            for ri in range(voyage_row_idx + 1, len(text_rows)):
                row      = text_rows[ri]
                row_text = ' '.join(w['text'] for w in row)
                first    = row[0]['text'] if row else ''

                if re.match(r'^POL$', first, re.I) and re.search(r'cut.?off', row_text, re.I):
                    mode = 'POL'; continue
                if re.match(r'^POD$', first, re.I):
                    mode = 'POD'; continue
                if re.search(r'please\s+note', row_text, re.I):
                    break
                if not mode:
                    continue

                date_words = [w for w in row if is_date_token(w['text'])]

                if mode == 'POL':
                    pol = identify_pol(row_text)
                    if pol is None:    continue   # explicit skip
                    if pol == 'UNKNOWN': continue
                    pol_data.setdefault(pol, {})
                    for v in range(num_vessels):
                        # Assign dates by x-position within this vessel's column band
                        # (same banding used for vessel names above) rather than by list
                        # index — a single missing/blank date on any earlier vessel would
                        # otherwise shift every subsequent vessel's dates by one.
                        left, right = col_bands[v]
                        col_dates = sorted(
                            (w for w in date_words if left <= cx(w) < right),
                            key=lambda w: w['x0']
                        )
                        ci = col_dates[0] if len(col_dates) > 0 else None
                        si = col_dates[1] if len(col_dates) > 1 else None
                        cutoff = parse_date(ci['text']) if ci else ''
                        sail   = parse_date(si['text']) if si else ''
                        code   = voyage_texts[v]
                        if code not in pol_data[pol]:
                            pol_data[pol][code] = {'cutoff': cutoff, 'sail': sail}
                        else:
                            if cutoff: pol_data[pol][code]['cutoff'] = cutoff
                            if sail:   pol_data[pol][code]['sail']   = sail

                elif mode == 'POD':
                    pod = identify_pod(row_text)
                    if pod is None:    continue
                    if pod == 'UNKNOWN': continue
                    pod_data.setdefault(pod, {})
                    for v in range(num_vessels):
                        left, right = col_bands[v]
                        col_dates = sorted(
                            (w for w in date_words if left <= cx(w) < right),
                            key=lambda w: w['x0']
                        )
                        item = col_dates[0] if col_dates else None
                        if item and item['text'].upper() != 'N/A':
                            pod_data[pod][voyage_texts[v]] = parse_date(item['text'])

            print(f"[Sallaum] POLs: {list(pol_data.keys())}", file=sys.stderr)
            print(f"[Sallaum] PODs: {list(pod_data.keys())}", file=sys.stderr)

            # ── Build rows ────────────────────────────────────────────────────
            for v in range(num_vessels):
                voyage = voyage_texts[v]
                vessel = vessel_names[v]
                for pol, voy_map in pol_data.items():
                    pair = voy_map.get(voyage, {})
                    if not pair.get('cutoff') and not pair.get('sail'):
                        continue
                    for pod, pod_voy_map in pod_data.items():
                        arrival = pod_voy_map.get(voyage, '')
                        if not arrival:
                            continue
                        schedule_rows.append({
                            'carrier':     'SALLAUM',
                            'vessel':      vessel,
                            'voyage':      voyage,
                            'pol':         pol,
                            'pod':         pod,
                            'cutoffDate':  pair.get('cutoff', ''),
                            'sailDate':    pair.get('sail', ''),
                            'arrivalDate': arrival,
                        })

    return {'scheduleRows': schedule_rows, 'rowCount': len(schedule_rows)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: parse_sallaum_pdf.py <pdf_path>'}))
        sys.exit(1)
    try:
        result = parse_sallaum_pdf(sys.argv[1])
        print(json.dumps(result))
    except ImportError:
        print(json.dumps({'error': 'pdfplumber not installed — run: pip install pdfplumber'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
