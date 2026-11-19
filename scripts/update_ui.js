const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'apps', 'host', 'src', 'client', 'App.tsx');
let code = fs.readFileSync(file, 'utf8');

// 1. Replace icon-rail
const oldRailStart = code.indexOf('<nav className="icon-rail"');
if (oldRailStart === -1) {
  console.error('Could not find <nav className="icon-rail"');
  process.exit(1);
}
const oldRailEnd = code.indexOf('</nav>', oldRailStart) + 6;
const oldRail = code.substring(oldRailStart, oldRailEnd);

const newRail = `<nav className="icon-rail" aria-label="Workspace navigation">
        <button
          className="rail-brand"
          aria-label="Aegis home"
          title="Aegis home"
          onClick={() => {
            setView('chat');
            setSelectedThread(undefined);
          }}
        >
          o<span>·</span>
        </button>
        <button
          className="rail-toggle"
          aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setNavCollapsed(!navCollapsed)}
        >
          <PanelLeft size={18} />
        </button>

        <div className="rail-divider" />

        <div className="rail-views-scroll" role="tablist" aria-label="Workspace surfaces">
          {SURFACE_VIEWS.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            const count =
              item.id === 'tasks' && state?.tasks.length
                ? state.tasks.length
                : item.id === 'memories' && state?.memories.length
                  ? state.memories.length
                  : 0;
            return (
              <button
                key={item.id}
                className={\`rail-item \${isActive ? 'active' : ''}\`}
                aria-label={item.label}
                title={item.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  setView(item.id);
                  if (item.id === 'chat') setSelectedThread(undefined);
                  setMobile(false);
                }}
              >
                <Icon size={18} />
                {count > 0 && <span className="rail-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="rail-divider" />

        <button
          className="rail-item rail-voice"
          aria-label="Voice OS"
          title="Open Voice OS"
          onClick={() => openVoice(false)}
        >
          <Mic size={18} />
          <span
            className={\`rail-wake-dot \${wake.status}\`}
            title={\`Wake word: \${wake.status}\`}
          />
        </button>

        <button
          className={\`rail-item rail-settings \${view === 'settings' ? 'active' : ''}\`}
          aria-label="Open settings"
          title="Settings"
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => setView('settings')}
        >
          <Settings2 size={18} />
        </button>
      </nav>`;

code = code.replace(oldRail, newRail);

// 2. Remove WORKSPACE view-nav from sidebar
const workspaceHeading = '<div className="spaces-heading nav-label">WORKSPACE</div>';
const idxWorkspace = code.indexOf(workspaceHeading);
if (idxWorkspace !== -1) {
  const viewNavEnd = '</nav>';
  const idxAfterViewNav = code.indexOf(viewNavEnd, idxWorkspace) + viewNavEnd.length;
  code = code.substring(0, idxWorkspace) + code.substring(idxAfterViewNav);
}

// 3. Remove surfaces group from dots-nav
const surfacesCheck = '{surfaces.length > 0 && (';
const idxSurfaces = code.indexOf(surfacesCheck);
if (idxSurfaces !== -1) {
  const surfacesEnd = '{peers.map((item) => renderRow(item))}';
  const idxPeers = code.indexOf(surfacesEnd, idxSurfaces);
  if (idxPeers !== -1) {
    code = code.substring(0, idxSurfaces) + code.substring(idxPeers);
  }
}

fs.writeFileSync(file, code, 'utf8');
console.log('App.tsx successfully updated!');
