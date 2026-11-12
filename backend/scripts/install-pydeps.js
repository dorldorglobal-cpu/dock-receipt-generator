// Runs after `npm install` (package.json "postinstall") on every build.
// Installs the Python packages in requirements.txt (PyMuPDF for payment-proof
// redaction, pypdf for PDF splits, pdfplumber) into ./.pydeps inside the app, so
// they're there at runtime no matter how the host's build command is set up.
// server.js puts ./.pydeps on PYTHONPATH. Never fails the build.
const { spawnSync } = require("child_process");
const path = require("path");

if (process.platform === "win32" || process.env.PYDEPS_SKIP) {
  console.log("[pydeps] skipped (local dev / PYDEPS_SKIP)");
  process.exit(0);
}
const root = path.join(__dirname, "..");
const target = path.join(root, ".pydeps");
const req = path.join(root, "requirements.txt");
const base = ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--no-input", "--upgrade", "--target", target, "-r", req];

for (const py of ["python3", "python"]) {
  for (const extra of [[], ["--break-system-packages"]]) {   // PEP 668 images refuse plain pip installs
    const r = spawnSync(py, [...base, ...extra], { stdio: "inherit", timeout: 600000 });
    if (r.error) break;                 // this python doesn't exist — try the next one
    if (r.status === 0) {
      console.log(`[pydeps] installed requirements.txt into .pydeps with ${py}${extra.length ? " " + extra[0] : ""}`);
      process.exit(0);
    }
  }
}
console.warn("[pydeps] could not install Python packages — PDF redaction/splitting may be unavailable");
process.exit(0);
