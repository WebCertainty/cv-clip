(function attachCvClipBridge(globalScope) {
  const BRIDGE_BASE_URL = "http://127.0.0.1:43119";
  const BRIDGE_SESSION_KEY = "cvClipBridgeSession";

  async function getBridgeSession() {
    const result = await chrome.storage.local.get([BRIDGE_SESSION_KEY]);
    const currentSession = result[BRIDGE_SESSION_KEY];

    if (currentSession?.pairingToken) {
      return currentSession;
    }

    return refreshBridgeSession();
  }

  async function refreshBridgeSession() {
    const response = await fetch(`${BRIDGE_BASE_URL}/health`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok || !payload.pairingToken) {
      throw new Error(payload.error || "Bridge health check failed.");
    }

    const session = {
      pairingToken: payload.pairingToken,
      notesRoot: payload.notesRoot,
      defaultFolder: payload.defaultFolder,
      updatedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({ [BRIDGE_SESSION_KEY]: session });
    return session;
  }

  async function bridgeRequest(path, options = {}) {
    let session = await getBridgeSession();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${BRIDGE_BASE_URL}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-CV-Clip-Token": session.pairingToken,
          ...(options.headers || {})
        }
      });

      const payload = await response.json();
      if (response.ok && payload.ok) {
        return payload;
      }

      if (response.status === 401 && attempt === 0) {
        await chrome.storage.local.remove(BRIDGE_SESSION_KEY);
        session = await refreshBridgeSession();
        continue;
      }

      throw new Error(payload.error || "Bridge request failed.");
    }
  }

  async function listFolders() {
    const session = await refreshBridgeSession();
    const response = await fetch(`${BRIDGE_BASE_URL}/folders`, {
      cache: "no-store"
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Folder listing failed.");
    }

    return {
      ...payload,
      pairingToken: session.pairingToken
    };
  }

  async function createNote(draft) {
    const payload = await bridgeRequest("/notes", {
      method: "POST",
      body: JSON.stringify({
        title: draft.title,
        folderPath: draft.folderPath,
        body: draft.body,
        sources: draft.sources || {},
        referencingStyle: draft.refStyle || "none"
      })
    });

    return payload.note;
  }

  async function updateNote(draft) {
    const noteId = draft.savedNote?.id;
    if (!noteId) {
      return createNote(draft);
    }

    if (
      draft.savedNote?.relativeFolderPath !== undefined &&
      normalizeFolderPath(draft.savedNote.relativeFolderPath) !==
        normalizeFolderPath(draft.folderPath)
    ) {
      return createNote({
        ...draft,
        savedNote: null
      });
    }

    const payload = await bridgeRequest(`/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: draft.title,
        folderPath: draft.folderPath,
        body: draft.body,
        sources: draft.sources || {},
        referencingStyle: draft.refStyle || "none"
      })
    });

    return payload.note;
  }

  async function appendClip(draft, clip) {
    const folderChanged =
      draft.savedNote?.relativeFolderPath !== undefined &&
      normalizeFolderPath(draft.savedNote.relativeFolderPath) !==
        normalizeFolderPath(draft.folderPath);

    if (!draft.savedNote?.id || folderChanged) {
      const createdDraft = {
        ...draft,
        body: [draft.body || "", formatClip(clip, draft.refStyle)].filter(Boolean).join("\n\n"),
        sources: mergeSources(draft.sources || {}, clip),
        savedNote: null
      };
      const note = await createNote(createdDraft);
      return {
        draft: {
          ...createdDraft,
          savedNote: note
        },
        note
      };
    }

    const nextDraft = {
      ...draft,
      body: [draft.body || "", formatClip(clip, draft.refStyle)].filter(Boolean).join("\n\n"),
      sources: mergeSources(draft.sources || {}, clip)
    };

    const payload = await bridgeRequest(`/notes/${draft.savedNote.id}/clips`, {
      method: "POST",
      body: JSON.stringify({
        title: nextDraft.title,
        folderPath: nextDraft.folderPath,
        currentBody: draft.body || "",
        clipText: clip.text,
        clipBlock: formatClip(clip, draft.refStyle),
        sources: nextDraft.sources || {},
        referencingStyle: draft.refStyle || "none"
      })
    });

    return {
      draft: {
        ...nextDraft,
        savedNote: payload.note
      },
      note: payload.note
    };
  }

  function mergeSources(existingSources, clip) {
    const sourceKey = clip.url || clip.title || `source-${Date.now()}`;
    return {
      ...existingSources,
      [sourceKey]: {
        title: clip.title || clip.url || "Source",
        url: clip.url || ""
      }
    };
  }

  function normalizeFolderPath(folderPath) {
    return String(folderPath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }

  function siteNameFromClip(clip) {
    try {
      const hostname = new URL(clip.url || "").hostname.replace(/^www\./, "");
      return hostname.charAt(0).toUpperCase() + hostname.slice(1);
    } catch {
      return null;
    }
  }

  function formatClip(clip) {
    return [
      `## ${clip.title || "Captured selection"}`,
      "",
      String(clip.text || "").trim(),
      "",
      `Source: ${clip.url || "unknown"}`,
      `Captured: ${new Date().toISOString()}`
    ].join("\n");
  }

  globalScope.cvClipBridge = {
    appendClip,
    createNote,
    formatClip,
    listFolders,
    mergeSources,
    refreshBridgeSession,
    updateNote
  };
})(typeof self !== "undefined" ? self : window);
