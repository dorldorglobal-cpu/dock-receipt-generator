#!/usr/bin/env python3
"""
Buyer Receipt PDF Parser — pdfplumber edition
Handles: Copart Sales Receipt/Bill of Sale
         IAA (Insurance Auto Auctions) Receipt

Copart layout (3 columns):
  LEFT  : Member name + foreign consignee address
  MIDDLE: Physical Address of Lot (pickup)
  RIGHT : Seller info (ignored)

IAA layout: single-column with labeled fields
"""

import sys, json, re

# ── Helpers ───────────────────────────────────────────────────────────────────

COUNTRY_MAP = {
    'GH': 'GHANA',        'NG': 'NIGERIA',      'BJ': 'BENIN',
    'TG': 'TOGO',         'SN': 'SENEGAL',      'CI': 'IVORY COAST',
    'SL': 'SIERRA LEONE', 'LR': 'LIBERIA',      'GM': 'GAMBIA',
    'GN': 'GUINEA',       'CM': 'CAMEROON',     'AO': 'ANGOLA',
    'ML': 'MALI',         'BF': 'BURKINA FASO', 'NE': 'NIGER',
    'ZA': 'SOUTH AFRICA', 'MA': 'MOROCCO',
}

US_STATES = {
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
    'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
    'TX','UT','VT','VA','WA','WV','WI','WY',
}

COLORS = ['BLACK','WHITE','BLUE','RED','SILVER','GRAY','GREY','GREEN','BROWN',
          'GOLD','ORANGE','YELLOW','PURPLE','BEIGE','MAROON','BURGUNDY','TAN',
          'CREAM','PINK','TEAL','CHAMPAGNE','COPPER','CHARCOAL']

US_SUFFIX_RE = re.compile(
    r'\b(STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|ROAD|RD|DRIVE|DR|LANE|LN|'
    r'WAY|HIGHWAY|HWY|COURT|CT|ROUTE|RT|PLACE|PL|CIRCLE|CIR)\b', re.I)

def clean(s):
    return ' '.join((s or '').split()).strip()

def is_us_state(code):
    return (code or '').upper() in US_STATES

def find_vin(text):
    m = re.search(r'\b([A-HJ-NPR-Z0-9]{17})\b', text)
    return m.group(1) if m else ''

def group_rows(words, y_tol=5):
    """Group pdfplumber word dicts into text rows."""
    if not words:
        return []
    rows, cur, cur_y = [], [], words[0]['top']
    for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
        if abs(w['top'] - cur_y) <= y_tol:
            cur.append(w)
        else:
            if cur:
                rows.append(' '.join(x['text'] for x in sorted(cur, key=lambda x: x['x0'])))
            cur, cur_y = [w], w['top']
    if cur:
        rows.append(' '.join(x['text'] for x in sorted(cur, key=lambda x: x['x0'])))
    return rows

def try_parse_city_state_zip(line):
    """Parse 'CITY, ST 12345' or 'CITYST12345' → (city, state, zip) or None."""
    line = line.strip()
    # Standard spaced
    m = re.match(r'^(.*?),?\s+([A-Z]{2})\s+(\d{5})\s*$', line, re.I)
    if m and is_us_state(m.group(2)):
        return m.group(1).strip().upper(), m.group(2).upper(), m.group(3)
    # Concatenated: CITYST12345
    m2 = re.match(r'^([A-Z][A-Z\s]{1,25}?)([A-Z]{2})(\d{5})$', line, re.I)
    if m2 and is_us_state(m2.group(2)):
        return m2.group(1).strip().upper(), m2.group(2).upper(), m2.group(3)
    return None

def extract_vehicle(veh_text):
    """Extract year/make/model/color from VEHICLE: line text."""
    year = make = model = color = ''
    color_found = next((c for c in COLORS if c in veh_text.upper()), '')
    color_idx = veh_text.upper().rfind(color_found) if color_found else len(veh_text)
    before = veh_text[:color_idx].strip()
    ym = re.match(r'^(\d{4})\s+([A-Z0-9\-]+)\s+(.+)$', before, re.I)
    if ym:
        year  = ym.group(1)
        make  = ym.group(2).upper()
        model = clean(ym.group(3))
        color = color_found
    return year, make, model, color


