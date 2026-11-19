import { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  FileCode,
  FileArchive,
  Image,
  Search,
  List,
  GitGraph,
  Eye,
  HardDrive,
  MessageSquare,
  Monitor,
  X,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Folder,
} from 'lucide-react';

export interface WorkspaceFileItem {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  lastModified: string;
  chatGroup: string;
  chatId: string;
  kind: 'code' | 'doc' | 'config' | 'archive' | 'image' | 'text';
  previewText?: string;
  previewKind?: 'text' | 'text-too-large' | 'image' | 'video' | 'pdf' | 'office' | 'unavailable';
  internal?: boolean;
  previewUrl?: string;
  /** Real on-disk files can be opened; generated pages are app routes. */
  downloadUrl?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(kind: WorkspaceFileItem['kind']) {
  switch (kind) {
    case 'code':
      return <FileCode size={16} className="file-kind-icon code" style={{ color: '#5fd3a0', flexShrink: 0 }} />;
    case 'doc':
      return <FileText size={16} className="file-kind-icon doc" style={{ color: '#d96b52', flexShrink: 0 }} />;
    case 'archive':
      return <FileArchive size={16} className="file-kind-icon archive" style={{ color: '#a78bfa', flexShrink: 0 }} />;
    case 'image':
      return <Image size={16} className="file-kind-icon image" style={{ color: '#38bdf8', flexShrink: 0 }} />;
    case 'config':
      return <Folder size={16} className="file-kind-icon config" style={{ color: '#f5b544', flexShrink: 0 }} />;
    default:
      return <FileText size={16} className="file-kind-icon text" style={{ color: '#cbd5e1', flexShrink: 0 }} />;
  }
}

function getCategoryLabel(kind: WorkspaceFileItem['kind']) {
  switch (kind) {
    case 'code':
      return 'Code & Scripts';
    case 'doc':
      return 'Documents & Markdown';
    case 'archive':
      return 'Archives & Bundles';
    case 'image':
      return 'Images & Screenshots';
    case 'config':
      return 'Config & Data';
    default:
      return 'Other Files';
  }
}

export interface FilesSurfaceProps {
  initialFiles?: WorkspaceFileItem[];
}

export function FilesSurfaceView({ initialFiles }: FilesSurfaceProps = {}) {
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('list');
  const [groupBy, setGroupBy] = useState<'chat' | 'category'>('chat');

  // Generated run dumps (raw/sse/audit/trace artifacts) are hidden by
  // default so the manager shows the documents the user cares about; the
  // toggle reveals them when inspection is needed.
  const [hideInternal, setHideInternal] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileItem | null>(null);
  const [selectedChatFilter, setSelectedChatFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [files, setFiles] = useState<WorkspaceFileItem[]>(initialFiles || []);
  const [chats, setChats] = useState<Array<{ id: string; title: string }>>([]);
  const [preview, setPreview] = useState<{ kind: 'loading' | 'text' | 'text-too-large' | 'image' | 'video' | 'pdf' | 'office' | 'unavailable'; text?: string }>({ kind: 'unavailable' });
  const [copiedPath, setCopiedPath] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/files/surface')
      .then((response) => (response.ok ? response.json() : { files: [], chats: [] }))
      .then((data: { files: WorkspaceFileItem[]; chats: Array<{ id: string; title: string }> }) => {
        if (!active) return;
        if (data.files?.length) setFiles(data.files);
        if (data.chats?.length) setChats(data.chats);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedFile) { setPreview({ kind: 'unavailable' }); return; }
    if (!selectedFile.previewUrl) {
      setPreview({ kind: selectedFile.previewKind === 'office' ? 'text' : (selectedFile.previewKind || 'text'), text: selectedFile.previewText });
      return;
    }
    const controller = new AbortController();
    setPreview({ kind: 'loading' });
    fetch(selectedFile.previewUrl, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { previewKind: 'unavailable' })
      .then((data: { previewKind?: WorkspaceFileItem['previewKind']; previewText?: string }) => {
        if (!controller.signal.aborted) setPreview({ kind: data.previewKind === 'office' ? 'text' : (data.previewKind || 'unavailable'), text: data.previewText });
      })
      .catch(() => { if (!controller.signal.aborted) setPreview({ kind: 'unavailable' }); });
    return () => controller.abort();
  }, [selectedFile]);

  const copyPath = (path: string) => {
    if (!path) return;
    navigator.clipboard?.writeText(path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const chatGroups = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => set.add(f.chatGroup));
    for (const chat of chats) {
      set.add(`Chat: ${chat.title}`);
    }
    return Array.from(set);
  }, [files, chats]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (hideInternal && f.internal) return false;
      if (selectedChatFilter !== 'all' && f.chatGroup !== selectedChatFilter) {
        return false;
      }
      if (selectedCategoryFilter !== 'all' && f.kind !== selectedCategoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.chatGroup.toLowerCase().includes(q)
      );
    });
  }, [search, selectedChatFilter, selectedCategoryFilter, files, hideInternal]);

  const totalBytes = useMemo(() => {
    return files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
  }, [files]);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkspaceFileItem[]>();
    if (groupBy === 'chat') {
      filteredFiles.forEach((file) => {
        const existing = map.get(file.chatGroup) || [];
        existing.push(file);
        map.set(file.chatGroup, existing);
      });
      for (const groupName of chatGroups) {
        if (!map.has(groupName)) map.set(groupName, []);
      }
    } else {
      // Group by category
      const categories: WorkspaceFileItem['kind'][] = ['doc', 'code', 'config', 'image', 'archive', 'text'];
      categories.forEach((cat) => {
        const matching = filteredFiles.filter((f) => f.kind === cat);
        if (matching.length > 0 || selectedCategoryFilter === cat) {
          map.set(getCategoryLabel(cat), matching);
        }
      });
      // Any remaining files
      const other = filteredFiles.filter((f) => !categories.includes(f.kind));
      if (other.length > 0) {
        map.set('Other Files', other);
      }
    }
    return map;
  }, [filteredFiles, groupBy, chatGroups, selectedCategoryFilter]);

  return (
    <div className="files-surface-hub">
      {/* Top Hub Bar */}
      <div className="files-hub-header">
        <div className="hub-title-block">
          <div className="hub-badge">
            <HardDrive size={16} />
            <strong>Workspace files</strong>
          </div>
          <p>Saved pages, generated documents, and artifacts produced across conversations.</p>
          <div className="hub-stats-row">
            <span className="hub-stat-pill">
              Total files: <b>{files.length}</b>
            </span>
            <span className="hub-stat-pill">
              Total size: <b>{formatBytes(totalBytes)}</b>
            </span>
            <span className="hub-stat-pill">
              Threads: <b>{chatGroups.length}</b>
            </span>
            {filteredFiles.length !== files.length && (
              <span className="hub-stat-pill" style={{ borderColor: '#d96b52', color: '#d96b52' }}>
                Showing: <b>{filteredFiles.length} files</b>
              </span>
            )}
          </div>
        </div>

        <div className="hub-controls-row">
          <div className="hub-search-box">
            <Search size={14} style={{ color: '#64748b', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search files, paths, or threads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{ background: 'transparent', border: 0, color: '#64748b', cursor: 'pointer', padding: 0 }}
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="hub-filter-group">
            <div className="hub-chat-select">
              <MessageSquare size={13} style={{ flexShrink: 0 }} />
              <select
                value={selectedChatFilter}
                onChange={(e) => setSelectedChatFilter(e.target.value)}
                aria-label="Filter by thread"
              >
                <option value="all">All Chat Threads</option>
                {chatGroups.map((cg) => (
                  <option key={cg} value={cg}>
                    {cg}
                  </option>
                ))}
              </select>
            </div>

            <div className="hub-category-pills">
              {(
                [
                  { id: 'all', label: 'All Types' },
                  { id: 'doc', label: 'Docs' },
                  { id: 'code', label: 'Code' },
                  { id: 'image', label: 'Images' },
                  { id: 'config', label: 'Data' },
                  { id: 'archive', label: 'Archives' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`cat-pill-btn ${selectedCategoryFilter === cat.id ? 'active' : ''}`}
                  onClick={() => setSelectedCategoryFilter(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="hub-category-pills" style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className={`cat-pill-btn ${hideInternal ? 'active' : ''}`}
                onClick={() => setHideInternal((v) => !v)}
                title="Toggle internal run dumps (raw/sse/audit/trace artifacts)"
              >
                <FileText size={12} />
                <span>{hideInternal ? 'Runs hidden' : 'Runs shown'}</span>
              </button>
              <button
                type="button"
                className={`cat-pill-btn ${groupBy === 'chat' ? 'active' : ''}`}
                onClick={() => setGroupBy('chat')}
                title="Group by conversation thread"
              >
                <MessageSquare size={12} />
                <span>By Thread</span>
              </button>
              <button
                type="button"
                className={`cat-pill-btn ${groupBy === 'category' ? 'active' : ''}`}
                onClick={() => setGroupBy('category')}
                title="Group by file category"
              >
                <Layers size={12} />
                <span>By Type</span>
              </button>
            </div>

            <div className="hub-view-toggle">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="Structured Details List"
              >
                <List size={14} />
                <span>List</span>
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'graph' ? 'active' : ''}`}
                onClick={() => setViewMode('graph')}
                title="Relational Knowledge Graph View"
              >
                <GitGraph size={14} />
                <span>Graph</span>
              </button>
            </div>

            <button
              type="button"
              className="file-inspect-btn"
              title="Open raw workspace file editor in Computer view"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('aegis:nav', { detail: 'computer' }),
                )
              }
            >
              <Monitor size={13} />
              <span>File editor</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'list' ? (
        <div className="files-list-layout">
          <div className="files-groups-container">
            {grouped.size === 0 && (
              <div className="chat-file-group-card" style={{ padding: '36px 20px', textAlign: 'center' }}>
                <HardDrive size={24} style={{ color: '#64748b', margin: '0 auto 8px', display: 'block' }} />
                <strong style={{ display: 'block', color: 'var(--ink)', fontSize: '14px' }}>No matching workspace files</strong>
                <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '12px' }}>
                  {search || selectedCategoryFilter !== 'all' || selectedChatFilter !== 'all'
                    ? 'No files match your current filters. Clear filters or search term to see all files.'
                    : 'Generated documents and saved pages will appear here once created.'}
                </p>
              </div>
            )}
            {Array.from(grouped.entries()).map(([groupName, groupFiles]) => (
              <div key={groupName} className="chat-file-group-card">
                <div className="group-card-header">
                  <div className="group-title">
                    {groupBy === 'chat' ? (
                      <MessageSquare size={14} className="group-icon" />
                    ) : (
                      <Folder size={14} className="group-icon" />
                    )}
                    <strong>{groupName}</strong>
                    <span className="group-count-pill">
                      {groupFiles.length} file{groupFiles.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                <div className="files-table-wrapper">
                  <table className="files-table">
                    <thead>
                      <tr>
                        <th className="files-col-name">File Name</th>
                        <th className="files-col-kind">Type</th>
                        <th className="files-col-size">Size</th>
                        <th className="files-col-date">Last Modified</th>
                        <th className="files-col-path">Workspace Path</th>
                        <th className="files-col-act">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupFiles.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: '#64748b', padding: '16px' }}>
                            No files in this group.
                          </td>
                        </tr>
                      ) : (
                        groupFiles.map((file) => (
                          <tr
                            key={file.id}
                            className={`file-row ${selectedFile?.id === file.id ? 'selected' : ''}`}
                            onDoubleClick={() => {
                              if (file.downloadUrl) {
                                window.open(file.downloadUrl, '_blank', 'noopener');
                              }
                            }}
                            onClick={() => setSelectedFile(file)}
                          >
                            <td className="files-col-name">
                              <div className="file-name-cell">
                                {getFileIcon(file.kind)}
                                <span className="file-name" title={file.name}>
                                  {file.name}
                                </span>
                              </div>
                            </td>
                            <td className="files-col-kind">
                              <span className={`file-kind-badge ${file.kind}`}>{file.kind}</span>
                            </td>
                            <td className="files-col-size file-size-cell">{formatBytes(file.sizeBytes)}</td>
                            <td className="files-col-date file-date-cell">{file.lastModified}</td>
                            <td className="files-col-path file-path-cell" title={file.path}>
                              {file.path}
                            </td>
                            <td className="files-col-act" style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="file-inspect-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedFile(file);
                                }}
                              >
                                <Eye size={12} />
                                <span>Inspect</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Inspector Pane */}
          {selectedFile && (
            <div className="file-quick-inspector">
              <div className="inspector-head">
                <div className="inspector-title">
                  {getFileIcon(selectedFile.kind)}
                  <strong title={selectedFile.name}>{selectedFile.name}</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="inspector-size">{formatBytes(selectedFile.sizeBytes)}</span>
                  <button
                    type="button"
                    className="file-inspect-btn"
                    style={{ padding: '3px 6px', background: 'transparent', border: 0 }}
                    title="Close inspector"
                    aria-label="Close inspector"
                    onClick={() => setSelectedFile(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="inspector-meta-box">
                <div className="meta-line">
                  <span>Type & Category:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`file-kind-badge ${selectedFile.kind}`}>{selectedFile.kind}</span>
                    <strong style={{ fontSize: '11px' }}>{getCategoryLabel(selectedFile.kind)}</strong>
                  </div>
                </div>
                <div className="meta-line">
                  <span>Conversation Origin:</span>
                  <strong>{selectedFile.chatGroup}</strong>
                </div>
                <div className="meta-line">
                  <span>Last Modified:</span>
                  <strong>{selectedFile.lastModified}</strong>
                </div>
                <div className="meta-line">
                  <span>Workspace Path:</span>
                  <code className="path-code">{selectedFile.path}</code>
                </div>
              </div>

              <div className="inspector-actions-row">
                <button
                  type="button"
                  className="inspector-action-btn primary"
                  onClick={() => {
                    if (selectedFile.downloadUrl) {
                      window.open(selectedFile.downloadUrl, '_blank', 'noopener');
                    } else if (selectedFile.path.startsWith('/')) {
                      window.location.assign(selectedFile.path);
                    }
                  }}
                >
                  <ExternalLink size={12} />
                  <span>Open file</span>
                </button>
                <button
                  type="button"
                  className="inspector-action-btn"
                  onClick={() => copyPath(selectedFile.path)}
                  title="Copy workspace path to clipboard"
                >
                  {copiedPath ? <Check size={12} style={{ color: '#5fd3a0' }} /> : <Copy size={12} />}
                  <span>{copiedPath ? 'Copied' : 'Copy path'}</span>
                </button>
              </div>

              <div className="inspector-preview-box">
                <span className="preview-label">File Preview</span>
                {preview.kind === 'loading' ? (
                  <div role="status" style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>
                    Loading preview…
                  </div>
                ) : preview.kind === 'image' && selectedFile.downloadUrl ? (
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                    <img
                      src={selectedFile.downloadUrl}
                      alt={selectedFile.name}
                      loading="lazy"
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: '340px',
                        objectFit: 'contain',
                        margin: '0 auto',
                        borderRadius: '6px',
                      }}
                    />
                  </div>
                ) : preview.kind === 'video' && selectedFile.downloadUrl ? (
                  <div style={{ background: '#000', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                    <video
                      src={selectedFile.downloadUrl}
                      alt={selectedFile.name}
                      controls
                      style={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: '340px',
                        margin: '0 auto',
                        borderRadius: '6px',
                      }}
                    />
                  </div>
                ) : preview.kind === 'pdf' && selectedFile.downloadUrl ? (
                  <iframe
                    title={`Preview of ${selectedFile.name}`}
                    src={selectedFile.downloadUrl}
                    style={{
                      width: '100%',
                      height: '380px',
                      border: 0,
                      borderRadius: '6px',
                      background: '#fff',
                    }}
                  />
                ) : (preview.kind === 'doc' || preview.kind === 'office' || preview.kind === 'ppt' || preview.kind === 'xls') && selectedFile.downloadUrl ? (
                  <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                    <iframe
                      title={`Preview of ${selectedFile.name}`}
                      src={selectedFile.downloadUrl}
                      style={{
                        width: '100%',
                        height: '380px',
                        border: 0,
                        borderRadius: '6px',
                        background: '#fff',
                      }}
                    />
                    <p style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
                      Office document preview. If the document does not render, click "Open file" to download.
                    </p>
                  </div>
                ) : preview.kind === 'text' && preview.text !== undefined ? (
                  <pre className="preview-code">
                    {preview.text || '(This text file is empty.)'}
                  </pre>
                ) : (
                  <div
                    role="status"
                    style={{
                      padding: '14px',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      background: 'var(--bg)',
                    }}
                  >
                    <strong style={{ color: 'var(--ink)', fontSize: '12px', display: 'block' }}>
                      {preview.kind === 'text-too-large'
                        ? 'Preview truncated at 64 KB'
                        : 'Preview unavailable for this format'}
                    </strong>
                    <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '11px', lineHeight: '1.4' }}>
                      {preview.kind === 'text-too-large'
                        ? 'This file exceeds the 64 KB inline preview limit. Click "Open file" to inspect the complete content.'
                        : 'Binary, archive, and complex media files cannot be displayed inline. Click "Open file" to view in a compatible external application.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* GRAPH VIEW: Relational knowledge node graph with real edges */
        <div className="files-graph-view">
          <div className="graph-explanation-banner">
            <GitGraph size={15} />
            <span>Relational Map: Chat Conversations linked to Generated Documents & Artifacts</span>
          </div>

          <div className="relational-graph-canvas">
            {Array.from(grouped.entries()).map(([groupName, groupFiles]) => {
              const satellites = groupFiles.slice(0, 12);
              return (
                <div key={groupName} className="graph-cluster">
                  <svg className="graph-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {satellites.map((file, index) => {
                      const angle = (index / Math.max(1, satellites.length)) * Math.PI * 2 - Math.PI / 2;
                      const x = 50 + 40 * Math.cos(angle);
                      const y = 42 + 30 * Math.sin(angle);
                      return (
                        <line
                          key={file.id}
                          x1="50"
                          y1="42"
                          x2={x}
                          y2={y}
                          className="graph-edge-line"
                        />
                      );
                    })}
                  </svg>

                  <div className="cluster-chat-hub">
                    <div className="chat-hub-circle">
                      <MessageSquare size={16} />
                    </div>
                    <strong className="chat-hub-title">{groupName.replace('Chat: ', '')}</strong>
                    <span className="hub-file-count">
                      {satellites.length} file{satellites.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="cluster-satellites">
                    {satellites.map((file, index) => {
                      const angle = (index / Math.max(1, satellites.length)) * Math.PI * 2 - Math.PI / 2;
                      const left = 50 + 40 * Math.cos(angle);
                      const top = 42 + 30 * Math.sin(angle);
                      return (
                        <div
                          key={file.id}
                          className={`satellite-node ${selectedFile?.id === file.id ? 'active' : ''}`}
                          style={{ left: `${left}%`, top: `${top}%` }}
                          onClick={() => setSelectedFile(file)}
                        >
                          <div className="satellite-card">
                            {getFileIcon(file.kind)}
                            <span className="sat-name">{file.name}</span>
                            <small className="sat-size">{formatBytes(file.sizeBytes)}</small>
                          </div>
                        </div>
                      );
                    })}
                    {satellites.length === 0 && (
                      <p className="graph-empty-note">No files generated in this group yet.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
