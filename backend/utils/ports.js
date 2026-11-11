// Read the shipping line and port of loading out of a terminal / delivery name.
// Mirror of frontend/src/lib/ports.js — keep the two in step.

function lineFromText(text) {
  const u = String(text || "").toUpperCase();
  if (/SALLAUM/.test(u)) return "SALLAUM";
  if (/\bACL\b|GRIMALDI|ATLANTIC CONTAINER/.test(u)) return "ACL";
  return "";
}

function polFromText(text) {
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

module.exports = { lineFromText, polFromText };
