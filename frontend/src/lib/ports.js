// Read the shipping line and port of loading out of a terminal / delivery name,
// e.g. "SALLAUM – BALTIMORE (SOUTH LOCUST POINT)" → { line: "SALLAUM", pol: "BALTIMORE" },
//      "ACL – JACKSONVILLE (HORIZON)"            → { line: "ACL",     pol: "JACKSONVILLE" }.
// Either part is "" when the text doesn't say. `city` (the terminal's address city)
// is used for the port when the name doesn't name one.

export function lineFromText(text) {
  const u = String(text || "").toUpperCase();
  if (/SALLAUM/.test(u)) return "SALLAUM";
  if (/\bACL\b|GRIMALDI|ATLANTIC CONTAINER/.test(u)) return "ACL";
  return "";
}

export function polFromText(text) {
  const u = String(text || "").toUpperCase();
  if (/PROVIDENCE|DAVISVILLE|QUONSET/.test(u)) return "PROVIDENCE";
  if (/BALTIMORE|LOCUST|TRADEPOINT|DUNDALK|SPARROWS/.test(u)) return "BALTIMORE";
  if (/JACKSONVILLE|\bJAX\b|BLOUNT|TALLEYRAND|DAMES POINT/.test(u)) return "JACKSONVILLE";
  if (/FREEPORT/.test(u)) return "FREEPORT";
  if (/WILMINGTON/.test(u)) return "WILMINGTON";
  if (/BRUNSWICK/.test(u)) return "BRUNSWICK";
  if (/NEWARK|PORT ELIZABETH|BAYONNE/.test(u)) return "NEWARK";
  if (/SAVANNAH/.test(u)) return "SAVANNAH";
  if (/HOUSTON/.test(u)) return "HOUSTON";
  if (/LONG BEACH/.test(u)) return "LONG BEACH";
  if (/NEW YORK/.test(u)) return "NEW YORK";
  return "";
}

export function portLineFromDelivery(name, city = "") {
  return { line: lineFromText(name), pol: polFromText(name) || polFromText(city) };
}
