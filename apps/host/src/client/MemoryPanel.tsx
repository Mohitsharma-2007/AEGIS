import { useEffect, useState, useMemo } from 'react';
import {
  Search,
  Network,
  Copy,
  Check,
  FileText,
  Sparkles,
  Brain,
  UploadCloud,
  X,
  AlertCircle,
  Database,
  RefreshCw,
  Tag,
  ArrowRight,
  User,
  Trash2,
} from 'lucide-react';
import type {
  AegisCaptureItem,
  AegisGraphResponse,
  AegisMemoryStateResponse,
  AegisMemorySearchResponse,
  HostMemory,
  MemoryDocumentItem,
} from './api';

type MemoryTab = 'overview' | 'personal' | 'graph' | 'rag' | 'documents';

// Personal Memory must never render vault ciphertext. The onboarding vault
// entry stores AES-GCM blobs plus a password hash; those are secrets, not
// readable facts, so they are filtered out everywhere they could surface.
const isEncryptedMemory = (text: string) =>
  text.includes('[ENCRYPTED_VAULT]') ||
  /encrypted(phone|address)\s*:/i.test(text) ||
  /passwordhash\s*:/i.test(text);

interface IdentityProfile {
  name: string;
  gmail: string;
  address: string;
}

// The readable identity the owner asked Personal Memory to show: only their
// name, Gmail and address. Sourced from the plaintext fields on the local
// vault record, an explicit `aegis:user:identity` entry, and any readable
// profile memory already saved.
function readStoredIdentity(): IdentityProfile {
  const identity: IdentityProfile = { name: '', gmail: '', address: '' };
  try {
    const raw = localStorage.getItem('aegis:user:identity');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IdentityProfile>;
      identity.name = parsed.name ?? '';
      identity.gmail = parsed.gmail ?? '';
      identity.address = parsed.address ?? '';
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = localStorage.getItem('aegis:user:vault');
    if (raw) {
      const vault = JSON.parse(raw) as { name?: string; gmailId?: string };
      identity.name = identity.name || vault.name || '';
      identity.gmail = identity.gmail || vault.gmailId || '';
    }
  } catch {
    /* ignore */
  }
  return identity;
}

function identityFromMemories(memories: HostMemory[]): IdentityProfile {
  const profile: IdentityProfile = { name: '', gmail: '', address: '' };
  for (const memory of memories) {
    if (isEncryptedMemory(memory.text)) continue;
    const name = /Name:\s*([^;.\n]+)/i.exec(memory.text);
    const gmail = /Gmail:\s*([^;.\n]+)/i.exec(memory.text);
    const address = /(?:Address|Location):\s*([^;.\n]+)/i.exec(memory.text);
    if (name && !profile.name) profile.name = name[1].trim();
    if (gmail && !profile.gmail) profile.gmail = gmail[1].trim();
    if (address && !profile.address) profile.address = address[1].trim();
  }
  return profile;
}

