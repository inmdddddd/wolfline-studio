// One-off migration: move legacy inline base64 product images onto disk.
//
// An older upload path stored the uploaded picture as a base64 `imageDataUrl`
// field inside products.json while still setting `imageUrl` to a filename that
// was never actually written. The result on a live store: those products show
// a broken image (the file 404s) and products.json carries megabytes of base64
// that every read of that file has to parse. Nothing in the current code reads
// or writes `imageDataUrl` - it is purely orphaned data.
//
// This decodes each blob, writes it to the filename `imageUrl` already points
// at, and drops the field. Existing files are never overwritten.
//
//   node scripts/migrate-inline-images.js [--brand=beca] [--data-dir=...] [--apply]
//
// Without --apply it only reports what it would do.

const fs = require("fs");
const path = require("path");

const brandArg = process.argv.find((argument) => argument.startsWith("--brand="));
const dataArg = process.argv.find((argument) => argument.startsWith("--data-dir="));
const uploadArg = process.argv.find((argument) => argument.startsWith("--upload-dir="));
const apply = process.argv.includes("--apply");

process.env.BRAND = brandArg ? brandArg.slice("--brand=".length) : (process.env.BRAND || "beca");
if (dataArg) process.env.DATA_DIR = path.resolve(dataArg.slice("--data-dir=".length));
if (uploadArg) process.env.UPLOAD_DIR = path.resolve(uploadArg.slice("--upload-dir=".length));

const server = require("../server");
const { detectImageType, dataPaths } = server;

const dataDir = dataPaths().dataDir;
const uploadDir = dataPaths().uploadDir;
const productsPath = path.join(dataDir, "products.json");

if (!fs.existsSync(productsPath)) {
  console.error(`products.json not found at ${productsPath}`);
  process.exit(1);
}

const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
const before = fs.statSync(productsPath).size;

let written = 0;
let alreadyOnDisk = 0;
let dropped = 0;
let skipped = 0;

const migrated = products.map((product) => {
  const raw = typeof product.imageDataUrl === "string" ? product.imageDataUrl : "";
  if (!raw.startsWith("data:image")) {
    // Nothing inline to move; strip an empty leftover field while here.
    if ("imageDataUrl" in product) {
      const { imageDataUrl, ...rest } = product;
      dropped += 1;
      return rest;
    }
    return product;
  }

  const base64 = raw.slice(raw.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  const detected = detectImageType(buffer);

  // Never write bytes that aren't actually an image - same rule the upload
  // path now enforces. Keep the field so nothing is lost silently.
  if (!detected) {
    console.warn(`  ! ${product.name}: inline data is not a recognisable image, left untouched`);
    skipped += 1;
    return product;
  }

  const fileName = String(product.imageUrl || "").split("/").pop() || `${product.id}${detected.extension}`;
  const target = path.join(uploadDir, fileName);

  if (fs.existsSync(target)) {
    alreadyOnDisk += 1;
  } else if (apply) {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(target, buffer);
    written += 1;
    console.log(`  + wrote ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) for ${product.name}`);
  } else {
    written += 1;
    console.log(`  would write ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) for ${product.name}`);
  }

  const { imageDataUrl, ...rest } = product;
  dropped += 1;
  return rest;
});

const serialized = JSON.stringify(migrated, null, 2);

console.log("");
console.log(`brand:        ${process.env.BRAND}`);
console.log(`data dir:     ${dataDir}`);
console.log(`upload dir:   ${uploadDir}`);
console.log(`products:     ${products.length}`);
console.log(`images ${apply ? "written" : "to write"}: ${written}`);
console.log(`already on disk: ${alreadyOnDisk}`);
console.log(`imageDataUrl fields removed: ${dropped}`);
if (skipped) console.log(`skipped (not an image): ${skipped}`);
console.log(`products.json: ${(before / 1048576).toFixed(2)} MB -> ${(Buffer.byteLength(serialized) / 1048576).toFixed(2)} MB`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write the changes.");
  process.exit(0);
}

// Keep a timestamped copy next to the data dir before rewriting.
const backup = `${productsPath}.pre-inline-image-migration-${Date.now()}`;
fs.copyFileSync(productsPath, backup);

const temp = `${productsPath}.${process.pid}.tmp`;
const handle = fs.openSync(temp, "w");
try {
  fs.writeSync(handle, serialized);
  fs.fsyncSync(handle);
} finally {
  fs.closeSync(handle);
}
fs.renameSync(temp, productsPath);

console.log(`\nDone. Previous products.json kept at ${backup}`);
