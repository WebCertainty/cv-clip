const STORAGE_KEY = "cvClipActiveDraft";
const {
  DEFAULT_PLACEHOLDER_TITLE,
  getEffectiveTitle,
  getTitleFieldValue,
  shouldShowSaveTitleNudge
} = window.cvClipTitleLogic;
const noteTitle = document.getElementById("noteTitle");
const usePageTitleButton = document.getElementById("usePageTitle");
const folderPath = document.getElementById("folderPath");
const refStyle = document.getElementById("refStyle");
const noteBody = document.getElementById("noteBody");
const statusText = document.getElementById("statusText");
const titleNudge = document.getElementById("titleNudge");
const saveWithPlaceholderButton = document.getElementById("saveWithPlaceholder");
const editTitleNowButton = document.getElementById("editTitleNow");
const refreshBridgeButton = document.getElementById("refreshBridge");
const captureSelectionButton = document.getElementById("captureSelection");
const newNoteButton = document.getElementById("newNote");
const saveNoteButton = document.getElementById("saveNote");

initialize().catch((error) => {
  renderStatus(`Initialisation failed: ${error.message}`);
});

async function applyTheme() {
  try {
    const response = await fetch("http://127.0.0.1:43119/theme");
    const payload = await response.json();
    if (payload?.theme?.cssVars) {
      const root = document.documentElement;
      for (const [prop, value] of Object.entries(payload.theme.cssVars)) {
        root.style.setProperty(prop, value);
      }
      root.dataset.themeId = payload.theme.id || "";
      root.dataset.themeDark = payload.theme.isDark ? "true" : "false";
    }
  } catch {
    // bridge offline or theme unavailable — fallback CSS vars stay in place
  }
}

async function initialize() {
  await Promise.all([applyTheme(), loadFolders()]);
  const draft = await getDraft();
  applyDraft(draft || createEmptyDraft());

  noteTitle.addEventListener("input", persistFormState);
  folderPath.addEventListener("change", persistFormState);
  refStyle.addEventListener("change", persistFormState);
  noteBody.addEventListener("input", persistFormState);
  usePageTitleButton.addEventListener("click", useActivePageTitle);
  saveWithPlaceholderButton.addEventListener("click", () => saveNoteToBridge({ allowPlaceholder: true }));
  editTitleNowButton.addEventListener("click", focusTitleForEdit);
  refreshBridgeButton.addEventListener("click", loadFolders);
  captureSelectionButton.addEventListener("click", captureSelection);
  newNoteButton.addEventListener("click", resetDraft);
  saveNoteButton.addEventListener("click", saveNoteToBridge);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      applyDraft(changes[STORAGE_KEY].newValue);
    }
  });
}

async function loadFolders() {
  try {
    const payload = await window.cvClipBridge.listFolders();
    folderPath.innerHTML = "";

    for (const folder of payload.folders) {
      const option = document.createElement("option");
      option.value = folder;
      option.textContent = folder;
      folderPath.appendChild(option);
    }

    renderStatus(`Bridge online. Notes root: ${payload.root}`);
  } catch (error) {
    renderStatus(`Bridge offline: ${error.message}`);
  }
}

async function captureSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      renderStatus("No active tab found.");
      return;
    }

    const clip = await chrome.tabs.sendMessage(tab.id, {
      type: "cvclip:capture-selection"
    });

    if (!clip?.text) {
      renderStatus("No page selection found.");
      return;
    }

    const currentDraft = (await getDraft()) || createEmptyDraft();
    const preparedDraft = {
      ...currentDraft,
      title: getEffectiveTitle(noteTitle.value || currentDraft.title),
      folderPath: folderPath.value || currentDraft.folderPath
    };
    const persisted = await window.cvClipBridge.appendClip(preparedDraft, clip);
    const nextDraft = {
      ...persisted.draft,
      status: `Captured selection from ${clip.title || clip.url || "page"} and saved to ${persisted.note.relativeNotePath}`,
      updatedAt: new Date().toISOString()
    };

    applyDraft(nextDraft);
    await chrome.storage.local.set({ [STORAGE_KEY]: nextDraft });
  } catch (error) {
    renderStatus(`Selection capture failed: ${error.message}`);
  }
}