export function MemoryPanel() {
  const [activeTab, setActiveTab] = useState<MemoryTab>('overview');
  const [state, setState] = useState<AegisMemoryStateResponse>();
  const [captures, setCaptures] = useState<AegisCaptureItem[]>([]);
  const [documents, setDocuments] = useState<MemoryDocumentItem[]>([]);
  const [selectedMemoryDocId, setSelectedMemoryDocId] = useState<string | null>(null);
  // Short-term vs long-term memory split: documents can be classified so
  // working context stays separate from durable knowledge.
  const [documentTierFilter, setDocumentTierFilter] = useState<'all' | 'short' | 'long'>('all');
  const tierFilteredDocuments = useMemo(() => {
    if (documentTierFilter === 'all') return documents;
    return documents.filter((doc) => (doc.tier || 'long') === documentTierFilter);
  }, [documents, documentTierFilter]);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentNotice, setDocumentNotice] = useState('');
  const [graph, setGraph] = useState<AegisGraphResponse>();
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // RAG Search state
  const [ragQuery, setRagQuery] = useState('');
  const [ragSearching, setRagSearching] = useState(false);
  const [ragResult, setRagResult] = useState<AegisMemorySearchResponse>();
  const [captureFilter, setCaptureFilter] = useState<'all' | 'note' | 'chat' | 'task'>('all');
  const [expandedCaptures, setExpandedCaptures] = useState<Set<string>>(new Set());

  // Ingestion Modal State
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestContent, setIngestContent] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestSuccess, setIngestSuccess] = useState('');

  // Graph state
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [entitySearch, setEntitySearch] = useState('');

  // Personal memory (host-owned preferences/facts injected into every prompt)
  const [personalMemories, setPersonalMemories] = useState<HostMemory[]>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState('');
  const [identityEditing, setIdentityEditing] = useState(false);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityDraft, setIdentityDraft] = useState<IdentityProfile>({
    name: '',
    gmail: '',
    address: '',
  });

  // Only readable facts are shown: vault ciphertext is filtered out entirely.
  const visibleMemories = useMemo(
    () => personalMemories.filter((memory) => !isEncryptedMemory(memory.text)),
    [personalMemories],
  );

  // Name / Gmail / address, merged from the local vault, an explicit identity
  // entry, and any readable profile memory. Nothing encrypted is rendered.
  const identity = useMemo<IdentityProfile>(() => {
    const stored = readStoredIdentity();
    const fromMemories = identityFromMemories(visibleMemories);
    return {
      name: stored.name || fromMemories.name,
      gmail: stored.gmail || fromMemories.gmail,
      address: stored.address || fromMemories.address,
    };
  }, [visibleMemories]);

  const loadMemoryData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const api = await import('./api');
      const [s, c, g, m, d] = await Promise.all([
        api.getAegisMemoryState(),
        api.getAegisCaptures(60),
        api.getAegisGraph(),
        api.getMemories().catch(() => ({ memories: [] as HostMemory[] })),
        api.listMemoryDocs().catch(() => []),
      ]);
      setState(s);
      setCaptures(c.captures || []);
      setGraph(g);
      setPersonalMemories(m.memories || []);
      setDocuments(d || []);
    } catch {
      setState(undefined);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void loadMemoryData();
    const timer = setInterval(() => {
      if (active) void loadMemoryData(true);
    }, 6000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestTitle.trim() || !ingestContent.trim()) return;
    setIngesting(true);
    setIngestSuccess('');
    try {
      const api = await import('./api');
      const res = await api.createMemoryDoc({
        title: ingestTitle.trim(),
        content: ingestContent.trim(),
        format: 'markdown',
      });
      setIngestSuccess(`Saved "${res.title}" to document memory (${res.indexState || 'index status pending'}).`);
      setSelectedMemoryDocId(res.id);
      setIngestTitle('');
      setIngestContent('');
      await loadMemoryData(true);
      setTimeout(() => {
        setIngestOpen(false);
        setIngestSuccess('');
        setActiveTab('documents');
      }, 1500);
    } catch (err) {
      setIngestSuccess(`Ingestion error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIngesting(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const addPersonalMemory = async () => {
    const text = memoryDraft.trim();
    if (!text) return;
    setMemoryBusy(true);
    setMemoryError('');
    try {
      const api = await import('./api');
      const saved = await api.saveMemory(text);
      setPersonalMemories((prev) => [saved, ...prev]);
      setMemoryDraft('');
    } catch (err) {
      setMemoryError(
        err instanceof Error ? err.message : 'Could not save that memory.',
      );
    } finally {
      setMemoryBusy(false);
    }
  };

  const removePersonalMemory = async (id: string) => {
    setMemoryError('');
    setPersonalMemories((prev) => prev.filter((memory) => memory.id !== id));
    try {
      const api = await import('./api');
      await api.deleteMemory(id);
    } catch (err) {
      setMemoryError(
        err instanceof Error ? err.message : 'Could not delete that memory.',
      );
      void loadMemoryData(true);
    }
  };

  const saveIdentity = async () => {
    const clean: IdentityProfile = {
      name: identityDraft.name.trim(),
      gmail: identityDraft.gmail.trim(),
      address: identityDraft.address.trim(),
    };
    setIdentityBusy(true);
    setMemoryError('');
    try {
      const api = await import('./api');
      // Keep the agent's readable memory in sync: drop the previous readable
      // identity/profile entry, then save the fresh one. The encrypted vault
      // entry is never touched here and never shown.
      const stale = personalMemories.find(
        (memory) =>
          !isEncryptedMemory(memory.text) &&
          /(owner profile|owner identity|^name:)/i.test(memory.text),
      );
      if (stale) await api.deleteMemory(stale.id).catch(() => {});
      await api.saveMemory(
        `Owner identity — Name: ${clean.name || 'unknown'}; Gmail: ${clean.gmail || 'unlinked'}; Address: ${clean.address || 'not set'}.`,
      );
      try {
        localStorage.setItem('aegis:user:identity', JSON.stringify(clean));
      } catch {
        /* ignore */
      }
      setIdentityEditing(false);
      await loadMemoryData(true);
    } catch (err) {
      setMemoryError(
        err instanceof Error ? err.message : 'Could not save your identity.',
      );
    } finally {
      setIdentityBusy(false);
    }
  };

  const toggleCaptureExpand = async (capture: AegisCaptureItem) => {
    const id = capture.id;
    if (capture.text_truncated) {
      try {
        const api = await import('./api');
        const detail = await api.getAegisCapture(id);
        if (detail.capture?.text) {
          setCaptures((previous) => previous.map((item) =>
            item.id === id ? { ...item, text: detail.capture!.text, text_truncated: false } : item,
          ));
        }
      } catch {
        return;
      }
    }
    setExpandedCaptures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // RAG Search Execution
  const runRagSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? ragQuery).trim();
    if (!q) return;
    setRagSearching(true);
    try {
      const api = await import('./api');
      const res = await api.searchAegisMemory(q);
      setRagResult(res);
    } catch {
      setRagResult(undefined);
    } finally {
      setRagSearching(false);
    }
  };

  // Filtered Captures
  const filteredCaptures = useMemo(() => {
    if (captureFilter === 'all') return captures;
    return captures.filter((c) => (c.kind || 'note').toLowerCase() === captureFilter);
  }, [captures, captureFilter]);

  // Graph Filtering
  const filteredEdges = useMemo(() => {
    if (!graph?.edges) return [];
    let edges = graph.edges;
    if (selectedEntity) {
      const target = selectedEntity.toLowerCase();
      edges = edges.filter(
        (e) =>
          e.subj.toLowerCase() === target || e.obj.toLowerCase() === target,
      );
    }
    if (entitySearch.trim()) {
      const query = entitySearch.toLowerCase();
      edges = edges.filter(
        (e) =>
          e.subj.toLowerCase().includes(query) ||
          e.obj.toLowerCase().includes(query) ||
          e.relation.toLowerCase().includes(query),
      );
    }
    return edges;
  }, [graph, selectedEntity, entitySearch]);

  const uniqueEntities = useMemo(() => {
    if (!graph?.entities) return [];
    if (!entitySearch.trim()) return graph.entities;
    const q = entitySearch.toLowerCase();
    return graph.entities.filter((ent) => ent.name.toLowerCase().includes(q));
  }, [graph, entitySearch]);

  // ---- Memory curation (delete / update) -------------------------------
  // A memory is only useful if the owner can take it out again, and if the
  // agent can correct one that a later task made stale. Both paths land here.
  const [nodeBusy, setNodeBusy] = useState(false);
  const [nodeNotice, setNodeNotice] = useState('');

  // Optimise memory: ask the memory agent to re-judge what is already stored
  // and drop anything it would refuse today (task narration, tool noise).
  const pruneMemory = async () => {
    if (
      !window.confirm(
        'Remove stored memories that are only task narration or tool noise?',
      )
    ) {
      return;
    }
    setNodeBusy(true);
    setNodeNotice('');
    try {
      const api = await import('./api');
      const res = await api.pruneAegisMemory();
      setNodeNotice(
        res.removed > 0
          ? `Removed ${res.removed} clutter ${res.removed === 1 ? 'memory' : 'memories'}.`
          : 'Memory is already clean.',
      );
      await loadMemoryData(true);
    } catch (err) {
      setNodeNotice(
        err instanceof Error
          ? `Could not clean up: ${err.message}`
          : 'Could not clean up memory.',
      );
    } finally {
      setNodeBusy(false);
    }
  };

  // Delete an episodic capture from RAG memory: it stops being retrieved and
  // its tree nodes are dropped, so irrelevant entries can be pruned as the
  // owner works rather than left to pollute every future search.
  const deleteCapture = async (captureId: string) => {
    if (
      !window.confirm(
        'Delete this memory from RAG retrieval? It will no longer be recalled.',
      )
    ) {
      return;
    }
    setNodeBusy(true);
    setNodeNotice('');
    try {
      const api = await import('./api');
      const res = await api.deleteAegisCapture(captureId);
      if (!res.ok) throw new Error(res.error || 'Delete failed');
      setNodeNotice('Memory deleted.');
      await loadMemoryData(true);
      if (ragQuery.trim()) void runRagSearch();
    } catch (err) {
      setNodeNotice(
        err instanceof Error
          ? `Could not delete: ${err.message}`
          : 'Could not delete that memory.',
      );
    } finally {
      setNodeBusy(false);
    }
  };

  const reachable = state?.reachable ?? false;

  const selectedMemoryDocument =
    documents.find((document) => document.id === selectedMemoryDocId) ?? documents[0] ?? null;

  const reindexMemoryDocument = async (documentId: string) => {
    setDocumentBusy(true);
    setDocumentNotice('');
    try {
      const api = await import('./api');
      const result = await api.reindexMemoryDoc(documentId);
      setDocumentNotice(result.indexState === 'indexed' ? 'Document indexed successfully.' : result.error || 'Indexing did not complete.');
      await loadMemoryData(true);
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : 'Could not reindex this document.');
    } finally {
      setDocumentBusy(false);
    }
  };

  const deleteMemoryDocument = async (document: MemoryDocumentItem) => {
    if (!window.confirm(`Delete “${document.title}” from memory?`)) return;
    setDocumentBusy(true);
    setDocumentNotice('');
    try {
      const api = await import('./api');
      await api.deleteMemoryDoc(document.id);
      setSelectedMemoryDocId(null);
      setDocumentNotice('Document deleted from memory.');
      await loadMemoryData(true);
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : 'Could not delete this document.');
    } finally {
      setDocumentBusy(false);
    }
  };

  const setDocumentTier = async (document: MemoryDocumentItem, tier: 'short' | 'long') => {
    setDocumentBusy(true);
    setDocumentNotice('');
    try {
      const { api } = await import('./api');
      const updated = await api<MemoryDocumentItem>(`/memory/documents/${document.id}/tier`, 'PATCH', { tier });
      if (updated?.id) {
        setDocuments((current) => current.map((doc) => (doc.id === updated.id ? { ...doc, tier: updated.tier } : doc)));
        setDocumentNotice(updated.tier === 'long' ? 'Document moved to long-term memory.' : 'Document moved to short-term memory.');
      }
    } catch (error) {
      setDocumentNotice(error instanceof Error ? error.message : 'Could not update this memory tier.');
    } finally {
      setDocumentBusy(false);
    }
  };

  return (
    <div className="memory-panel-root">
      {/* Top Header & Architecture Selector */}
      <div className="memory-header-row">
        <div className="memory-title-wrap">
          <div className="memory-icon-badge">
            <Brain size={22} />
          </div>
          <div>
            <h2>3-Tier Aegis Memory</h2>
            <p className="muted">
              Personal facts, scoped task memory, knowledge graph, and searchable document RAG.
            </p>
          </div>
        </div>

        <div className="memory-daemon-status">
          <span className={`daemon-indicator ${reachable ? 'online' : 'standby'}`} />
          <span className="daemon-label">
            {reachable ? 'Python Daemon Online (:8765)' : 'Python Daemon Standby (:8765)'}
          </span>
          {reachable && (
            <span className="mode-badge" title="Daemon RAG state">
              RAG: {state?.ragEnabled ? 'Active' : 'Standby'}
            </span>
          )}
          <button
            className="document-primary"
            title="Add a document to searchable memory"
            onClick={() => setIngestOpen(true)}
          >
            <UploadCloud size={14} /> Ingest Doc
          </button>
          <button
            className="icon-button"
            title="Refresh memory state"
            onClick={() => void loadMemoryData()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {!reachable && (
        <div className="memory-daemon-notice">
          <AlertCircle size={17} className="notice-alert-icon" />
          <div className="notice-body">
            <strong>Python Daemon Standby:</strong> Source documents remain stored locally; semantic retrieval is unavailable until the memory daemon reconnects.
            To start live vector embeddings and Python memory services on <code>:8765</code>, run <code>npm run daemon</code> or <code>python -m aegis_daemon</code>.
          </div>
          <button
            className="text-button"
            onClick={() => void loadMemoryData()}
          >
            Check Status
          </button>
        </div>
      )}

      {ingestOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setIngestOpen(false); }}>
          <div className="modal memory-ingest-modal">
            <div className="modal-header">
              <div className="modal-title-row">
                <UploadCloud size={18} />
            <h3>Add a Document to Memory</h3>
              </div>
              <button className="icon-button" onClick={() => setIngestOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <p className="muted">
              Save a source document and index its content for semantic search. The original document stays available for inspection.
            </p>
            <form onSubmit={handleIngestSubmit} className="ingest-form">
              <label>
                <span>Document Title</span>
                <input
                  required
                  placeholder="e.g. Architecture Guide, Deployment Manual"
                  value={ingestTitle}
                  onChange={(e) => setIngestTitle(e.target.value)}
                />
              </label>
              <label>
                <span>Document Content (Markdown / Text)</span>
                <textarea
                  required
                  rows={8}
                  placeholder="Paste or write the document text to index for retrieval."
                  value={ingestContent}
                  onChange={(e) => setIngestContent(e.target.value)}
                />
              </label>
              {ingestSuccess && (
                <div className="ingest-success-alert">
                  {ingestSuccess}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="text-button" onClick={() => setIngestOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="document-primary" disabled={ingesting}>
                  {ingesting ? 'Indexing...' : 'Save and index'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <>
          {/* Architecture Tier Tabs */}
          <div className="memory-nav-tabs">
            <button
              className={`memory-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Database size={16} />
              <span>3-Tier Overview</span>
            </button>

            <button
              className={`memory-tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
              onClick={() => setActiveTab('graph')}
            >
              <Network size={16} />
              <span>Graph Memory</span>
              <span className="tab-pill">{graph?.edges?.length ?? 0}</span>
            </button>

            <button
              className={`memory-tab-btn ${activeTab === 'rag' ? 'active' : ''}`}
              onClick={() => setActiveTab('rag')}
            >
              <Sparkles size={16} />
              <span>RAG Memory</span>
              <span className="tab-pill">{captures.length}</span>
            </button>

            <button
              className={`memory-tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
              onClick={() => setActiveTab('documents')}
            >
              <FileText size={16} />
              <span>Documents</span>
              <span className="tab-pill">{documents.length}</span>
            </button>

            <button
              className={`memory-tab-btn ${activeTab === 'personal' ? 'active' : ''}`}
              onClick={() => setActiveTab('personal')}
            >
              <User size={16} />
              <span>Personal Memory</span>
              <span className="tab-pill">{visibleMemories.length}</span>
            </button>
          </div>

          {/* ============================================================ */}
          {/* TAB 1: 3-TIER OVERVIEW                                       */}
          {/* ============================================================ */}
          {activeTab === 'overview' && (
            <div className="memory-overview-space">
              <div className="memory-personal-strip">
                <User size={16} />
                <div className="memory-personal-strip-body">
                  <strong>Personal Memory: {visibleMemories.length} item(s)</strong>
                  <span className="muted">
                    Durable facts and preferences about you, injected into every
                    agent turn.
                  </span>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setActiveTab('personal')}
                >
                  Open Personal Memory
                </button>
              </div>
              <div className="memory-summary-cards">
                {/* Tier 1 Card */}
                <div
                  className="memory-tier-card"
                  onClick={() => setActiveTab('graph')}
                >
                  <div className="tier-card-head">
                    <div className="tier-badge graph-badge">
                      <Network size={18} />
                      <span>Tier 1</span>
                    </div>
                    <ArrowRight size={16} className="tier-arrow" />
                  </div>
                  <h3>Graph Memory</h3>
                  <p>
                    Entity-relationship knowledge graph extracting structured facts, entity nodes,
                    and directed predicate edges from conversation and tools.
                  </p>
                  <div className="tier-metrics">
                    <div className="metric-col">
                      <strong>{graph?.entities?.length ?? 0}</strong>
                      <small>Entities</small>
                    </div>
                    <div className="metric-col">
                      <strong>{graph?.edges?.length ?? 0}</strong>
                      <small>Edges / Facts</small>
                    </div>
                  </div>
                </div>

                {/* Tier 2 Card */}
                <div
                  className="memory-tier-card"
                  onClick={() => setActiveTab('rag')}
                >
                  <div className="tier-card-head">
                    <div className="tier-badge rag-badge">
                      <Sparkles size={18} />
                      <span>Tier 2</span>
                    </div>
                    <ArrowRight size={16} className="tier-arrow" />
                  </div>
                  <h3>RAG Memory</h3>
                  <p>
                    Semantic vector embedding search over ingested memory captures with cosine similarity scoring,
                    provenance tracking, and citation grounding.
                  </p>
                  <div className="tier-metrics">
                    <div className="metric-col">
                      <strong>{captures.length}</strong>
                      <small>Recent Captures</small>
                    </div>
                    <div className="metric-col">
                      <strong>{state?.ragEnabled ? 'Online' : 'Standby'}</strong>
                      <small>Vector Store</small>
                    </div>
                  </div>
                </div>

                {/* Indexed source documents */}
                <div
                  className="memory-tier-card"
                  onClick={() => setActiveTab('documents')}
                >
                  <div className="tier-card-head">
                    <div className="tier-badge rag-badge">
                      <FileText size={18} />
                      <span>Sources</span>
                    </div>
                    <ArrowRight size={16} className="tier-arrow" />
                  </div>
                  <h3>Document Memory</h3>
                  <p>
                    Source documents indexed for semantic retrieval, with visible indexing state and original content.
                  </p>
                  <div className="tier-metrics">
                    <div className="metric-col">
                      <strong>{documents.length}</strong>
                      <small>Documents</small>
                    </div>
                    <div className="metric-col">
                      <strong>{documents.filter((doc) => doc.indexState === 'indexed').length}</strong>
                      <small>Indexed</small>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Search Bar */}
              <div className="memory-quick-search-box">
                <div className="quick-search-label">
                  <Search size={16} />
                  <span>Cross-Tier Unified Query</span>
                </div>
                <div className="quick-search-input-wrap">
                  <input
                    placeholder="Search across personal facts, task context, graph relations, and source documents..."
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setActiveTab('rag');
                        void runRagSearch();
                      }
                    }}
                  />
                  <button
                    className="document-primary"
                    onClick={() => {
                      setActiveTab('rag');
                      void runRagSearch();
                    }}
                  >
                    Search RAG
                  </button>
                </div>
              </div>

              {/* Recent Activity Snapshot */}
              <div className="memory-dual-snapshot">
                <div className="snapshot-column">
                  <div className="snapshot-head">
                    <h4>Latest Knowledge Graph Triples</h4>
                    <button
                      className="text-link-btn"
                      onClick={() => setActiveTab('graph')}
                    >
                      View all ({graph?.edges?.length ?? 0})
                    </button>
                  </div>
                  <div className="snapshot-edge-list">
                    {graph?.edges && graph.edges.length > 0 ? (
                      graph.edges.slice(0, 5).map((edge) => (
                        <div key={edge.id} className="snapshot-edge-item">
                          <span className="entity-chip subj">{edge.subj}</span>
                          <span className="relation-pill">{edge.relation}</span>
                          <span className="entity-chip obj">{edge.obj}</span>
                        </div>
                      ))
                    ) : (
                      <p className="muted">No graph edges captured yet.</p>
                    )}
                  </div>
                </div>

                <div className="snapshot-column">
                  <div className="snapshot-head">
                    <h4>Recent Source Documents</h4>
                    <button
                      className="text-link-btn"
                      onClick={() => setActiveTab('documents')}
                    >
                      View documents ({documents.length})
                    </button>
                  </div>
                  <div className="snapshot-tree-list">
                    {documents.length > 0 ? (
                      documents.slice(0, 5).map((doc) => (
                        <div
                          key={doc.id}
                          className="snapshot-node-item"
                          onClick={() => {
                            setSelectedMemoryDocId(doc.id);
                            setActiveTab('documents');
                          }}
                        >
                          <FileText size={14} className="node-icon" />
                          <span className="node-title">{doc.title}</span>
                          <small className="muted">{doc.indexState || 'pending'}</small>
                        </div>
                      ))
                    ) : (
                      <p className="muted">No source documents indexed yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: GRAPH MEMORY                                          */}
          {/* ============================================================ */}
          {activeTab === 'graph' && (
            <div className="memory-graph-space">
              <div className="tier-intro-bar">
                <div>
                  <h3>Knowledge Graph Architecture</h3>
                  <p className="muted">
                    Persistent entity-relationship network. Connects subjects, actions, and objects to maintain long-term factual coherence.
                  </p>
                </div>
                <div className="tier-stat-chips">
                  <span className="stat-chip">
                    <strong>{uniqueEntities.length}</strong> Entities
                  </span>
                  <span className="stat-chip">
                    <strong>{filteredEdges.length}</strong> Relations
                  </span>
                </div>
              </div>

              {/* Entity Filtering & Search */}
              <div className="graph-controls-row">
                <div className="graph-search-input">
                  <Search size={15} />
                  <input
                    placeholder="Filter entities or relations (e.g. Aegis, User, System)..."
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                  />
                  {entitySearch && (
                    <button
                      className="clear-btn"
                      onClick={() => setEntitySearch('')}
                    >
                      &times;
                    </button>
                  )}
                </div>

                {selectedEntity && (
                  <div className="active-entity-filter">
                    <span>Focused on: <strong>{selectedEntity}</strong></span>
                    <button
                      className="text-button"
                      onClick={() => setSelectedEntity(null)}
                    >
                      Clear filter
                    </button>
                  </div>
                )}
              </div>

              {/* Entity Pills Carousel */}
              {uniqueEntities.length > 0 && (
                <div className="entity-pills-row">
                  <span className="pills-label">Entity Nodes:</span>
                  <div className="pills-scroll">
                    <button
                      className={`entity-pill ${selectedEntity === null ? 'active' : ''}`}
                      onClick={() => setSelectedEntity(null)}
                    >
                      All ({graph?.entities?.length ?? 0})
                    </button>
                    {uniqueEntities.map((ent) => (
                      <button
                        key={ent.id}
                        className={`entity-pill ${selectedEntity === ent.name ? 'active' : ''}`}
                        onClick={() =>
                          setSelectedEntity(
                            selectedEntity === ent.name ? null : ent.name,
                          )
                        }
                      >
                        <Tag size={11} />
                        <span>{ent.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Edges Grid */}
              <div className="graph-edges-grid">
                {filteredEdges.length > 0 ? (
                  filteredEdges.map((edge) => (
                    <div key={edge.id} className="graph-edge-card">
                      <div className="edge-top">
                        <span
                          className="entity-box subj"
                          onClick={() => setSelectedEntity(edge.subj)}
                          title="Click to focus on this entity"
                        >
                          {edge.subj}
                        </span>
                        <div className="relation-arrow">
                          <span className="arrow-line" />
                          <span className="relation-tag">{edge.relation}</span>
                          <span className="arrow-head">&rarr;</span>
                        </div>
                        <span
                          className="entity-box obj"
                          onClick={() => setSelectedEntity(edge.obj)}
                          title="Click to focus on this entity"
                        >
                          {edge.obj}
                        </span>
                      </div>
                      {edge.capture_id && (
                        <div className="edge-footer">
                          <small className="muted">
                            Capture ID: <code>{edge.capture_id}</code>
                          </small>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="empty-sub-view">
                    <Network size={28} />
                    <p className="muted">
                      {entitySearch || selectedEntity
                        ? 'No graph relations match the selected filter.'
                        : 'No knowledge graph edges extracted yet.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 3: RAG MEMORY (SEMANTIC VECTORS & CAPTURES)             */}
          {/* ============================================================ */}
          {activeTab === 'rag' && (
            <div className="memory-rag-space">
              <div className="tier-intro-bar">
                <div>
                  <h3>Semantic RAG Memory</h3>
                  <p className="muted">
                    Vector embedding search over episodic captures, notes, and agent interaction history with citation grounding.
                  </p>
                </div>
                <div className="rag-header-actions">
                  <div className="rag-status-badge">
                    <Sparkles size={14} />
                    <span>{state?.ragEnabled ? 'Semantic Search Active' : 'RAG Standby'}</span>
                  </div>
                  <button
                    className="text-button"
                    disabled={nodeBusy}
                    title="Ask the memory agent to drop narration and tool noise"
                    onClick={() => void pruneMemory()}
                  >
                    <Trash2 size={13} /> Clean up clutter
                  </button>
                </div>
              </div>
              {nodeNotice && <p className="memory-operation-notice" role="status">{nodeNotice}</p>}

              {/* Search Bar */}
              <div className="rag-search-container">
                <div className="rag-input-box">
                  <Search size={18} />
                  <input
                    placeholder="Enter natural language query to retrieve relevant semantic memory context..."
                    value={ragQuery}
                    onChange={(e) => setRagQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void runRagSearch();
                    }}
                  />
                  <button
                    className="document-primary"
                    onClick={() => void runRagSearch()}
                    disabled={ragSearching}
                  >
                    {ragSearching ? 'Searching ' : 'Semantic Search'}
                  </button>
                </div>

                {/* Quick Query Suggestions */}
                <div className="rag-prompts-row">
                  <span className="prompts-label">Try queries:</span>
                  {[
                    'User workflow preferences',
                    'Architecture guidelines',
                    'WhatsApp integration setup',
                    'Desktop shell configuration',
                  ].map((promptText) => (
                    <button
                      key={promptText}
                      className="prompt-pill"
                      onClick={() => {
                        setRagQuery(promptText);
                        void runRagSearch(promptText);
                      }}
                    >
                      {promptText}
                    </button>
                  ))}
                </div>
              </div>

              {/* RAG Search Results */}
              {ragResult && (
                <div className="rag-results-section">
                  <div className="rag-results-header">
                    <h4>
                      Semantic Retrieval Results ({ragResult.results.length})
                    </h4>
                    {ragResult.abstained && (
                      <span className="abstained-badge">
                        Confidence threshold not met (abstained)
                      </span>
                    )}
                  </div>

                  {ragResult.results.length > 0 ? (
                    <div className="rag-results-list">
                      {ragResult.results.map((res, idx) => (
                        <div key={`${res.capture_id}-${idx}`} className="rag-result-card">
                          <div className="rag-result-top">
                            <div className="rag-score-pill">
                              <span
                                className="score-fill"
                                style={{
                                  width: `${Math.min(100, Math.round((res.score || 0.8) * 100))}%`,
                                }}
                              />
                              <span className="score-text">
                                {Math.round((res.score || 0.8) * 100)}% match
                              </span>
                            </div>
                            <span className="capture-link">
                              {res.source ? String(res.source).split('/').pop() : 'Memory source'}
                            </span>
                            <button
                              className="icon-button"
                              title="Copy matched text"
                              onClick={() => handleCopy(res.text, `rag-${idx}`)}
                            >
                              {copiedId === `rag-${idx}` ? (
                                <Check size={14} className="copied-icon" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              title="Delete this memory"
                              disabled={nodeBusy}
                              onClick={() => void deleteCapture(res.capture_id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <p className="rag-result-text">{res.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted rag-no-results">
                      {ragResult.abstained
                        ? 'The model abstained: no stored memories matched closely enough to reliably cite.'
                        : 'No matching vector embeddings found.'}
                    </p>
                  )}

                  {ragResult.citations && ragResult.citations.length > 0 && (
                    <div className="citations-tray">
                      <small>Citations: {ragResult.citations.join(', ')}</small>
                    </div>
                  )}
                </div>
              )}

              {/* Captures Repository */}
              <div className="captures-section">
                <div className="captures-header-row">
                  <h4>Ingested Captures Repository</h4>
                  <div className="filter-button-group">
                    {(['all', 'note', 'chat', 'task'] as const).map((kind) => (
                      <button
                        key={kind}
                        className={`filter-btn ${captureFilter === kind ? 'active' : ''}`}
                        onClick={() => setCaptureFilter(kind)}
                      >
                        {kind.charAt(0).toUpperCase() + kind.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="captures-grid">
                  {filteredCaptures.length > 0 ? (
                    filteredCaptures.slice(0, 18).map((capture) => {
                      const isExpanded = expandedCaptures.has(capture.id);
                      return (
                        <div key={capture.id} className="capture-card">
                          <div className="capture-card-top">
                            <span className="capture-kind-badge">
                              {capture.kind || 'note'}
                            </span>
                            <span className="capture-source">
                              {capture.source || 'user'}
                            </span>
                            <button
                              className="icon-button"
                              title="Copy capture text"
                              onClick={async () => {
                                if (capture.text_truncated) {
                                  const api = await import('./api');
                                  const detail = await api.getAegisCapture(capture.id);
                                  handleCopy(detail.capture?.text || capture.text, capture.id);
                                } else handleCopy(capture.text, capture.id);
                              }}
                            >
                              {copiedId === capture.id ? (
                                <Check size={13} className="copied-icon" />
                              ) : (
                                <Copy size={13} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              title="Delete this memory"
                              disabled={nodeBusy}
                              onClick={() => void deleteCapture(capture.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <p
                            className={`capture-body-text ${isExpanded ? 'expanded' : ''}`}
                          >
                            {capture.text}
                          </p>
                          {(capture.text.length > 130 || capture.text_truncated) && (
                            <button
                              className="expand-text-btn"
                              onClick={() => void toggleCaptureExpand(capture)}
                            >
                              {isExpanded ? 'Show less' : capture.text_truncated ? 'Load full capture' : 'Read more '}
                            </button>
                          )}
                          <div className="capture-card-footer">
                            <small className="muted">
                              {capture.source
                                ? String(capture.source).split('/').pop()
                                : capture.kind
                                  ? `${capture.kind} memory`
                                  : 'Memory'}
                            </small>
                            {capture.trust && (
                              <small className="trust-tag">
                                Trust: {capture.trust}
                              </small>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="muted">No captures recorded under this filter.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 4: PERSONAL MEMORY (HOST-OWNED PREFERENCES & FACTS)       */}
          {/* ============================================================ */}
          {activeTab === 'personal' && (
            <div className="memory-stair-space">
              <div className="tier-intro-bar">
                <div>
                  <h3>Personal Memory</h3>
                  <p className="muted">
                    Durable facts and preferences about you. Every item here is
                    injected into the agent&rsquo;s context on each turn, so it
                    answers as someone who knows you.
                  </p>
                </div>
                <div className="tier-stat-chips">
                  <span className="stat-chip">
                    <strong>{visibleMemories.length}</strong> Memories
                  </span>
                </div>
              </div>

              {/* Identity: the person's name, Gmail and address, and nothing
                  else. Vault ciphertext is never rendered here. */}
              <div className="memory-identity-card">
                <div className="memory-identity-head">
                  <User size={16} />
                  <h4>Identity</h4>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      if (identityEditing) {
                        setIdentityEditing(false);
                      } else {
                        setIdentityDraft(identity);
                        setIdentityEditing(true);
                      }
                    }}
                  >
                    {identityEditing ? 'Cancel' : 'Edit'}
                  </button>
                </div>
                {identityEditing ? (
                  <div className="memory-identity-form">
                    <label>
                      <span>Name</span>
                      <input
                        value={identityDraft.name}
                        placeholder="Your name"
                        onChange={(e) =>
                          setIdentityDraft((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Gmail</span>
                      <input
                        type="email"
                        value={identityDraft.gmail}
                        placeholder="you@gmail.com"
                        onChange={(e) =>
                          setIdentityDraft((prev) => ({
                            ...prev,
                            gmail: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Address</span>
                      <input
                        value={identityDraft.address}
                        placeholder="Street, postal code, city, country"
                        onChange={(e) =>
                          setIdentityDraft((prev) => ({
                            ...prev,
                            address: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="document-primary"
                      disabled={identityBusy}
                      onClick={() => void saveIdentity()}
                    >
                      {identityBusy ? 'Saving...' : 'Save identity'}
                    </button>
                  </div>
                ) : (
                  <dl className="memory-identity-list">
                    <div>
                      <dt>Name</dt>
                      <dd>{identity.name || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt>Gmail</dt>
                      <dd>{identity.gmail || 'Not set'}</dd>
                    </div>
                    <div>
                      <dt>Address</dt>
                      <dd>{identity.address || 'Not set'}</dd>
                    </div>
                  </dl>
                )}
              </div>

              <div className="stair-address-bar">
                <div className="stair-address-input">
                  <Brain size={16} />
                  <input
                    placeholder="Tell Aegis something to remember (e.g. 'I prefer concise replies and IST time')..."
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addPersonalMemory();
                    }}
                  />
                  <button
                    className="document-primary"
                    onClick={() => void addPersonalMemory()}
                    disabled={memoryBusy || !memoryDraft.trim()}
                  >
                    {memoryBusy ? 'Saving…' : 'Remember'}
                  </button>
                </div>
                {memoryError && (
                  <div className="address-result-banner">
                    <span className="result-tag">Memory error:</span>
                    <p className="address-match-excerpt">{memoryError}</p>
                  </div>
                )}
              </div>

              <div className="captures-grid">
                {visibleMemories.length > 0 ? (
                  visibleMemories.map((memory) => (
                    <div key={memory.id} className="capture-card">
                      <div className="capture-card-top">
                        <span className="capture-kind-badge">memory</span>
                        <span className="capture-source">
                          {new Date(memory.createdAt).toLocaleString()}
                        </span>
                        <button
                          className="icon-button"
                          title="Copy memory"
                          onClick={() => handleCopy(memory.text, memory.id)}
                        >
                          {copiedId === memory.id ? (
                            <Check size={13} className="copied-icon" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                        <button
                          className="icon-button"
                          title="Forget this memory"
                          aria-label="Forget this memory"
                          onClick={() => void removePersonalMemory(memory.id)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                      <p className="capture-body-text expanded">{memory.text}</p>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    No personal memories yet. Add one above, or tell the agent
                    something durable about yourself in chat and it will be saved.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <section className="memory-documents-view">
              <div className="tier-intro-bar">
                <div>
                  <h3>Source documents</h3>
                  <p className="muted">Original text and indexing status for files saved to searchable memory.</p>
                </div>
                <div className="tier-stat-chips">
                  <button type="button" className={`stat-chip tier-chip ${documentTierFilter === 'all' ? 'active' : ''}`} onClick={() => setDocumentTierFilter('all')}>
                    <strong>{documents.length}</strong> documents
                  </button>
                  <button type="button" className={`stat-chip tier-chip ${documentTierFilter === 'long' ? 'active' : ''}`} onClick={() => setDocumentTierFilter('long')}>
                    <strong>{documents.filter((doc) => (doc.tier || 'long') === 'long').length}</strong> long-term
                  </button>
                  <button type="button" className={`stat-chip tier-chip ${documentTierFilter === 'short' ? 'active' : ''}`} onClick={() => setDocumentTierFilter('short')}>
                    <strong>{documents.filter((doc) => doc.tier === 'short').length}</strong> short-term
                  </button>
                </div>
              </div>
              <div className="memory-documents-layout">
                <div className="memory-document-list" aria-label="Memory source documents">
                  {tierFilteredDocuments.length ? tierFilteredDocuments.map((document) => (
                    <button
                      type="button"
                      key={document.id}
                      className={`memory-document-row ${selectedMemoryDocument?.id === document.id ? 'selected' : ''}`}
                      onClick={() => setSelectedMemoryDocId(document.id)}
                    >
                      <FileText size={17} />
                      <span className="memory-document-row-copy">
                        <strong>{document.title}</strong>
                        <small>{document.format || 'text'} · {document.ragChunkCount ?? 0} RAG chunks · {(document.tier || 'long') === 'long' ? 'long-term' : 'short-term'}</small>
                      </span>
                      <span className={`memory-document-state ${document.indexState || 'pending'}`}>{document.indexState || 'pending'}</span>
                    </button>
                  )) : (
                    <div className="empty-sub-view">
                      <Database size={28} />
                      <p className="muted">No {documentTierFilter === 'all' ? '' : documentTierFilter + '-term '}source documents yet. Add one with “Ingest Doc” to store its original content and index it for retrieval.</p>
                    </div>
                  )}
                </div>
                <article className="memory-document-preview">
                  {documentNotice && <p className="memory-operation-notice" role="status">{documentNotice}</p>}
                  {selectedMemoryDocument ? (
                    <>
                      <header>
                        <div>
                          <small className="muted">SOURCE DOCUMENT</small>
                          <h3>{selectedMemoryDocument.title}</h3>
                          <p className="muted">{selectedMemoryDocument.format || 'text'} · {selectedMemoryDocument.ragChunkCount ?? 0} indexed RAG chunks</p>
                          {selectedMemoryDocument.sourcePath && <p className="muted">Workspace source: {selectedMemoryDocument.sourcePath}</p>}
                          {selectedMemoryDocument.error && <p className="memory-operation-notice" role="alert">{selectedMemoryDocument.error}</p>}
                        </div>
                        <div className="memory-document-actions">
                          {selectedMemoryDocument.indexState !== 'indexed' && (
                            <button type="button" className="text-button" disabled={documentBusy} onClick={() => void reindexMemoryDocument(selectedMemoryDocument.id)}>
                              <RefreshCw size={14} /> {documentBusy ? 'Indexing…' : 'Retry index'}
                            </button>
                          )}
                          <button type="button" className="text-button" disabled={documentBusy} onClick={() => void setDocumentTier(selectedMemoryDocument, (selectedMemoryDocument.tier || 'long') === 'long' ? 'short' : 'long')}>
                            {(selectedMemoryDocument.tier || 'long') === 'long' ? '→ Short-term' : '→ Long-term'}
                          </button>
                          <button type="button" className="icon-button" title="Delete source document" aria-label={`Delete ${selectedMemoryDocument.title}`} disabled={documentBusy} onClick={() => void deleteMemoryDocument(selectedMemoryDocument)}><Trash2 size={15} /></button>
                        </div>
                      </header>
                      <pre className="memory-document-content">{selectedMemoryDocument.content || 'Original content is not available for this document.'}</pre>
                    </>
                  ) : (
                    <div className="empty-sub-view"><FileText size={28} /><p className="muted">Choose a document to inspect its stored source content.</p></div>
                  )}
                </article>
              </div>
            </section>
          )}
        </>
    </div>
  );
}