# ── Copart parser ─────────────────────────────────────────────────────────────
# Uses text anchors rather than x-coordinate column splitting,
# because column boundaries vary across Copart PDF variants.
#
# Copart text order (after pdfplumber plain-text extraction):
#   MEMBER: 322714 PHYSICAL
#   ADDRESS OF LOT: SELLER:
#   KAISER CARS                ← customer name (first non-junk line after headers)
#   GA-574-5038, ...           ← foreign address lines
#   NORTH LEGON ACCRA, GH      ← city + country code (last foreign line)
#   ** 304 NJ ROUTE 68         ← lot address starts here (** prefix or plain US street)
#   JOBSTOWN NJ 08041
#   A Z GLOBAL / SOLD THROUGH COPART ...  ← seller (ignored)

def parse_copart(page):
    full_text = page.extract_text() or ''
    lines = [l.strip() for l in full_text.split('\n') if l.strip()]

    # ── VIN ──────────────────────────────────────────────────────────────────
    vin = find_vin(full_text)

    # ── Vehicle ───────────────────────────────────────────────────────────────
    year = make = model = color = ''
    veh_m = re.search(r'VEHICLE:\s*(.+?)(?:Phy Yard|Phy:|Keys?:|Sale Yard|Row:|Item#|$)',
                      full_text, re.I | re.M)
    if veh_m:
        year, make, model, color = extract_vehicle(veh_m.group(1).strip())

    # ── Lot + value ───────────────────────────────────────────────────────────
    lot_m   = re.search(r'LOT[#:\s]+(\d{5,12})', full_text, re.I)
    price_m = re.search(r'Sale\s+Price\s+\$?([\d,]+\.?\d*)', full_text, re.I)
    lot_number = lot_m.group(1) if lot_m else ''
    value      = price_m.group(1).replace(',', '') if price_m else ''

    # ── Locate anchor lines ───────────────────────────────────────────────────
    # Header lines to skip when looking for customer name
    HEADER_PAT = re.compile(
        r'^MEMBER:\s*\d+|^ADDRESS\s+OF\s+LOT|^SELLER:|^PHYSICAL\s+ADDRESS|'
        r'^Ramp\s+Weight|^Max\.\s+(Width|Height)|^Page\s+\d|^Sales\s+Receipt|'
        r'^Bill\s+of\s+Sale|^PHYSICAL$|^LOT[#:]|^VEHICLE:|^VIN:|^Charges',
        re.I)

    # Member header: "MEMBER: 322714 PHYSICAL" or "MEMBER: 322714"
    member_idx = next((i for i, l in enumerate(lines)
                       if re.search(r'MEMBER:\s*\d+', l, re.I)), -1)

    # Lot address marker: line starting with "**" digits or plain US street
    # after the member block
    search_start = member_idx + 1 if member_idx >= 0 else 0
    lot_addr_idx = -1
    for i in range(search_start, len(lines)):
        l = lines[i]
        if re.match(r'^\*+\s*\d', l):          # "** 304 NJ ROUTE 68"
            lot_addr_idx = i; break
        if (re.match(r'^\d{1,5}\s+[A-Z]', l) and
                US_SUFFIX_RE.search(l) and
                i > search_start + 1):          # plain street after customer block
            lot_addr_idx = i; break

    # ── Customer name + consignee address ─────────────────────────────────────
    customer_name = consignee_address = consignee_city = consignee_country = ''

    scan_end = lot_addr_idx if lot_addr_idx >= 0 else min(search_start + 12, len(lines))
    candidate_lines = []
    for i in range(search_start, scan_end):
        l = lines[i]
        if HEADER_PAT.search(l):
            continue
        if len(l) < 2:
            continue
        candidate_lines.append(l)

    if candidate_lines:
        customer_name = candidate_lines[0].strip()
        foreign = candidate_lines[1:]
        if foreign:
            last = foreign[-1]
            cc_m = re.search(r',?\s*([A-Z]{2})\s*$', last)
            if cc_m and cc_m.group(1) in COUNTRY_MAP:
                consignee_country = COUNTRY_MAP[cc_m.group(1)]
                consignee_city    = re.sub(r',?\s*[A-Z]{2}\s*$', '', last).strip().upper()
                consignee_address = ', '.join(l.strip().upper() for l in foreign[:-1])
            else:
                consignee_address = ', '.join(l.strip().upper() for l in foreign)

    # ── Pickup address (lot address block) ────────────────────────────────────
    pickup_address = pickup_city = pickup_state = pickup_zip = ''
    pickup_name = 'COPART'

    if lot_addr_idx >= 0:
        # Strip leading asterisks from lot address line
        raw_addr = re.sub(r'^\*+\s*', '', lines[lot_addr_idx]).strip()
        if US_SUFFIX_RE.search(raw_addr) or re.match(r'^\d{1,5}\s+[A-Z]', raw_addr, re.I):
            pickup_address = raw_addr.upper()
        # Scan next few lines for city/state/zip
        for j in range(lot_addr_idx + 1, min(lot_addr_idx + 5, len(lines))):
            l = lines[j].strip()
            if re.match(r'^\*+', l): continue   # skip "**This is a sub lot"
            parsed = try_parse_city_state_zip(l)
            if parsed:
                pickup_city, pickup_state, pickup_zip = parsed
                break

    if pickup_city:
        pickup_name = f'COPART {pickup_city} {pickup_state}'.strip()

    # ── Phone / email ─────────────────────────────────────────────────────────
    phone_m = re.search(r'(?:Phone|Tel|Cell)[:\s]*([\d()\s\-+]{7,20})', full_text, re.I)
    email_m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', full_text)

    return {
        'source':           'COPART',
        'customerName':     clean(customer_name),
        'customerPhone':    clean(phone_m.group(1)) if phone_m else '',
        'customerEmail':    email_m.group(0) if email_m else '',
        'vin':              vin,
        'year':             year,
        'make':             make,
        'model':            model,
        'color':            color,
        'value':            value,
        'lotNumber':        lot_number,
        'pickupName':       pickup_name,
        'pickupLocation':   pickup_name,
        'pickupAddress':    pickup_address,
        'pickupCity':       pickup_city,
        'pickupState':      pickup_state,
        'pickupZip':        pickup_zip,
        'consigneeName':    clean(customer_name),
        'consigneeAddress': consignee_address,
        'consigneeCity':    consignee_city,
        'consigneeCountry': consignee_country,
    }


