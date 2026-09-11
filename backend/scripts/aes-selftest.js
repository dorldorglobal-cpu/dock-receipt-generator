/**
 * No-DB unit checks for the AES mapping. Run: node backend/scripts/aes-selftest.js
 */
const assert = require("assert");
const { buildWeblinkFiling, applyItn, yymmdd } = require("../utils/aesWeblink");
const aesCodes = require("../utils/aesCodes");

let pass = 0;
const ok = (name, fn) => { try { fn(); console.log("  ✓ " + name); pass++; } catch (e) { console.log("  ✗ " + name + " — " + e.message); process.exitCode = 1; } };

const CONFIG = {
  usppiName: "DOR L DOR GLOBAL LLC", usppiEin: "12-3456789", usppiIdType: "E",
  usppiAddress1: "1 MAIN ST", usppiCity: "NEWARK", usppiState: "NJ", usppiZip: "07101",
  usppiContactFirst: "ELI", usppiContactLast: "LEVY", usppiPhone: "(973) 555-1212",
  filerId: "123456789", srnPrefix: "DDG", responseEmail: "aes@ddg.com",
  defaultFilingOption: "2", defaultFilingType: "1", defaultExportInfoCode: "OS",
  defaultLicenseCode: "C33", defaultLicenseNumber: "NLR", ultConsigneeType: "R",
  relatedParty: "N", hazmat: "N", routedExport: "N", defaultScheduleB: "8703230190",
  aesEnv: "test",
};

const ORDER = {
  _id: "abc123", refNumber: "14204", bookingNumber: "SLSE-262651",
  requestType: "RORO", year: "2018", make: "TOYOTA", model: "CAMRY",
  vehicleYearMakeModel: "2018 TOYOTA CAMRY", vin: "4T1B11HK7JU678515",
  value: "6500", weightKgs: "1802",
  pol: "BALTIMORE", pod: "TEMA", consigneeCountry: "GHANA", shippingLine: "ACL",
  vessel: "ATLANTIC SAIL", sailDate: "2026-09-20", pickupState: "GA",
  consigneeName: "KWAME MOTORS", consigneeAddress: "12 RING RD", consigneeCity: "ACCRA",
  customerPhone: "233201234567", titleNumber: "GA12345678", titleState: "GA",
  aesFiling: { srn: "DDG14204", returnToken: "tok" },
};

console.log("aesCodes");
ok("motFor RORO = 10", () => assert.equal(aesCodes.motFor("RORO"), "10"));
ok("motFor Container = 11", () => assert.equal(aesCodes.motFor("Container"), "11"));
ok("countryIso GHANA = GH", () => assert.equal(aesCodes.countryIso("GHANA"), "GH"));
ok("countryIso via POD TEMA = GH", () => assert.equal(aesCodes.countryIso("TEMA"), "GH"));
ok("scheduleD BALTIMORE set", () => assert.ok(aesCodes.scheduleD("BALTIMORE")));
ok("scheduleD WILMINGTON = 1103 (DE, not NC — corrected from real data)", () => assert.equal(aesCodes.scheduleD("WILMINGTON"), "1103"));
ok("scheduleD FREEPORT = 5311 (TX — confirmed)", () => assert.equal(aesCodes.scheduleD("FREEPORT"), "5311"));
ok("scheduleK TEMA = 74990 (confirmed, n=203)", () => assert.equal(aesCodes.scheduleK("TEMA"), "74990"));
ok("scheduleK COTONOU = 76101 (confirmed, n=5)", () => assert.equal(aesCodes.scheduleK("COTONOU"), "76101"));
ok("scacForPod TEMA = OOLU (confirmed, n=155/203)", () => assert.equal(aesCodes.scacForPod("TEMA"), "OOLU"));
ok("scacForPod LAGOS = SBLF (confirmed, n=59/99)", () => assert.equal(aesCodes.scacForPod("LAGOS"), "SBLF"));
ok("scacForPod COTONOU = MSCU (confirmed, n=3/5)", () => assert.equal(aesCodes.scacForPod("COTONOU"), "MSCU"));
ok("scacForPod unknown port = ''", () => assert.equal(aesCodes.scacForPod("DAKAR"), ""));
ok("originIndicator defaults D regardless of VIN origin", () => {
  // Confirmed from a real accepted filing (order 14217, Korean-built VIN) — a
  // used vehicle re-exported from US domestic commerce is "Domestic".
  assert.equal(aesCodes.originIndicator({ vin: "4T1B11HK7JU678515" }, {}), "D");
  assert.equal(aesCodes.originIndicator({ vin: "KM8JUCAG8FU961609" }, {}), "D");
});
ok("originIndicator: order override wins", () => assert.equal(aesCodes.originIndicator({ vin: "KM8...", originIndicator: "F" }, {}), "F"));

