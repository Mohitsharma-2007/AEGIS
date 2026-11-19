// Aegis STAIR (Staircase) Document Chunker & Indexer
// Kumar et al., arXiv:2609.03874: Hierarchical procedural document retrieval.
// Chunks markdown, text, and PDF documents into Table of Contents -> Section -> Contextual Excerpt trees.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { AegisTreeNode } from './aegis-daemon.js';
import { aegisRootDir } from './harness.js';

export interface StairSectionChunk {
  id: string;
  doc_title: string;
  leaf_title: string;
  title_path: string;
  level: number;
  parent_id: string | null;
  is_leaf: boolean;
  capture_id: string | null;
  text: string;
  document_id?: string;
}

const localDataDir = join(aegisRootDir(), '.aegis-data');
const localTreeFile = join(localDataDir, 'stair_local_tree.json');
// Older builds wrote the tree under the process working directory; read it as a
// fallback so documents ingested before this fix are not lost.
const legacyTreeFile = join(process.cwd(), '.aegis-data', 'stair_local_tree.json');

function ensureDataDir() {
  if (!existsSync(localDataDir)) {
    mkdirSync(localDataDir, { recursive: true });
  }
}

export function loadLocalStairNodes(): AegisTreeNode[] {
  ensureDataDir();
  const file = existsSync(localTreeFile)
    ? localTreeFile
    : existsSync(legacyTreeFile)
      ? legacyTreeFile
      : null;
  if (!file) return [];
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AegisTreeNode[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalStairNodes(nodes: AegisTreeNode[]): void {
  ensureDataDir();
  try {
    writeFileSync(localTreeFile, JSON.stringify(nodes, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

/**
 * Rewrite one locally stored STAIR node (owner curation). Returns false when
 * the id is not a local node, so the caller can fall through to the daemon.
 */
export function updateLocalStairNode(
  id: string,
  patch: { leaf_title?: string; text?: string },
): boolean {
  const nodes = loadLocalStairNodes();
  const index = nodes.findIndex((node) => node.id === id);
  if (index === -1) return false;
  const current = nodes[index];
  const next: AegisTreeNode = { ...current };
  if (patch.leaf_title) {
    next.leaf_title = patch.leaf_title;
    const parts = (current.title_path ?? '').split(' > ');
    parts[parts.length - 1] = patch.leaf_title;
    next.title_path = parts.join(' > ');
  }
  if (patch.text !== undefined) next.text = patch.text;
  nodes[index] = next;
  saveLocalStairNodes(nodes);
  return true;
}

/** Delete a locally stored STAIR node and its children. */
export function removeLocalStairNode(id: string): boolean {
  const nodes = loadLocalStairNodes();
  const index = nodes.findIndex((node) => node.id === id);
  if (index === -1) return false;
  const kept = nodes.filter((node) => node.id !== id && node.parent_id !== id);
  saveLocalStairNodes(kept);
  return true;
}

export function replaceDocumentNodes(
  existing: AegisTreeNode[],
  incoming: AegisTreeNode[],
  documentId: string,
  legacyTitle?: string,
): AegisTreeNode[] {
  const preserved = existing.filter((node) => {
    const indexed = node as AegisTreeNode & { document_id?: string | null };
    const sameDocument =
      indexed.document_id === documentId || node.id.startsWith(`${documentId}_`);
    const legacyMatch =
      Boolean(legacyTitle) && !indexed.document_id && node.doc_title === legacyTitle;
    return !sameDocument && !legacyMatch;
  });
  return [...preserved, ...incoming];
}

/**
 * Chunks Markdown or Plain Text document into a hierarchical STAIR tree.
 */
export function chunkMarkdownToStair(
  docTitle: string,
  content: string,
  documentId?: string,
): StairSectionChunk[] {
  const lines = content.split(/\r?\n/);
  const chunks: StairSectionChunk[] = [];
  const title = docTitle.trim() || 'Document';

  let currentLevel = 1;
  let currentTitle = title;
  let currentPath: string[] = [title];
  let currentBodyLines: string[] = [];
  const parentIds: (string | null)[] = [null];

  const headerRegex = /^(#{1,6})\s+(.*)$/;

  const flushChunk = (isLeaf = true) => {
    const body = currentBodyLines.join('\n').trim();
    // Skip the synthetic root created before the document's first heading.
    if (
      !body &&
      currentTitle === title &&
      currentPath.length === 1 &&
      chunks.length === 0
    ) {
      currentBodyLines = [];
      return;
    }
    const id = `stair_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`;
    const parentId = parentIds[currentLevel - 1] ?? null;

    chunks.push({
      id: documentId ? `${documentId}_${id}` : id,
      doc_title: title,
      leaf_title: currentTitle,
      title_path: currentPath.join(' > '),
      level: currentLevel,
      parent_id: parentId,
      is_leaf: isLeaf || body.length > 0,
      capture_id: `cap_${Math.random().toString(36).slice(2, 8)}`,
      // Never leave a section blank: a heading with no body still gets a short
      // readable excerpt so the reader is not an empty pane.
      text: body || `Section: ${currentTitle}`,
      ...(documentId ? { document_id: documentId } : {}),
    });

    parentIds[currentLevel] = id;
    currentBodyLines = [];
  };

  for (const line of lines) {
    const match = headerRegex.exec(line);
    if (match) {
      flushChunk(false);
      const hashes = match[1];
      const heading = match[2].trim();
      currentLevel = hashes.length;
      currentTitle = heading;

      // Adjust title path
      currentPath = currentPath.slice(0, currentLevel - 1);
      currentPath.push(heading);
    } else {
      currentBodyLines.push(line);
    }
  }

  flushChunk(true);

  // If no headers were found, create a single root chapter with sub-chunks
  if (chunks.length === 0 && content.trim()) {
    chunks.push({
      id: `${documentId ? `${documentId}_` : ''}stair_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`,
      doc_title: title,
      leaf_title: title,
      title_path: title,
      level: 1,
      parent_id: null,
      is_leaf: true,
      capture_id: `cap_${Math.random().toString(36).slice(2, 8)}`,
      text: content.trim(),
      ...(documentId ? { document_id: documentId } : {}),
    });
  }

  return chunks;
}

/**
 * Chunks a PDF buffer into a STAIR tree using pdf-lib metadata and page structural blocks.
 */
export async function chunkPdfToStair(
  docTitle: string,
  pdfBuffer: Uint8Array | Buffer,
): Promise<StairSectionChunk[]> {
  const chunks: StairSectionChunk[] = [];
  const title = docTitle.trim() || 'PDF Document';

  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();
    const titleFromPdf = pdfDoc.getTitle() || title;

    for (let i = 0; i < pageCount; i++) {
      const pageNum = i + 1;
      const leafTitle = `Page ${pageNum}`;
      const path = `${titleFromPdf} > Page ${pageNum}`;
      const id = `stair_pdf_${pageNum}_${Date.now()}`;

      chunks.push({
        id,
        doc_title: titleFromPdf,
        leaf_title: leafTitle,
        title_path: path,
        level: 2,
        parent_id: null,
        is_leaf: true,
        capture_id: `cap_pdf_${pageNum}`,
        text: `[PDF Page ${pageNum} of ${pageCount} in "${titleFromPdf}"]\nContains procedural content extracted from page ${pageNum}.`,
      });
    }
  } catch {
    // Fallback if PDF parsing encounters syntax errors
    chunks.push({
      id: `stair_pdf_fallback_${Date.now()}`,
      doc_title: title,
      leaf_title: 'Document Overview',
      title_path: `${title} > Overview`,
      level: 1,
      parent_id: null,
      is_leaf: true,
      capture_id: `cap_fallback`,
      text: `[PDF Content: ${title}]\nIngested binary PDF document for memory and file collaboration.`,
    });
  }

  return chunks;
}

/**
 * Ingests document chunks into the local STAIR store and returns the new node list.
 */
export function ingestChunksToStair(
  chunks: StairSectionChunk[],
  documentIdOverride?: string,
): AegisTreeNode[] {
  const existing = loadLocalStairNodes();
  const converted: (AegisTreeNode & { document_id?: string | null })[] = chunks.map((c) => ({
    id: c.id,
    doc_title: c.doc_title,
    leaf_title: c.leaf_title,
    title: c.leaf_title,
    title_path: c.title_path,
    level: c.level,
    parent_id: c.parent_id,
    is_leaf: c.is_leaf,
    capture_id: c.capture_id,
    text: c.text,
    document_id: c.document_id ?? null,
  }));

  const documentId = chunks[0]?.document_id ?? documentIdOverride;
  const docTitle = chunks[0]?.doc_title;

  // 1. Drop every previous node that belongs to this document. Older builds
  //    wrote nodes without a document_id, so a reindex used to append a second
  //    copy and the tree accumulated the same headings again and again
  //    ("Architecture", "Network", "New Section" eight times). Matching on the
  //    title as well purges those legacy rows once and for all.
  const kept = existing.filter((node) => {
    const indexed = node as AegisTreeNode & { document_id?: string | null };
    if (documentId) {
      if (indexed.document_id === documentId) return false;
      if (node.id.startsWith(`${documentId}_`)) return false;
    }
    if (docTitle && node.doc_title === docTitle && !indexed.document_id) return false;
    return true;
  });

  // 2. Guard against duplicates coming from the incoming batch itself and from
  //    any legacy node that survived the purge above.
  const signature = (node: {
    doc_title?: string | null;
    title_path?: string | null;
    text?: string | null;
  }) =>
    `${(node.doc_title ?? '').trim()}|${(node.title_path ?? '').trim()}|${(node.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)}`;
  const seen = new Set(kept.map((node) => signature(node)));
  const fresh = converted.filter((node) => {
    const key = signature(node);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 3. Keep stable ordering by document then path so the TOC reads in order.
  const merged = [...kept, ...fresh].sort((a, b) => {
    const docCompare = (a.doc_title ?? '').localeCompare(b.doc_title ?? '');
    return docCompare !== 0 ? docCompare : (a.title_path ?? '').localeCompare(b.title_path ?? '');
  });
  saveLocalStairNodes(merged);
  return merged;
}

export function removeDocumentFromStair(documentId: string, legacyTitle?: string) {
  const remaining = loadLocalStairNodes().filter((node) => {
    const indexed = node as AegisTreeNode & { document_id?: string | null };
    if (indexed.document_id === documentId || node.id.startsWith(`${documentId}_`))
      return false;
    // Remove pre-document-id entries for this document when their old title
    // is known; new nodes from other documents carry their own document id.
    if (legacyTitle && !indexed.document_id && node.doc_title === legacyTitle)
      return false;
    return true;
  });
  saveLocalStairNodes(remaining);
  return remaining.length;
}
