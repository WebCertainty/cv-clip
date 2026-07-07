const fs = require("fs");
const path = require("path");

const {
  ensureDefaultFolder,
  getDefaultFolderRelativePath,
  resolveFolderRelativePath
} = require("./notes-root");

const DEFAULT_NOTE_TITLE = "Untitled clipping note";

function slugifyTitle(title) {
  const base = String(title || "clip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return base || "clip";
}

function getTimestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeSources(sources) {
  const values = Array.isArray(sources)
    ? sources
    : Object.values(sources || {});

  return values
    .map((source) => ({
      title: String(source?.title || "").trim(),
      url: String(source?.url || "").trim()
    }))
    .filter((source) => source.title || source.url)
    .sort((a, b) => (a.url || a.title).localeCompare(b.url || b.title));
}

function siteNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname.charAt(0).toUpperCase() + hostname.slice(1);
  } catch {
    return null;
  }
}

function formatApa7(source) {
  // *Title*. (n.d.). *SiteName*. URL
  const siteName = source.url ? siteNameFromUrl(source.url) : null;
  const parts = [];
  if (source.title) parts.push(`*${source.title}*.`);
  parts.push("(n.d.).");
  if (siteName) parts.push(`*${siteName}*.`);
  if (source.url) parts.push(source.url);
  return parts.join(" ");
}

function formatHarvard(source) {
  // *Title*. n.d. *SiteName*. Available at: URL [Accessed DD Mon YYYY]
  const siteName = source.url ? siteNameFromUrl(source.url) : null;
  const accessed = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric"
  });
  const parts = [];
  if (source.title) parts.push(`*${source.title}*.`);
  parts.push("n.d.");
  if (siteName) parts.push(`*${siteName}*.`);
  if (source.url) parts.push(`Available at: ${source.url} [Accessed ${accessed}]`);
  return parts.join(" ");
}

function buildMarkdown({ title, body, sourceUrl, sourceTitle, sources, referencingStyle }) {
  const lines = [`# ${title}`, ""];
  const normalizedSources = normalizeSources(sources);
  lines.push(body || "", "");

  const allSources = normalizedSources.length > 0
    ? normalizedSources
    : (sourceTitle || sourceUrl) ? [{ title: sourceTitle || "", url: sourceUrl || "" }] : [];

  if (allSources.length === 0) return lines.join("\n");

  if (referencingStyle === "apa7") {
    lines.push("## References");
    for (const s of allSources) { lines.push(formatApa7(s)); lines.push(""); }
  } else if (referencingStyle === "harvard") {
    lines.push("## References");
    for (const s of allSources) { lines.push(formatHarvard(s)); lines.push(""); }
  } else {
    // Default: simple linked list
    lines.push("## Sources");
    for (const s of allSources) {
      if (s.title && s.url) lines.push(`- [${s.title}](${s.url})`);
      else if (s.url) lines.push(`- ${s.url}`);
      else lines.push(`- ${s.title}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildNoteFilename(noteId, title) {
  return `${noteId}-${slugifyTitle(title)}.md`;
}

function findExistingNotePath(folderAbsolutePath, noteId) {
  const entries = fs.existsSync(folderAbsolutePath)
    ? fs.readdirSync(folderAbsolutePath)
    : [];

  const matchingFile = entries.find(
    (entry) => entry === `${noteId}.md` || entry.startsWith(`${noteId}-`)
  );

  if (!matchingFile) {
    return null;
  }

  return path.join(folderAbsolutePath, matchingFile);
}

function createNote(payload = {}) {
  ensureDefaultFolder();

  const folder = resolveFolderRelativePath(
    payload.folderPath || getDefaultFolderRelativePath()
  );
  fs.mkdirSync(folder.absolutePath, { recursive: true });

  const title = String(payload.title || DEFAULT_NOTE_TITLE).trim() || DEFAULT_NOTE_TITLE;
  const id = getTimestampId();
  const filename = buildNoteFilename(id, title);
  const absolutePath = path.join(folder.absolutePath, filename);
  const markdown = buildMarkdown({
    title,
    body: payload.body || "",
    sourceUrl: payload.sourceUrl || "",
    sourceTitle: payload.sourceTitle || "",
    sources: payload.sources || {},
    referencingStyle: payload.referencingStyle || "none"
  });

  fs.writeFileSync(absolutePath, markdown, "utf8");

  return {
    id,
    filename,
    relativeFolderPath: folder.relativePath || "",
    relativeNotePath: path.posix.join(folder.relativePath || "", filename),
    absolutePath,
    title
  };
}

function updateNote(noteId, payload = {}) {
  if (!noteId) {
    throw new Error("Note id is required.");
  }

  const folder = resolveFolderRelativePath(
    payload.folderPath || getDefaultFolderRelativePath()
  );

  const title = String(payload.title || DEFAULT_NOTE_TITLE).trim() || DEFAULT_NOTE_TITLE;
  const filename = buildNoteFilename(noteId, title);
  const existingPath = findExistingNotePath(folder.absolutePath, noteId);
  if (!existingPath) {
    throw new Error("Note not found.");
  }

  const notePath = path.join(folder.absolutePath, filename);
  const nextBody = buildMarkdown({
    title,
    body: String(payload.body || ""),
    sourceUrl: payload.sourceUrl || "",
    sourceTitle: payload.sourceTitle || "",
    sources: payload.sources || {},
    referencingStyle: payload.referencingStyle || "none"
  });

  if (existingPath !== notePath) {
    fs.renameSync(existingPath, notePath);
  }

  fs.writeFileSync(notePath, nextBody, "utf8");

  return {
    id: noteId,
    filename,
    absolutePath: notePath,
    relativeFolderPath: folder.relativePath || "",
    relativeNotePath: path.posix.join(folder.relativePath || "", filename),
    title
  };
}

function appendClip(noteId, payload = {}) {
  if (!noteId) {
    throw new Error("Note id is required.");
  }

  const folder = resolveFolderRelativePath(
    payload.folderPath || getDefaultFolderRelativePath()
  );
  const title = String(payload.title || DEFAULT_NOTE_TITLE).trim() || DEFAULT_NOTE_TITLE;
  const filename = buildNoteFilename(noteId, title);
  const notePath = path.join(folder.absolutePath, filename);
  if (!fs.existsSync(notePath)) {
    throw new Error("Note not found.");
  }

  const currentBody = String(payload.currentBody || "");
  const clipText = String(payload.clipText || "").trim();
  if (!clipText) {
    throw new Error("Clip text is required.");
  }

  const clipBlock = String(payload.clipBlock || clipText);
  const mergedBody = [currentBody, clipBlock].filter(Boolean).join("\n\n");

  return updateNote(noteId, {
    ...payload,
    title,
    body: mergedBody
  });
}

module.exports = {
  appendClip,
  createNote,
  normalizeSources,
  updateNote
};
