const fs = require("fs");
const os = require("os");
const path = require("path");

function getAppDataRoot() {
  if (process.env.APPDATA) {
    return process.env.APPDATA;
  }

  return path.join(os.homedir(), "AppData", "Roaming");
}

function getNotesRoot() {
  return path.join(getAppDataRoot(), "clairvoyance", "notes");
}

function getDefaultFolderRelativePath() {
  return "clips";
}

function ensureDefaultFolder() {
  const notesRoot = getNotesRoot();
  const clipsPath = path.join(notesRoot, getDefaultFolderRelativePath());
  fs.mkdirSync(clipsPath, { recursive: true });
  return { notesRoot, clipsPath };
}

function resolveFolderRelativePath(relativeFolder = getDefaultFolderRelativePath()) {
  const cleaned = String(relativeFolder || getDefaultFolderRelativePath())
    .replace(/[\\/]+/g, path.sep)
    .replace(new RegExp(`^\\${path.sep}+`), "");

  const absolutePath = path.resolve(getNotesRoot(), cleaned);
  const notesRoot = path.resolve(getNotesRoot());
  const relativeToRoot = path.relative(notesRoot, absolutePath);

  if (!relativeToRoot || relativeToRoot === "") {
    return { absolutePath, relativePath: "" };
  }

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Folder path resolves outside the Clairvoyance notes root.");
  }

  return {
    absolutePath,
    relativePath: relativeToRoot.split(path.sep).join("/")
  };
}

function listFolders(root = getNotesRoot(), prefix = "") {
  const entries = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true })
    : [];

  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    folders.push(relative);
    folders.push(...listFolders(path.join(root, entry.name), relative));
  }

  return folders.sort((a, b) => a.localeCompare(b));
}

module.exports = {
  ensureDefaultFolder,
  getDefaultFolderRelativePath,
  getNotesRoot,
  listFolders,
  resolveFolderRelativePath
};
