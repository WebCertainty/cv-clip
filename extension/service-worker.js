const STORAGE_KEY = "cvClipActiveDraft";
importScripts("shared/bridge-client.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "cvclip-add-selection",
    title: "Add selection to CV CLIP",
    contexts: ["selection"]
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "cvclip-add-selection" || !tab?.id) {
    return;
  }

  await captureSelectionIntoDraft(tab.id, tab.windowId);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-selection-to-cv-clip") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  await captureSelectionIntoDraft(tab.id, tab.windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cvclip:get-active-draft") {
    return false;
  }

  chrome.storage.local.get([STORAGE_KEY]).then((result) => {
    sendResponse(result[STORAGE_KEY] || null);
  });

  return true;
});

async function captureSelectionIntoDraft(tabId, windowId) {
  // Always open the panel so the user gets feedback regardless of outcome.
  if (windowId && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId }).catch(() => {});
  }

  try {
    // Try sending to the content script. If the tab was open before the
    // extension loaded the content script won't be present — inject it first.
    let clip;
    try {
      clip = await chrome.tabs.sendMessage(tabId, {
        type: "cvclip:capture-selection"
      });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/selection.js"]
      });
      clip = await chrome.tabs.sendMessage(tabId, {
        type: "cvclip:capture-selection"
      });
    }

    if (!clip?.text) {
      await setStatus("No text selection found on the current page.");
      return;
    }

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const draft = result[STORAGE_KEY] || createEmptyDraft();
    const persisted = await self.cvClipBridge.appendClip(draft, clip);
    const nextDraft = {
      ...persisted.draft,
      lastClip: clip,
      updatedAt: new Date().toISOString(),
      status: `Captured selection from ${clip.title || clip.url || "page"} and saved to ${persisted.note.relativeNotePath}`
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: nextDraft });
  } catch (error) {
    await setStatus(`Capture failed: ${error.message}`);
  }
}

function createEmptyDraft() {
  return {
    title: "Untitled clipping note",
    folderPath: "clips",
    body: "",
    sources: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "Ready"
  };
}

async function setStatus(status) {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  const draft = result[STORAGE_KEY] || createEmptyDraft();
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...draft,
      status,
      updatedAt: new Date().toISOString()
    }
  });
}
