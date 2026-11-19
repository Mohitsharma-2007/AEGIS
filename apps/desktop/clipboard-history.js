const MAX_ITEMS = 30;
const MAX_TEXT_LENGTH = 4000;

function isSensitiveClipboardText(text) {
  return /(?:password|passcode|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|bearer\s|private key|recovery code|one[- ]time code)/i.test(text)
    || /\b(?:\d[ -]*?){13,19}\b/.test(text);
}

function appendClipboardText(history, text, at = Date.now()) {
  const value = String(text ?? '').trim();
  if (!value || value.length > MAX_TEXT_LENGTH || isSensitiveClipboardText(value)) return { history, added: false };
  if (history[0]?.text === value) return { history, added: false };
  return { history: [{ text: value, at }, ...history].slice(0, MAX_ITEMS), added: true };
}

module.exports = { appendClipboardText, isSensitiveClipboardText, MAX_ITEMS, MAX_TEXT_LENGTH };
