const path = require("path");

const {
  DEFAULT_PLACEHOLDER_TITLE,
  getEffectiveTitle,
  getTitleFieldValue,
  isPlaceholderTitle,
  shouldShowSaveTitleNudge
} = require(path.join(
  __dirname,
  "..",
  "extension",
  "shared",
  "title-logic.js"
));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(DEFAULT_PLACEHOLDER_TITLE === "Untitled clipping note", "Unexpected placeholder title.");
assert(isPlaceholderTitle(""), "Blank title should count as placeholder.");
assert(isPlaceholderTitle("Untitled clipping note"), "Default title should count as placeholder.");
assert(!isPlaceholderTitle("Actual working title"), "Custom title should not count as placeholder.");
assert(getEffectiveTitle("") === "Untitled clipping note", "Blank title should resolve to placeholder.");
assert(getEffectiveTitle("Research note") === "Research note", "Custom title should be preserved.");
assert(getTitleFieldValue({ title: "" }) === "", "Blank draft title should keep input empty.");
assert(getTitleFieldValue({ title: "Research note" }) === "Research note", "Title field should show custom title.");
assert(shouldShowSaveTitleNudge({ title: "" }), "Blank title should show save nudge.");
assert(shouldShowSaveTitleNudge({ title: "Untitled clipping note" }), "Placeholder title should show save nudge.");
assert(!shouldShowSaveTitleNudge({ title: "Research note" }), "Custom title should not show save nudge.");

process.stdout.write(
  "Title logic behavior test passed. Placeholder, effective title, and save-nudge rules behave as expected.\n"
);
