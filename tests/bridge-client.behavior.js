const path = require("path");

async function run() {
  const fetchCalls = [];
  const storageState = {};
  let healthToken = "test-token";
  let staleTokenRejected = false;
  let appendedSameNote = false;

  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const key of keys) {
            result[key] = storageState[key];
          }
          return result;
        },
        async set(payload) {
          Object.assign(storageState, payload);
        },
        async remove(key) {
          delete storageState[key];
        }
      }
    }
  };

  global.self = global;

  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    if (url.endsWith("/health")) {
      return fakeResponse(200, {
        ok: true,
        pairingToken: healthToken,
        notesRoot: "C:\\Users\\Example\\AppData\\Roaming\\clairvoyance\\notes",
        defaultFolder: "clips"
      });
    }

    if (url.endsWith("/notes")) {
      const token = options?.headers?.["X-CV-Clip-Token"];
      if (token === "stale-token") {
        staleTokenRejected = true;
        healthToken = "fresh-token";
        return fakeResponse(401, {
          ok: false,
          error: "Missing or invalid pairing token."
        });
      }

      return fakeResponse(201, {
        ok: true,
        note: {
          id: "new-note-id",
          relativeFolderPath: "clips",
          relativeNotePath: "clips/new-note-id-new-folder-append-target.md",
          absolutePath:
            "C:\\Users\\Example\\AppData\\Roaming\\clairvoyance\\notes\\clips\\new-note-id-new-folder-append-target.md",
          title: JSON.parse(options.body).title || "Untitled clipping note"
        }
      });
    }

    if (url.includes("/notes/old-note-id/clips")) {
      throw new Error("append endpoint should not be used after folder change");
    }

    if (url.includes("/notes/new-note-id/clips")) {
      const body = JSON.parse(options.body);
      const resolvedTitle = body.title || "Untitled clipping note";
      appendedSameNote = resolvedTitle === "Untitled clipping note";
      return fakeResponse(200, {
        ok: true,
        note: {
          id: "new-note-id",
          relativeFolderPath: "clips",
          relativeNotePath: "clips/new-note-id-untitled-clipping-note.md",
          absolutePath:
            "C:\\Users\\Example\\AppData\\Roaming\\clairvoyance\\notes\\clips\\new-note-id-untitled-clipping-note.md",
          title: resolvedTitle
        }
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  };

  require(path.join(
    __dirname,
    "..",
    "extension",
    "shared",
    "bridge-client.js"
  ));

  const draft = {
    title: "New folder append target",
    folderPath: "clips",
    body: "Original body",
    sources: {
      "https://example.com/original": {
        title: "Original Page",
        url: "https://example.com/original"
      }
    },
    savedNote: {
      id: "old-note-id",
      relativeFolderPath: "00 - Inbox",
      relativeNotePath: "00 - Inbox/old-note-id-existing-note-elsewhere.md"
    }
  };

  const clip = {
    title: "Moved Page",
    url: "https://example.com/moved",
    text: "Moved folder clip body"
  };

  const result = await global.cvClipBridge.appendClip(draft, clip);

  if (!result.note || result.note.id !== "new-note-id") {
    throw new Error("Folder-change append did not create the new note.");
  }

  const createCall = fetchCalls.find((call) => call.url.endsWith("/notes"));
  if (!createCall) {
    throw new Error("Folder-change append did not call POST /notes.");
  }

  const createBody = JSON.parse(createCall.options.body);
  if (createBody.folderPath !== "clips") {
    throw new Error("Folder-change append used the wrong target folder.");
  }
  if (!String(createBody.body).includes("Moved folder clip body")) {
    throw new Error("Folder-change append did not include the new clip content.");
  }

  storageState.cvClipBridgeSession = {
    pairingToken: "stale-token",
    notesRoot: "C:\\Users\\Example\\AppData\\Roaming\\clairvoyance\\notes",
    defaultFolder: "clips",
    updatedAt: new Date().toISOString()
  };

  const retryNote = await global.cvClipBridge.createNote({
    title: "Retry note",
    folderPath: "clips",
    body: "Retry after stale token",
    sources: {}
  });

  if (!staleTokenRejected) {
    throw new Error("Stale-token retry path was not exercised.");
  }

  if (!retryNote || retryNote.id !== "new-note-id") {
    throw new Error("Retry after stale token did not succeed.");
  }

  if (storageState.cvClipBridgeSession?.pairingToken !== "fresh-token") {
    throw new Error("Bridge session was not refreshed after stale-token retry.");
  }

  const placeholderCreate = await global.cvClipBridge.createNote({
    title: "",
    folderPath: "clips",
    body: "Saved anyway with placeholder",
    sources: {}
  });

  const placeholderAppend = await global.cvClipBridge.appendClip(
    {
      title: "",
      folderPath: "clips",
      body: "Saved anyway with placeholder",
      sources: {},
      savedNote: placeholderCreate
    },
    {
      title: "Later page",
      url: "https://example.com/later",
      text: "Later appended clip"
    }
  );

  if (!placeholderAppend.note || placeholderAppend.note.id !== "new-note-id") {
    throw new Error("Placeholder-title append did not target the existing saved note.");
  }

  if (!appendedSameNote) {
    throw new Error("Placeholder-title append did not reuse the canonical fallback title.");
  }

  process.stdout.write(
    "Bridge client behavior test passed. Folder change creates a new note, stale-token 401 retries once after bridge rebootstrap, and placeholder-title save+append stays on the same note.\n"
  );
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
