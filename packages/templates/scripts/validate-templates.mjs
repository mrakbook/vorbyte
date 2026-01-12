import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const indexPath = path.join(root, "templates.index.json");

if (!fs.existsSync(indexPath)) {
  console.error("Missing templates.index.json");
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
if (!Array.isArray(index)) {
  console.error("templates.index.json must be an array");
  process.exit(1);
}

for (const t of index) {
  for (const key of ["id", "name", "description", "overlayDir"]) {
    if (!t[key]) {
      console.error(`Template missing required key '${key}':`, t);
      process.exit(1);
    }
  }

  const overlayDir = path.join(root, t.overlayDir);
  if (!fs.existsSync(overlayDir)) {
    console.error(`overlayDir not found for template '${t.id}': ${t.overlayDir}`);
    process.exit(1);
  }
}

console.log(`OK: validated ${index.length} templates`);
