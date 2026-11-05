// Calendar dates picked in a date box ("2026-11-05") are stored as midnight
// UTC. Formatted in New York time that's 8 PM the evening before, so a bill
// paid on Nov 5 showed "Nov 4". A value at exactly 00:00:00.000 UTC is a
// date-only value (a real timestamp landing on that exact millisecond is
// vanishingly rare), so show it as the UTC calendar day everywhere
// toLocaleDateString is used, unless the caller chose a time zone.
const original = Date.prototype.toLocaleDateString;

const isDateOnly = (d) =>
  d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;

export function installDateOnlyFix() {
  Date.prototype.toLocaleDateString = function (locales, options) {
    if (isNaN(this) || !isDateOnly(this) || options?.timeZone) return original.call(this, locales, options);
    return original.call(this, locales, { ...(options || {}), timeZone: "UTC" });
  };
}
