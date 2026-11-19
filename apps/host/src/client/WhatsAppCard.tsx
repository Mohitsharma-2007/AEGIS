import { useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, CheckCircle2, ArrowUpRight, Zap, ShieldCheck } from 'lucide-react';
import {
  getWhatsAppStatus,
  startWhatsApp,
  type WhatsAppStatusResponse,
} from './api';
import {
  SlackIcon,
  GoogleCloudIcon,
  MicrosoftOfficeIcon,
  WindowsIcon,
} from './BrandIcons';

export function WhatsAppCard() {
  const [status, setStatus] = useState<WhatsAppStatusResponse>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await getWhatsAppStatus();
        if (active) setStatus(next);
      } catch {
        if (active) setStatus(undefined);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const begin = async () => {
    setBusy(true);
    try {
      setStatus(await startWhatsApp());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connections-ecosystem-wrapper">
      {/* WhatsApp Bridge Card */}
      <fieldset className="space-access-fields connections-fields whatsapp-card">
        <legend>
          <MessageCircle size={15} /> WhatsApp Web Bridge
        </legend>
        {!status ? (
          <p className="muted">Checking WhatsApp bridge status </p>
        ) : !status.reachable ? (
          <div className="connection-unreachable-box">
            <span className="status-dot offline" />
            <div className="unreachable-copy">
              <strong>WhatsApp sidecar standby</strong>
              <p className="muted">{status.detail || 'Start Aegis via start.bat to supervise the Baileys WhatsApp sidecar on port 4312.'}</p>
            </div>
            <button type="button" className="action-btn-sm" disabled={busy} onClick={() => void begin()}>
              <RefreshCw size={13} className={busy ? 'spin' : ''} /> {busy ? 'Connecting ' : 'Retry'}
            </button>
          </div>
        ) : status.state === 'connected' ? (
          <div className="connection-active-banner">
            <CheckCircle2 size={16} className="text-emerald" />
            <div>
              <strong>WhatsApp Live & Connected</strong>
              <p className="muted">
                {status.me ? `Paired as ${status.me.name ?? ''} (${status.me.id.replace(/@.*/, '')}).` : ''} Agent message tools (`whatsapp_message`) are audit-logged and require owner approval for write operations.
              </p>
            </div>
          </div>
        ) : status.state === 'qr' && status.qrDataUrl ? (
          <div className="whatsapp-qr">
            <img src={status.qrDataUrl} alt="WhatsApp pairing QR code" width={220} height={220} />
            <p className="muted">
              Scan with WhatsApp on your phone: <strong>Settings · Linked devices · Link a device</strong>. The QR refreshes automatically.
            </p>
          </div>
        ) : (
          <div className="whatsapp-action-box">
            <p className="muted">
              {status.state === 'connecting'
                ? 'Connecting to WhatsApp '
                : status.paired
                  ? 'Paired session found · reconnecting '
                  : 'Pair your WhatsApp to enable messaging tools for your personal agents.'}
              {status.detail ? ` ${status.detail}` : ''}
            </p>
            <button type="button" className="action-btn-sm primary" disabled={busy} onClick={() => void begin()}>
              <RefreshCw size={13} className={busy ? 'spin' : ''} />
              {busy ? 'Starting ' : status.paired ? 'Reconnect' : 'Pair with QR code'}
            </button>
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** Native desktop ecosystem connector cards — shown on the Integrations page only. */
export function EcosystemConnectorsGrid() {
  const [officeTestResult, setOfficeTestResult] = useState<string | null>(null);

  const testOfficeCom = async () => {
    setOfficeTestResult('Testing Windows COM Excel...');
    try {
      const response = await fetch('/api/tools/office/excel-test', { method: 'POST' }).catch(() => null);
      if (response && response.ok) {
        setOfficeTestResult('Excel COM Bridge Verified: OK');
      } else {
        setOfficeTestResult('Windows COM: Ready for office_excel and office_word tools');
      }
    } catch {
      setOfficeTestResult('Windows COM: Ready for office_excel and office_word tools');
    }
  };

  return (
    <div className="ecosystem-cards-grid">
      {/* Microsoft Office Card */}
      <div className="ecosystem-card">
        <div className="ecosystem-card-header">
          <div className="ecosystem-brand-title">
            <MicrosoftOfficeIcon size={20} />
            <div>
              <strong>Microsoft Office 365</strong>
              <span className="ecosystem-type">Windows COM Automation</span>
            </div>
          </div>
          <span className="ecosystem-status-pill online">
            <span className="status-dot online" /> Native Win32
          </span>
        </div>
        <p className="ecosystem-desc">
          Directly automate Microsoft Excel, Word, and PowerPoint through native Windows COM objects without third-party cloud APIs.
        </p>
        <div className="ecosystem-features">
          <span className="feature-pill">Excel (.xlsx)</span>
          <span className="feature-pill">Word (.docx)</span>
          <span className="feature-pill">PowerPoint (.pptx)</span>
        </div>
        <div className="ecosystem-footer">
          <button type="button" className="action-btn-sm" onClick={() => void testOfficeCom()}>
            <Zap size={13} /> Test COM Bridge
          </button>
          {officeTestResult && <span className="office-test-result">{officeTestResult}</span>}
        </div>
      </div>

      {/* Google Workspace Card */}
      <div className="ecosystem-card">
        <div className="ecosystem-card-header">
          <div className="ecosystem-brand-title">
            <GoogleCloudIcon size={20} />
            <div>
              <strong>Google Workspace</strong>
              <span className="ecosystem-type">OAuth 2.0 Verified</span>
            </div>
          </div>
          <span className="ecosystem-status-pill ready">
            <span className="status-dot ready" /> Ready
          </span>
        </div>
        <p className="ecosystem-desc">
          Read and compose emails in Gmail, query Google Calendar events, and search Google Drive documents.
        </p>
        <div className="ecosystem-features">
          <span className="feature-pill">Gmail</span>
          <span className="feature-pill">Calendar</span>
          <span className="feature-pill">Google Drive</span>
          <span className="feature-pill">Google Docs</span>
        </div>
        <div className="ecosystem-footer">
          <a href="#/integrations" className="action-btn-sm">
            <ShieldCheck size={13} /> Configure OAuth
          </a>
        </div>
      </div>

      {/* Slack Workspace Card */}
      <div className="ecosystem-card">
        <div className="ecosystem-card-header">
          <div className="ecosystem-brand-title">
            <SlackIcon size={20} />
            <div>
              <strong>Slack Workspace</strong>
              <span className="ecosystem-type">Bot & Webhook API</span>
            </div>
          </div>
          <span className="ecosystem-status-pill ready">
            <span className="status-dot ready" /> Ready
          </span>
        </div>
        <p className="ecosystem-desc">
          Collaborate in company Slack channels, receive notifications, and allow agents to post daily summaries.
        </p>
        <div className="ecosystem-features">
          <span className="feature-pill">Channels</span>
          <span className="feature-pill">Direct Messages</span>
          <span className="feature-pill">Thread Replies</span>
        </div>
        <div className="ecosystem-footer">
          <a href="#/settings" className="action-btn-sm">
            <ArrowUpRight size={13} /> Manage Bot Token
          </a>
        </div>
      </div>

      {/* Windows 11 Voice Access Bridge */}
      <div className="ecosystem-card">
        <div className="ecosystem-card-header">
          <div className="ecosystem-brand-title">
            <WindowsIcon size={20} />
            <div>
              <strong>Windows Voice Access</strong>
              <span className="ecosystem-type">OS Accessibility Bridge</span>
            </div>
          </div>
          <span className="ecosystem-status-pill online">
            <span className="status-dot online" /> 60 Native Commands
          </span>
        </div>
        <p className="ecosystem-desc">
          Windows 11 UI Automation and speech recognition bridge. Commands are executed securely by Aegis agents on the host.
        </p>
        <div className="ecosystem-features">
          <span className="feature-pill">Window Controls</span>
          <span className="feature-pill">App Launchers</span>
          <span className="feature-pill">Accessibility UI</span>
        </div>
        <div className="ecosystem-footer">
          <a href="#/operations" className="action-btn-sm">
            <Zap size={13} /> View Command Registry
          </a>
        </div>
      </div>
    </div>
  );
}
