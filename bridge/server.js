const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const {
  ensureDefaultFolder,
  getDefaultFolderRelativePath,
  getNotesRoot,
  listFolders
} = require("./notes-root");
const { appendClip, createNote, updateNote } = require("./notes-store");

function camelToKebab(str) {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}

function loadCurrentTheme() {
  try {
    const cvDataDir = path.dirname(getNotesRoot());
    const store = JSON.parse(fs.readFileSync(path.join(cvDataDir, "clairvoyance-store.json"), "utf-8"));
    const themeId = store.themeId || "dark";
    const themeFile = path.join(cvDataDir, "config", "themes", `${themeId}.json`);
    const theme = JSON.parse(fs.readFileSync(themeFile, "utf-8"));
    const cssVars = {};
    for (const [key, value] of Object.entries(theme.colors || {})) {
      cssVars[`--${camelToKebab(key)}`] = value;
    }
    return { id: themeId, name: theme.name, isDark: theme.isDark, cssVars };
  } catch {
    return null;
  }
}

const DEFAULT_PORT = Number(process.env.CV_CLIP_PORT || 43119);
const DEFAULT_HOST = "127.0.0.1";

function sendJson(response, statusCode, payload, origin, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CV-Clip-Token",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload, null, 2));
}

function getAllowedOrigin(origin) {
  if (!origin) {
    return "*";
  }

  if (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("edge-extension://")
  ) {
    return origin;
  }

  return "null";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
}

function generatePairingToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isTrustedOrigin(origin) {
  if (!origin) {
    return true;
  }

  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("edge-extension://")
  );
}

function enforceWriteGuard(request, pairingToken) {
  const origin = request.headers.origin;
  const token = request.headers["x-cv-clip-token"];

  if (!isTrustedOrigin(origin)) {
    throw Object.assign(new Error("Untrusted origin."), { statusCode: 403 });
  }

  if (token !== pairingToken) {
    throw Object.assign(new Error("Missing or invalid pairing token."), {
      statusCode: 401
    });
  }
}

function createRequestHandler(options = {}) {
  ensureDefaultFolder();
  const pairingToken = options.pairingToken || generatePairingToken();

  return async (request, response) => {
    const origin = request.headers.origin;

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true }, origin);
      return;
    }

    const requestUrl = new URL(request.url, `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    const pathname = requestUrl.pathname;

    try {
      if (request.method === "GET" && pathname === "/health") {
        sendJson(
          response,
          200,
          {
            ok: true,
            host: DEFAULT_HOST,
            port: DEFAULT_PORT,
            notesRoot: getNotesRoot(),
            defaultFolder: getDefaultFolderRelativePath(),
            pairingToken
          },
          origin,
          { "Cache-Control": "no-store" }
        );
        return;
      }

      if (request.method === "GET" && pathname === "/theme") {
        sendJson(response, 200, { ok: true, theme: loadCurrentTheme() }, origin, {
          "Cache-Control": "no-store"
        });
        return;
      }

      if (request.method === "GET" && pathname === "/folders") {
        const { notesRoot } = ensureDefaultFolder();
        sendJson(
          response,
          200,
          {
            ok: true,
            root: notesRoot,
            defaultFolder: getDefaultFolderRelativePath(),
            folders: [getDefaultFolderRelativePath(), ...listFolders(notesRoot).filter((folder) => folder !== getDefaultFolderRelativePath())]
          },
          origin
        );
        return;
      }

      if (request.method === "POST" && pathname === "/notes") {
        enforceWriteGuard(request, pairingToken);
        const payload = await readJsonBody(request);
        const note = createNote(payload);
        sendJson(response, 201, { ok: true, note }, origin);
        return;
      }

      if (request.method === "POST" && /^\/notes\/[^/]+\/clips$/.test(pathname)) {
        enforceWriteGuard(request, pairingToken);
        const noteId = pathname.replace(/^\/notes\/([^/]+)\/clips$/, "$1");
        const payload = await readJsonBody(request);
        const note = appendClip(noteId, payload);
        sendJson(response, 200, { ok: true, note }, origin);
        return;
      }

      if (request.method === "PATCH" && pathname.startsWith("/notes/")) {
        enforceWriteGuard(request, pairingToken);
        const noteId = pathname.replace(/^\/notes\//, "");
        const payload = await readJsonBody(request);
        const note = updateNote(noteId, payload);
        sendJson(response, 200, { ok: true, note }, origin);
        return;
      }

      sendJson(response, 404, { ok: false, error: "Not found." }, origin);
    } catch (error) {
      sendJson(
        response,
        error.statusCode || 400,
        {
          ok: false,
          error: error.message
        },
        origin
      );
    }
  };
}

function startServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const pairingToken = options.pairingToken || generatePairingToken();
  const server = http.createServer(createRequestHandler({ pairingToken }));

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve({ server, host, port, pairingToken });
    });
  });
}

if (require.main === module) {
  startServer()
    .then(({ host, port }) => {
      process.stdout.write(`CV CLIP bridge listening on http://${host}:${port}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  startServer
};
