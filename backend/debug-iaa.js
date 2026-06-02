const fs = require("fs");
const pdfParse = require("pdf-parse");
const { parseBuyerReceipt } = require("./utils/parseOrderDocs");

const PDF_PATH = "C:\\Users\\dorld\\Downloads\\69df8dcef12b7.pdf";

async function main() {
  // 1. Get raw PDF text
  const buffer = fs.readFileSync(PDF_PATH);
  const data = await pdfParse(buffer);
  const rawText = data.text || "";

  console.log("=== RAW PDF TEXT ===");
  console.log(rawText);
  console.log("\n=== END RAW TEXT ===\n");

  // 2. Run parseBuyerReceipt
  const result = await parseBuyerReceipt(PDF_PATH);

  console.log("=== parseBuyerReceipt RESULT ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("ERROR:", err);
  process.exit(1);
});
