const fs = require("fs");
const path = require("path");

const manifestPath = path.join(__dirname, "..", "extension", "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const requiredPermissions = ["storage", "contextMenus", "sidePanel", "activeTab"];
const missingPermissions = requiredPermissions.filter(
  (permission) => !manifest.permissions.includes(permission)
);

if (manifest.manifest_version !== 3) {
  throw new Error("Manifest must be version 3.");
}

if (missingPermissions.length > 0) {
  throw new Error(`Missing permissions: ${missingPermissions.join(", ")}`);
}

if (!manifest.host_permissions.includes("http://127.0.0.1/*")) {
  throw new Error("Manifest must allow the loopback bridge host permission.");
}

process.stdout.write("Extension manifest check passed.\n");
