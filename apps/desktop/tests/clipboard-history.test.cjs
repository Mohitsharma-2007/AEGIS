const test = require('node:test');
const assert = require('node:assert/strict');
const { appendClipboardText, isSensitiveClipboardText, MAX_ITEMS } = require('../clipboard-history');

test('clipboard history ignores empty, oversized, and sensitive-looking text', () => {
  assert.equal(appendClipboardText([], '   ').added, false);
  assert.equal(appendClipboardText([], 'API key: abc123').added, false);
  assert.equal(isSensitiveClipboardText('4111 1111 1111 1111'), true);
  assert.equal(appendClipboardText([], 'x'.repeat(4001)).added, false);
});

test('clipboard history deduplicates the latest item and retains only 30 newest clips', () => {
  const first = appendClipboardText([], 'notes', 1);
  assert.equal(appendClipboardText(first.history, 'notes', 2).added, false);
  let history = first.history;
  for (let i = 0; i < MAX_ITEMS + 5; i++) history = appendClipboardText(history, `clip ${i}`, i + 2).history;
  assert.equal(history.length, MAX_ITEMS);
  assert.equal(history[0].text, 'clip 34');
});
