const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'apps', 'host', 'src', 'client', 'style.css');
let css = fs.readFileSync(file, 'utf8');

// Replace the old .icon-rail block
const oldRailStart = css.indexOf('.icon-rail {');
const oldRailEnd = css.indexOf('.template-app.app .sidebar {', oldRailStart);

const newRailCss = `.icon-rail {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 4px;
  border-right: 1px solid var(--line);
  background: #f7f9fa;
  user-select: none;
}
.icon-rail button {
  position: relative;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #64748b;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 140ms ease-in-out;
}
.icon-rail button:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1e293b;
}
.icon-rail button.active {
  background: rgba(34, 211, 238, 0.14);
  color: #0284c7;
  font-weight: 600;
}
.icon-rail button.active::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: #0284c7;
  border-radius: 0 3px 3px 0;
}
.icon-rail .rail-brand {
  color: #1e293b;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -5px;
  padding-right: 5px;
  margin-bottom: 4px;
}
.rail-brand span {
  color: #0284c7;
}
.rail-divider {
  width: 28px;
  height: 1px;
  background: var(--line);
  margin: 4px 0;
  flex-shrink: 0;
}
.rail-views-scroll {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  flex: 1 1 auto;
}
.rail-views-scroll::-webkit-scrollbar {
  display: none;
}
.rail-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: #ef4444;
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
.rail-wake-dot {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
}
.rail-wake-dot.active, .rail-wake-dot.listening {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}
.icon-rail .rail-settings {
  margin-top: auto;
}
`;

css = css.substring(0, oldRailStart) + newRailCss + css.substring(oldRailEnd);

// Also add dark mode rules for icon rail
const darkRailCss = `
:root[data-theme='dark'] .icon-rail {
  background: #090e1a;
  border-color: #1e293b;
}
:root[data-theme='dark'] .icon-rail button {
  color: #94a3b8;
}
:root[data-theme='dark'] .icon-rail button:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #f1f5f9;
}
:root[data-theme='dark'] .icon-rail button.active {
  background: rgba(56, 189, 248, 0.16);
  color: #38bdf8;
}
:root[data-theme='dark'] .icon-rail button.active::before {
  background: #38bdf8;
}
:root[data-theme='dark'] .rail-brand {
  color: #f1f5f9;
}
:root[data-theme='dark'] .rail-brand span {
  color: #38bdf8;
}
:root[data-theme='dark'] .rail-divider {
  background: #1e293b;
}
`;

css += darkRailCss;

fs.writeFileSync(file, css, 'utf8');
console.log('style.css updated successfully!');
