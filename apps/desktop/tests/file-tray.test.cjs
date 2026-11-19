const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { importDroppedFiles, MAX_FILES } = require('../file-tray');

test('imports regular files of different types into the persistent tray directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-file-tray-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'uploads');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'photo.png'), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(source, 'data.odd-extension'), 'text');
  try {
    const result = await importDroppedFiles([
      path.join(source, 'photo.png'),
      path.join(source, 'data.odd-extension'),
    ], target);
    assert.equal(result.files.length, 2);
    assert.deepEqual(await fs.readFile(result.files[0].path), Buffer.from([1, 2, 3]));
    assert.equal(await fs.readFile(result.files[1].path, 'utf8'), 'text');
    assert.equal(result.files.every((file) => file.path.startsWith(target)), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejects directories and bounds excessive drops', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-file-tray-'));
  const folder = path.join(root, 'folder');
  await fs.mkdir(folder);
  try {
    const result = await importDroppedFiles([folder, ...Array(MAX_FILES + 1).fill(folder)], path.join(root, 'uploads'));
    assert.equal(result.files.length, 0);
    assert.match(result.rejected[0], /individual files/);
    assert.match(result.rejected.at(-1), /first 25 files/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
