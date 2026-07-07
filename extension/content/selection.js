chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "cvclip:capture-selection") {
    return false;
  }

  const selection = window.getSelection();
  const text = selection ? String(selection).trim() : "";

  sendResponse({
    text,
    title: document.title,
    url: window.location.href
  });

  return false;
});
