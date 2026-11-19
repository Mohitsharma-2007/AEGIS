const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'apps', 'host', 'src', 'client', 'style.css');
let css = fs.readFileSync(file, 'utf8');

const mktCss = `
/* ==========================================================================
   AEGIS Marketplace & Connector Hub 2000+ UI
   ========================================================================== */
.marketplace-surface {
  padding: 32px 40px;
  max-width: 1400px;
  margin: 0 auto;
  color: #e2e8f0;
}
.marketplace-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 28px;
  gap: 20px;
  flex-wrap: wrap;
}
.marketplace-hero-text h1 {
  font-size: 28px;
  font-weight: 700;
  margin: 4px 0 8px;
  color: #f8fafc;
}
.marketplace-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: #38bdf8;
  font-weight: 600;
}
.marketplace-hero-text p {
  font-size: 14px;
  color: #94a3b8;
  max-width: 680px;
  line-height: 1.6;
}
.marketplace-hero-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.marketplace-add-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
  color: #fff;
  border: none;
  font-weight: 600;
  font-size: 13.5px;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);
}
.marketplace-add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(2, 132, 199, 0.45);
}
.marketplace-toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}
.marketplace-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
}
.marketplace-search-wrap .search-icon {
  position: absolute;
  left: 16px;
  color: #64748b;
}
.marketplace-search-wrap input {
  width: 100%;
  padding: 14px 44px 14px 46px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(51, 65, 85, 0.7);
  color: #f1f5f9;
  font-size: 14px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.marketplace-search-wrap input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
}
.search-clear {
  position: absolute;
  right: 14px;
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
}
.marketplace-categories {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.cat-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 20px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(51, 65, 85, 0.6);
  color: #94a3b8;
  font-size: 13px;
  cursor: pointer;
  transition: all 120ms ease;
}
.cat-pill:hover {
  background: rgba(30, 41, 59, 0.8);
  color: #f1f5f9;
}
.cat-pill.active {
  background: rgba(56, 189, 248, 0.16);
  border-color: #38bdf8;
  color: #38bdf8;
  font-weight: 600;
}
.pill-count {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 7px;
  border-radius: 10px;
  color: inherit;
}
.marketplace-meta-bar {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 18px;
}
.marketplace-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 18px;
}
.m-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(51, 65, 85, 0.65);
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}
.m-card:hover {
  transform: translateY(-2px);
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}
.m-card.installed {
  border-color: rgba(34, 197, 94, 0.4);
}
.m-card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.m-card-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.12);
  color: #38bdf8;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.m-card-titles {
  flex: 1;
  min-width: 0;
}
.m-card-titles h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 3px;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-card-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #64748b;
}
.m-kind-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(100, 116, 139, 0.2);
  color: #94a3b8;
}
.m-kind-badge.mcp { color: #38bdf8; background: rgba(56, 189, 248, 0.15); }
.m-kind-badge.skill { color: #a855f7; background: rgba(168, 85, 247, 0.15); }
.m-kind-badge.connector { color: #22c55e; background: rgba(34, 197, 94, 0.15); }
.m-kind-badge.plugin { color: #f59e0b; background: rgba(245, 158, 11, 0.15); }
.m-oauth-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  display: flex;
  align-items: center;
  gap: 4px;
}
.m-oauth-badge.connected {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}
.m-card-desc {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
  margin: 0 0 14px;
  flex: 1;
}
.m-card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.m-tag {
  font-size: 11px;
  color: #64748b;
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 7px;
  border-radius: 6px;
}
.m-card-command-row {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.35);
  padding: 6px 10px;
  border-radius: 8px;
  margin-bottom: 14px;
  border: 1px solid rgba(51, 65, 85, 0.4);
}
.m-card-command-row code {
  flex: 1;
  font-family: monospace;
  font-size: 11px;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-copy-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 2px;
}
.icon-copy-btn:hover { color: #38bdf8; }
.m-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid rgba(51, 65, 85, 0.5);
}
.m-card-stats {
  display: flex;
  gap: 12px;
  font-size: 11.5px;
  color: #64748b;
}
.m-stat {
  display: flex;
  align-items: center;
  gap: 4px;
}
.star-icon { color: #f59e0b; fill: #f59e0b; }
.m-card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.m-action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 120ms ease;
}
.m-action-btn.add {
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.35);
}
.m-action-btn.add:hover {
  background: #0284c7;
  color: #ffffff;
}
.m-action-btn.installed {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.35);
}
.m-oauth-btn {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 600;
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.35);
  cursor: pointer;
}
.m-oauth-btn.connected {
  background: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
  border-color: rgba(100, 116, 139, 0.35);
}
.marketplace-load-more {
  display: flex;
  justify-content: center;
  margin-top: 32px;
}
.marketplace-toast {
  position: fixed;
  bottom: 28px;
  right: 28px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 12px;
  background: #0284c7;
  color: #ffffff;
  font-weight: 500;
  font-size: 13.5px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  animation: toast-in 200ms ease;
}
@keyframes toast-in {
  from { transform: translateY(12px); opacity: 0; }
  to { transform: none; opacity: 1; }
}

/* Modal styles */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.marketplace-modal {
  width: min(680px, 94vw);
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 20px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #1e293b;
}
.modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #38bdf8;
}
.modal-title-row h2 {
  font-size: 18px;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0;
}
.modal-close {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
}
.modal-tabs {
  display: flex;
  background: #0a0f1d;
  border-bottom: 1px solid #1e293b;
}
.modal-tabs button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 120ms ease;
}
.modal-tabs button.active {
  color: #38bdf8;
  border-bottom-color: #38bdf8;
  background: rgba(56, 189, 248, 0.05);
  font-weight: 600;
}
.modal-body {
  padding: 24px;
}
.pane-help {
  font-size: 13px;
  color: #94a3b8;
  margin: 0 0 16px;
  line-height: 1.5;
}
.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.field-label span {
  font-size: 12.5px;
  font-weight: 500;
  color: #cbd5e1;
}
.text-input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  background: #0a0f1d;
  border: 1px solid #334155;
  color: #f1f5f9;
  font-size: 13.5px;
  outline: none;
}
.text-input:focus {
  border-color: #38bdf8;
}
.cmd-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 10px;
  background: #050811;
  border: 1px solid #1e293b;
  font-size: 12px;
}
.cmd-preview span { color: #64748b; }
.cmd-preview code { color: #38bdf8; font-family: monospace; }
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #1e293b;
  background: #0a0f1d;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

fs.writeFileSync(file, css + mktCss, 'utf8');
console.log('Marketplace CSS successfully appended!');