console.log("stateAbbr");
ok("plain abbreviation", () => assert.equal(aesCodes.stateAbbr("OH"), "OH"));
ok("full name", () => assert.equal(aesCodes.stateAbbr("OHIO"), "OH"));
ok("city+state run together (real data)", () => assert.equal(aesCodes.stateAbbr("PHILADELPHIA OHIO"), "OH"));
ok("city+state with extra prefix word", () => assert.equal(aesCodes.stateAbbr("NEW PHILADELPHIA OHIO"), "OH"));
ok("two-word state name", () => assert.equal(aesCodes.stateAbbr("NEW JERSEY"), "NJ"));
ok("unrecognized = ''", () => assert.equal(aesCodes.stateAbbr("NOWHERESVILLE"), ""));

console.log("yymmdd");
ok("ISO", () => assert.equal(yymmdd("2026-09-20"), "260920"));
ok("slash", () => assert.equal(yymmdd("9/5/2026"), "260905"));
ok("junk = ''", () => assert.equal(yymmdd("soon"), ""));

console.log("buildWeblinkFiling — happy path");
const built = buildWeblinkFiling(ORDER, CONFIG, { srn: "DDG14204", returnToken: "tok" });
ok("action = test URL", () => assert.ok(built.actionUrl.includes("trade-test")));
ok("SRN", () => assert.equal(built.fields.SRN, "DDG14204"));
ok("MOT = 10 (RORO)", () => assert.equal(built.fields.MOT, "10"));
ok("COD = GH", () => assert.equal(built.fields.COD, "GH"));
ok("EDA = 260920", () => assert.equal(built.fields.EDA, "260920"));
ok("USPPI EIN digits only", () => assert.equal(built.fields.AD0_2, "123456789"));
ok("AD0_3 = E", () => assert.equal(built.fields.AD0_3, "E"));
ok("consignee name", () => assert.equal(built.fields.AD1_3, "KWAME MOTORS"));
ok("isLine1 = Y", () => assert.equal(built.fields.isLine1, "Y"));
ok("IT1_2 value rounded", () => assert.equal(built.fields.IT1_2, "6500"));
ok("IT1_7 weight", () => assert.equal(built.fields.IT1_7, "1802"));
ok("IT1_13 schedule B", () => assert.equal(built.fields.IT1_13, "8703230190"));
ok("IT1_15 = Y", () => assert.equal(built.fields.IT1_15, "Y"));
ok("IT1_17 VIN", () => assert.equal(built.fields.IT1_17, "4T1B11HK7JU678515"));
ok("IT1_12 description — bare YEAR MAKE MODEL, no filler (confirmed: order 14217)", () => assert.equal(built.fields.IT1_12, "2018 TOYOTA CAMRY"));
ok("IT1_21 origin indicator defaults D", () => assert.equal(built.fields.IT1_21, "D"));
ok("IBT in-bond code defaults 70", () => assert.equal(built.fields.IBT, "70"));
ok("no EQ1 for RORO", () => assert.ok(!("EQ1" in built.fields)));
ok("no forwarding agent when unconfigured", () => assert.ok(!("AD3_3" in built.fields)));
ok("wl_success_url present", () => assert.ok(!built.fields.wl_success_url || built.fields.wl_success_url.includes("weblink-return")));

console.log("buildWeblinkFiling — missing detection");
const bad = buildWeblinkFiling({ ...ORDER, vin: "", titleNumber: "", value: "" }, CONFIG, { srn: "DDG14204", returnToken: "tok" });
const missingFields = bad.missing.map((m) => m.field);
ok("VIN missing flagged", () => assert.ok(missingFields.includes("IT1_17")));
ok("title number missing flagged", () => assert.ok(missingFields.includes("IT1_18")));
ok("value missing flagged", () => assert.ok(missingFields.includes("IT1_2")));

console.log("buildWeblinkFiling — container adds equipment");
const cont = buildWeblinkFiling({ ...ORDER, requestType: "Container", containerNumber: "MSCU1234567", sealNumber: "SEAL99" }, CONFIG, { srn: "DDG14204", returnToken: "tok" });
ok("MOT = 11", () => assert.equal(cont.fields.MOT, "11"));
ok("EQ1 set", () => assert.equal(cont.fields.EQ1, "MSCU1234567"));
ok("SN1 set", () => assert.equal(cont.fields.SN1, "SEAL99"));