# ── IAA parser ────────────────────────────────────────────────────────────────

def parse_iaa(text, lines):
    vin = find_vin(text)

    # Customer name
    customer_name = ''
    buyer_m = re.search(
        r'Buyer\s+Name\s+([A-Z][A-Z0-9 &.,\-\']{2,80}?)(?:\r?\n|Dealer|Resale|Receipt)',
        text, re.I)
    if buyer_m:
        customer_name = clean(buyer_m.group(1))
    if not customer_name:
        inv_idx = next((i for i, l in enumerate(lines)
                        if re.search(r'Invoice\s+To:', l, re.I)), -1)
        if inv_idx >= 0:
            for l in lines[inv_idx + 1: inv_idx + 6]:
                if re.search(r'Description|Charges|Payments|Balance|Bid Amount|\$\d', l, re.I):
                    continue
                if len(l.strip()) < 3:
                    continue
                customer_name = clean(l)
                break

    # Pickup
    pickup_address = pickup_city = pickup_state = pickup_zip = pickup_name = ''
    usppi = next((l for l in lines if re.search(r'Sold\s+At\s+\(USPPI\)', l, re.I)), None)
    if usppi:
        content = re.sub(r'^Sold\s+At\s+\(USPPI\)\s*:\s*', '', usppi, flags=re.I).strip()
        m = re.search(r'(\d{1,5}\s+[^,]+?),\s*([^,]+?),\s*([A-Z]{2})\s*,?\s*(\d{5})',
                      content, re.I)
        if m:
            pickup_address = m.group(1).strip().upper()
            pickup_city    = m.group(2).strip().upper()
            pickup_state   = m.group(3).upper()
            pickup_zip     = m.group(4)
            branch_m = re.search(r'^\d+\s*-\s*(.+?)\s+\d{1,5}\s+', content)
            pickup_name = (f'IAAI {branch_m.group(1).strip().upper()}' if branch_m
                           else f'IAAI {pickup_city} {pickup_state}')

    if not pickup_city:
        pu_idx = next((i for i, l in enumerate(lines)
                       if re.search(r'Pick[-\s]*Up\s+Location', l, re.I)), -1)
        if pu_idx >= 0:
            block = [l for l in lines[pu_idx + 1: pu_idx + 8]
                     if not re.search(
                         r'\(\d{3}\)|Sale\s+Date|\d{1,2}/\d{1,2}/\d{4}|StockNo|Year\s+Make',
                         l, re.I)][:4]
            if len(block) >= 2:
                pickup_address = block[1].strip().upper()
            if len(block) >= 3:
                csz = re.match(r'^(.+?)\s+(\w+(?:\s+\w+)?)\s+(\d{5})\s*$',
                                block[2].strip(), re.I)
                if csz:
                    pickup_city  = csz.group(1).strip().upper()
                    pickup_state = csz.group(2).strip().upper()[:2]
                    pickup_zip   = csz.group(3)
            pickup_name = f'IAAI {block[0].strip().upper()}' if block else 'IAAI'

    # Vehicle (search backwards from VIN)
    year = make = model = ''
    if vin:
        vin_idx = text.find(vin)
        if vin_idx > 0:
            before = text[max(0, vin_idx - 300): vin_idx]
            COLORS_PAT = 'White|Black|Silver|Grey|Gray|Blue|Red|Green|Gold|Brown|Beige|Yellow|Orange|Purple|Pink|Maroon|Tan|Cream|Burgundy'
            wc = re.search(
                rf'\b(\d{{4}})\s+([A-Z]{{2,}})\s+([A-Z0-9][A-Z0-9 \-]*?)\s+'
                rf'(?:{COLORS_PAT})\s+[\d,]+\s*$', before, re.I)
            if wc:
                year = wc.group(1); make = wc.group(2).upper()
                model = wc.group(3).strip().upper()
            else:
                nc = re.search(
                    r'\b(\d{4})\s+([A-Z]{2,})\s+([A-Z0-9][A-Z0-9 \-]*?)\s+[\d,]+\s*$',
                    before, re.I)
                if nc:
                    year = nc.group(1); make = nc.group(2).upper()
                    model = nc.group(3).strip().upper()

    lot_m   = re.search(r'\b000-(\d{8})', text)
    phone_m = re.search(r'(?:Phone|Tel|Cell)[:\s]*([\d()\s\-+]{7,20})', text, re.I)
    email_m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', text)

    return {
        'source':           'IAA',
        'customerName':     clean(customer_name),
        'customerPhone':    clean(phone_m.group(1)) if phone_m else '',
        'customerEmail':    email_m.group(0) if email_m else '',
        'vin':              vin,
        'year':             year,
        'make':             make,
        'model':            model,
        'color':            '',
        'value':            '',
        'lotNumber':        lot_m.group(1) if lot_m else '',
        'pickupName':       pickup_name,
        'pickupLocation':   pickup_name,
        'pickupAddress':    pickup_address,
        'pickupCity':       pickup_city,
        'pickupState':      pickup_state,
        'pickupZip':        pickup_zip,
        'consigneeName':    '',
        'consigneeAddress': '',
        'consigneeCity':    '',
        'consigneeCountry': '',
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def parse_buyer_receipt(path):
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        if not pdf.pages:
            raise ValueError('Empty PDF')
        page  = pdf.pages[0]
        text  = page.extract_text() or ''
        lines = [l.strip() for l in text.split('\n') if l.strip()]

        is_iaa = bool(
            re.search(r'insurance\s+auto\s+auction', text, re.I) or
            re.search(r'\biaa\s*doc\b', text, re.I) or
            re.search(r'Sold\s+At\s+Branch', text, re.I) or
            re.search(r'Sold\s+At\s+\(USPPI\)', text, re.I)
        )

        return parse_iaa(text, lines) if is_iaa else parse_copart(page)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: parse_buyer_receipt.py <pdf_path>'}))
        sys.exit(1)
    try:
        result = parse_buyer_receipt(sys.argv[1])
        print(json.dumps(result))
    except ImportError:
        print(json.dumps({'error': 'pdfplumber not installed'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
