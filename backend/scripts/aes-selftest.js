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
ok("originIndicator US VIN (4...) = D", () => assert.equal(aesCodes.originIndicator({ vin: "4T1B11HK7JU678515" }), "D"));
ok("originIndicator JP VIN (J...) = F", () => assert.equal(aesCodes.originIndicator({ vin: "JT1B11HK7JU678515" }), "F"));

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
ok("IT1_12 description", () => assert.ok(/USED 2018 TOYOTA CAMRY/.test(built.fields.IT1_12)));
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

console.log(`\n${pass} checks passed${process.exitCode ? " — SOME FAILED" : ""}`);