console.log("buildWeblinkFiling — order 14217 (real accepted filing, USPPI on the order)");
const REAL_ORDER = {
  _id: "real14217", refNumber: "14217", bookingNumber: "SLSE-407098",
  requestType: "RORO", year: "2015", make: "HYUNDAI", model: "TUCSON",
  vehicleYearMakeModel: "2015 HYUNDAI TUCSON", vin: "KM8JUCAG8FU961609",
  value: "800", weightKgs: "1652",
  pol: "BALTIMORE", pod: "LAGOS", consigneeCountry: "NIGERIA", shippingLine: "SALLAUM",
  vessel: "LIBERTY PROMISE", sailDate: "2026-10-03", pickupState: "PHILADELPHIA OHIO",
  exporterName: "STATE FARM MUTUAL", exporterAddress: "2532 STATE ROUTE 259 SE",
  exporterCity: "NEW PHILADELPHIA", exporterState: "OH", exporterZip: "44663",
  usppiEin: "37053310000",
  consigneeName: "ADAMS AUTO SOLUTION LIMITED", consigneeAddress: "DD 10 UNGUWAR KANAWA BY, NDA BUS STOP",
  consigneeCity: "KADUNA",
  titleNumber: "4503799492", titleState: "OH",
  aesFiling: { srn: "14217", returnToken: "tok" },
};
const REAL_CONFIG = { ...CONFIG, ultConsigneeType: "O", defaultInBondCode: "70" };
const real14217 = buildWeblinkFiling(REAL_ORDER, REAL_CONFIG, { srn: "14217", returnToken: "tok" });
ok("SRN is the bare order number", () => assert.equal(real14217.fields.SRN, "14217"));
ok("USPPI comes from the order, not config", () => assert.equal(real14217.fields.AD0_1, "STATE FARM MUTUAL"));
ok("USPPI EIN comes from the order", () => assert.equal(real14217.fields.AD0_2, "37053310000"));
ok("ST derived from exporterState (clean), not messy pickupState", () => assert.equal(real14217.fields.ST, "OH"));
ok("POE Baltimore = 1303 (confirmed)", () => assert.equal(real14217.fields.POE, "1303"));
ok("POU Lagos = 75367 (confirmed)", () => assert.equal(real14217.fields.POU, "75367"));
ok("SCAC Sallaum = SBLF (confirmed)", () => assert.equal(real14217.fields.SCAC, "SBLF"));
ok("commodity description matches real filing", () => assert.equal(real14217.fields.IT1_12, "2015 HYUNDAI TUCSON"));
ok("title number/state from the order", () => { assert.equal(real14217.fields.IT1_18, "4503799492"); assert.equal(real14217.fields.IT1_19, "OH"); });
ok("no USPPI fields flagged missing", () => assert.ok(!real14217.missing.some((m) => m.field.startsWith("AD0_"))));
ok("SCAC defaults by POD (LAGOS → SBLF)", () => assert.equal(real14217.fields.SCAC, "SBLF"));
ok("aesScac order override wins over POD default", () => {
  const withOverride = buildWeblinkFiling({ ...REAL_ORDER, aesScac: "HLCU" }, REAL_CONFIG, { srn: "14217", returnToken: "tok" });
  assert.equal(withOverride.fields.SCAC, "HLCU");
});

console.log("AesConfig schema defaults (no DB — construct only)");
const AesConfig = require("../models/AesConfig");
const freshCfg = new AesConfig({});
ok("defaultFilingOption default '2'", () => assert.equal(freshCfg.defaultFilingOption, "2"));
ok("defaultScheduleB default '8703600045'", () => assert.equal(freshCfg.defaultScheduleB, "8703600045"));
ok("ultConsigneeType default 'O'", () => assert.equal(freshCfg.ultConsigneeType, "O"));
ok("defaultOriginIndicator default 'D'", () => assert.equal(freshCfg.defaultOriginIndicator, "D"));
ok("defaultStateOfOrigin default 'NJ'", () => assert.equal(freshCfg.defaultStateOfOrigin, "NJ"));
ok("srnPrefix default ''", () => assert.equal(freshCfg.srnPrefix, ""));
ok("forwardingAgent.name defaults to DDG's real identity", () => assert.equal(freshCfg.forwardingAgent.name, "DOR LDOR GLOBAL"));