async function saveNoteToBridge(options = {}) {
  const storedDraft = (await getDraft()) || createEmptyDraft();
  const draft = getDraftFromForm(storedDraft);
  if (!options.allowPlaceholder && shouldShowSaveTitleNudge(draft)) {
    showTitleNudge();
    renderStatus("Title still uses the placeholder. Save anyway or edit the title.");
    return;
  }

  hideTitleNudge();
  try {
    const saveDraft = options.allowPlaceholder
      ? {
          ...draft,
          title: getEffectiveTitle(draft.title)
        }
      : draft;
    const note = saveDraft.savedNote?.id
      ? await window.cvClipBridge.updateNote(saveDraft)
      : await window.cvClipBridge.createNote(saveDraft);

    const nextDraft = {
      ...saveDraft,
      savedNote: note,
      status: `Saved ${note.relativeNotePath}`,
      updatedAt: new Date().toISOString()
    };
    applyDraft(nextDraft);
    await chrome.storage.local.set({ [STORAGE_KEY]: nextDraft });
  } catch (error) {
    renderStatus(`Save failed: ${error.message}`);
  }
}

async function persistFormState() {
  const storedDraft = (await getDraft()) || createEmptyDraft();
  const draft = getDraftFromForm(storedDraft);
  draft.status = draft.savedNote
    ? "Draft updated locally; bridge save pending"
    : "Draft updated locally";
  draft.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: draft });
  hideTitleNudge();

  if (!draft.savedNote?.id) {
    return;
  }

  clearTimeout(persistFormState.timerId);
  persistFormState.timerId = setTimeout(async () => {
    try {
      const latestDraft = (await getDraft()) || draft;
      const note = await window.cvClipBridge.updateNote(latestDraft);
      const nextDraft = {
        ...latestDraft,
        savedNote: note,
        status: `Autosaved ${note.relativeNotePath}`,
        updatedAt: new Date().toISOString()
      };
      applyDraft(nextDraft);
      await chrome.storage.local.set({ [STORAGE_KEY]: nextDraft });
    } catch (error) {
      renderStatus(`Autosave failed: ${error.message}`);
    }
  }, 500);
}

async function resetDraft() {
  const draft = createEmptyDraft();
  applyDraft(draft);
  await chrome.storage.local.set({ [STORAGE_KEY]: draft });
  hideTitleNudge();
  renderStatus("Started a new clipping draft.");
}

async function useActivePageTitle() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageTitle = String(tab?.title || "").trim();
    if (!pageTitle) {
      renderStatus("Could not read the active page title.");
      return;
    }

    noteTitle.value = pageTitle;
    await persistFormState();
    renderStatus(`Using page title: ${pageTitle}`);
  } catch (error) {
    renderStatus(`Page title lookup failed: ${error.message}`);
  }
}

function focusTitleForEdit() {
  hideTitleNudge();
  noteTitle.focus();
  noteTitle.select();
  renderStatus("Edit the note title, then save when ready.");
}

function createEmptyDraft() {
  return {
    title: "",
    folderPath: "clips",
    refStyle: "none",
    body: "",
    sources: {},
    savedNote: null,
    status: "Ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function applyDraft(draft) {
  noteTitle.value = getTitleFieldValue(draft);
  noteTitle.placeholder = DEFAULT_PLACEHOLDER_TITLE;
  noteBody.value = draft.body || "";
  if (folderPath.options.length > 0) {
    folderPath.value = draft.folderPath || "clips";
  }
  refStyle.value = draft.refStyle || "none";
  renderStatus(draft.status || "Ready");
}

function getDraftFromForm(existingDraft = {}) {
  return {
    title: getTitleFieldValue({ title: noteTitle.value }),
    folderPath: folderPath.value || "clips",
    refStyle: refStyle.value || "none",
    body: noteBody.value,
    status: statusText.textContent,
    savedNote: existingDraft.savedNote || null,
    sources: existingDraft.sources || {}
  };
}

async function getDraft() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return result[STORAGE_KEY] || null;
}

function renderStatus(message) {
  statusText.textContent = message;
}

function showTitleNudge() {
  titleNudge.classList.remove("hidden");
}

function hideTitleNudge() {
  titleNudge.classList.add("hidden");
}
