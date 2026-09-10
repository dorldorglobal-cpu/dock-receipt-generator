// RFC 2045 §6.8: base64 in a MIME body MUST be wrapped to lines of at most
// 76 characters. Gmail's own webmail tolerates a single long line, but Apple
// Mail, Outlook and many mobile clients fail to decode it — the recipient
// sees a corrupt attachment or "this file is unable to open". Run every
// attachment's base64 through this before putting it in the MIME body.
function b64lines(input) {
  const b64 = Buffer.isBuffer(input) ? input.toString("base64") : String(input || "");
  return b64.replace(/[\r\n]/g, "").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

module.exports = { b64lines };