console.log("parseOrderDocs — EIN + title extraction (order 14217 EEI text)");
const { findUsppiEin, findVehicleTitle } = require("../utils/parseOrderDocs");
const EEI_TEXT = `1a. U.S. PRINCIPAL PARTY (USPPI)
STATE FARM MUTUAL
b. USPPI EIN (IRS) or ID Number
37053310000
c. RELATED PARTIES TO TRANSACTION
1 D 2015 HYUNDAI TUCSON
1 NO 1652 KM8JUCAG8FU961609 / 4503799492 / OH
800`;
ok("findUsppiEin", () => assert.equal(findUsppiEin(EEI_TEXT), "37053310000"));
ok("findVehicleTitle", () => assert.deepEqual(findVehicleTitle(EEI_TEXT, "KM8JUCAG8FU961609"), { titleNumber: "4503799492", titleState: "OH" }));
ok("findVehicleTitle: no VIN match = blank", () => assert.deepEqual(findVehicleTitle(EEI_TEXT, "NOTFOUNDVIN0000000"), { titleNumber: "", titleState: "" }));

console.log("applyItn");
ok("sets when empty", () => { const o = { timeline: [] }; assert.equal(applyItn(o, "X20260101234567", "test"), "set"); assert.equal(o.aesItn, "X20260101234567"); });
ok("confirms when equal", () => { const o = { aesItn: "X20260101234567", aesFiling: {}, timeline: [] }; assert.equal(applyItn(o, "x20260101234567", "test"), "confirmed"); });
ok("mismatch keeps existing", () => { const o = { aesItn: "X20260101234567", aesFiling: {}, timeline: [] }; assert.equal(applyItn(o, "X29990101234567", "test"), "mismatch"); assert.equal(o.aesItn, "X20260101234567"); assert.equal(o.timeline.length, 1); });
ok("ignores non-ITN", () => { const o = { timeline: [] }; assert.equal(applyItn(o, "not-an-itn", "test"), "noop"); });

console.log("parseAesEmail");
const { parseAesEmail } = require("../services/aesEmailPoller");
const ACCEPT_EMAIL = `We have received your created filing submitted at 01/26/2026 09:08:42.
Your request to create the following filing has been ACCEPTED.
Shipment Reference Number: DDG14204
AES ITN: X20260126121298
-------------------------------------------------------------------
Attention
(399-VERIFY) IS THE CLEARANCE YEAR CORRECT?
(700-COMPLIANCE ALERT) SHIPMENT REPORTED LATE; OPT 2`;
ok("email SRN", () => assert.equal(parseAesEmail(ACCEPT_EMAIL).srn, "DDG14204"));
ok("email ITN", () => assert.equal(parseAesEmail(ACCEPT_EMAIL).itn, "X20260126121298"));
ok("email status accepted", () => assert.equal(parseAesEmail(ACCEPT_EMAIL).status, "accepted"));
ok("email notes captured", () => assert.ok(parseAesEmail(ACCEPT_EMAIL).notes.includes("399-VERIFY")));
ok("rejected email", () => assert.equal(parseAesEmail("... has been REJECTED.\nShipment Reference Number: DDG99\n").status, "rejected"));

// Real confirmation email from DoNotReply@cbp.dhs.gov, subject "AES Direct Filing - 14217"
// — confirms CBP's SRN is the bare order number, no "DDG" prefix.
const REAL_EMAIL = `We have received your created filing submitted at 09/10/2026 19:05:51.
Your request to create the following filing has been ACCEPTED.

Shipment Reference Number: 14217
AES ITN: X20260910745817
-------------------------------------------------------------------
Attention
(974-NOTIFICATION) SHIPMENT ADDED


If you need further assistance, please contact the AES Help Desk at askaes@census.gov or 1-800-549-0595, option 1.

PLEASE, DO NOT REPLY TO THIS MESSAGE`;
const real = parseAesEmail(REAL_EMAIL);
ok("real email: bare SRN (no prefix)", () => assert.equal(real.srn, "14217"));
ok("real email: ITN", () => assert.equal(real.itn, "X20260910745817"));
ok("real email: accepted", () => assert.equal(real.status, "accepted"));
ok("real email: notification note", () => assert.ok(real.notes.includes("974-NOTIFICATION")));

console.log(`\n${pass} checks passed${process.exitCode ? " — SOME FAILED" : ""}`);
