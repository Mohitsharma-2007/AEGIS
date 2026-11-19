const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FILES = 25;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_DROP_BYTES = 1024 * 1024 * 1024;

function safeName(filePath) {
  return path.basename(filePath).replace(/[<>:"|?*\\/\x00-\x1f]/g, '-').slice(-140) || 'file';
}

async function importDroppedFiles(inputPaths, uploadsDir) {
  const candidates = Array.isArray(inputPaths) ? inputPaths : [];
  if (!candidates.length) return { files: [], rejected: [], error: 'No files supplied.' };
  await fs.mkdir(uploadsDir, { recursive: true });
  const files = [];
  const rejected = [];
  let totalBytes = 0;
  for (const rawPath of candidates.slice(0, MAX_FILES)) {
    try {
      if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) throw new Error('Invalid file path.');
      const sourcePath = await fs.realpath(rawPath);
      const info = await fs.stat(sourcePath);
      if (!info.isFile()) throw new Error('Only individual files can be added.');
      if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_DROP_BYTES)
        throw new Error('File tray limit is 512 MB per file and 1 GB per drop.');
      const targetPath = path.join(uploadsDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(sourcePath)}`);
      await fs.copyFile(sourcePath, targetPath, require('node:fs').constants.COPYFILE_EXCL);
      totalBytes += info.size;
      files.push({ name: path.basename(targetPath), path: targetPath, sizeBytes: info.size });
    } catch (error) {
      rejected.push(error instanceof Error ? error.message : 'Could not add this file.');
    }
  }
  if (candidates.length > MAX_FILES) rejected.push(`Only the first ${MAX_FILES} files were checked; split the rest into another drop.`);
  return { files, rejected, error: files.length ? undefined : (rejected[0] || 'No files were added.') };
}

module.exports = { importDroppedFiles, MAX_FILES, MAX_FILE_BYTES, MAX_DROP_BYTES };
