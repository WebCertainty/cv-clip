(function attachCvClipTitleLogic(globalScope) {
  const DEFAULT_PLACEHOLDER_TITLE = "Untitled clipping note";

  function normalizeTitle(value) {
    return String(value || "").trim();
  }

  function isPlaceholderTitle(value) {
    const normalized = normalizeTitle(value);
    return !normalized || normalized === DEFAULT_PLACEHOLDER_TITLE;
  }

  function getEffectiveTitle(value) {
    const normalized = normalizeTitle(value);
    return normalized || DEFAULT_PLACEHOLDER_TITLE;
  }

  function shouldShowSaveTitleNudge(draft) {
    return isPlaceholderTitle(draft?.title);
  }

  function getTitleFieldValue(draft) {
    return normalizeTitle(draft?.title);
  }

  const api = {
    DEFAULT_PLACEHOLDER_TITLE,
    getEffectiveTitle,
    getTitleFieldValue,
    isPlaceholderTitle,
    shouldShowSaveTitleNudge
  };

  globalScope.cvClipTitleLogic = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof self !== "undefined" ? self : globalThis);
