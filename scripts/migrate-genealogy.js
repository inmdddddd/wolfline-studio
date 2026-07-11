const path = require("path");

const brandArg = process.argv.find((argument) => argument.startsWith("--brand="));
const dataArg = process.argv.find((argument) => argument.startsWith("--data-dir="));

process.env.BRAND = brandArg ? brandArg.slice("--brand=".length) : (process.env.BRAND || "aether");
if (dataArg) process.env.DATA_DIR = path.resolve(dataArg.slice("--data-dir=".length));

const { migrateGenealogyData } = require("../server");
const result = migrateGenealogyData();

if (!result.enabled) {
  console.error(`Genealogy is not enabled for brand "${process.env.BRAND}".`);
  process.exitCode = 1;
} else {
  console.log(`Genealogy migration complete: ${result.updated} of ${result.total} products updated.`);
}
