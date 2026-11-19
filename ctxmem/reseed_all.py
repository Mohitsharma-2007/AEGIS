#!/usr/bin/env python3
"""Re-seed all issues with proper file linking"""

import sqlite3
from pathlib import Path

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")

ISSUES = [
    ('F1', 'functionality', 'high', 'Voice mode auto-switches to text while listening',
     'App.tsx resets emptyInlineVoice on thread change even while mic is live',
     "App.tsx line 308-310: setEmptyInlineVoice(false) on thread change resets voice state mid-turn",
     "Guard with 'if (!isAnyVoiceActive) setEmptyInlineVoice(false);'",
     2, 'low',
     [('apps/host/src/client/App.tsx', 'primary'), ('apps/host/src/client/Chat.tsx', 'secondary'), ('apps/host/src/client/voiceSession.tsx', 'related')]),
    ('F2', 'functionality', 'high', 'Microphone not released when leaving voice mode',
     'WebSocket/AudioContext cleanup may not run on unexpected unmount',
     'useLocalVoice.ts cleanup depends on stop() callback identity',
     'Add beforeunload/pagehide listener; ensure releaseInput() in all error paths',
     3, 'medium',
     [('apps/host/src/client/useLocalVoice.ts', 'primary'), ('apps/host/src/client/voiceSession.tsx', 'secondary')]),
    ('F3', 'functionality', 'medium', '/call silent no-op in browser-only mode',
     'Widget call fails silently if bridge.action is undefined',
     'App.tsx onCallWidget handler does not validate widget name',
     'Add widget name validation and fallback error for desktop mode',
     5, 'low',
     [('apps/host/src/client/App.tsx', 'primary')]),
    ('F4', 'functionality', 'high', 'Mail report not sent on host restart for in-flight tasks',
     'mail-processed.json write failure silently caught; inflight map lost on crash',
     'mail-orchestrator.ts saveProcessed failure caught and ignored',
     'Add retry for saveProcessed; startup reconciliation for orphaned tasks',
     3, 'medium',
     [('apps/host/src/server/mail-orchestrator.ts', 'primary'), ('apps/host/src/server/mailbox.ts', 'secondary'), ('apps/host/src/server/agent-swarm.ts', 'related')]),
    ('F5', 'functionality', 'medium', 'Swarm task dispatch - no provider fallback',
     'Provider failure (401/402/403/rate limit) fails entire task',
     'agent-swarm.ts uses configured provider without fallback chain',
     'Add provider fallback chain in dispatch logic',
     4, 'medium',
     [('apps/host/src/server/agent-swarm.ts', 'primary'), ('apps/host/src/server/providers.ts', 'secondary')]),
    ('F6', 'functionality', 'medium', 'Computer service - orphaned sessions on host crash',
     'Playwright browser contexts tracked in-memory; host crash leaves orphaned processes',
     'computer-service.ts only handles graceful context close, not process crash',
     'Add startup cleanup for orphaned processes; add session TTL',
     4, 'medium',
     [('apps/host/src/server/computer-service.ts', 'primary'), ('apps/host/src/server/browser-launch.ts', 'secondary')]),
    ('F7', 'functionality', 'high', 'Voice/TTS - no sentence segmentation or punctuation stripping',
     'TTS receives raw markdown (**$, ?, #, *, _, etc.) without preprocessing',
     'useLocalVoice.ts playChunk() sends raw text to synthesizer',
     'Add sanitizeForTTS() with punctuation stripping and sentence segmentation',
     2, 'medium',
     [('apps/host/src/client/useLocalVoice.ts', 'primary'), ('apps/host/src/client/read-aloud.ts', 'secondary')]),
    ('F8', 'functionality', 'medium', 'Finance/News clones - no UI implementation',
     'API routes exist but no frontend UI for watchlist, charts, article list',
     'Clones planned but only backend routes built',
     'Build React components for finance watchlist, charts, news article list',
     4, 'high',
     [('apps/host/src/server/free-api-routes.ts', 'related'), ('apps/host/src/server/research-web.ts', 'related')]),
    ('U1', 'ui', 'medium', 'Notch lacks glassmorphism (Droppy/NotchNook style)',
     'TSX scaffold built but lacks backdrop-filter blur, vibrant accents, rounded corners',
     'notch.css has basic styles but no glassmorphism effects',
     'Add backdrop-filter: blur(20px), rgba backgrounds, border gradients, vibrant accents',
     4, 'medium',
     [('apps/desktop/desktop-ui/src/notch.css', 'primary'), ('apps/desktop/desktop-ui/src/NotchApp.tsx', 'secondary')]),
    ('U2', 'ui', 'medium', 'Sidebar auto-collapse causes layout shift',
     'Non-chat views force sidebar collapse, overriding user preference',
     'App.tsx lines 437-440 force setNavCollapsed(true) on non-chat views',
     'Add CSS transition for sidebar width; make collapse optional per-view',
     5, 'low',
     [('apps/host/src/client/App.tsx', 'primary'), ('apps/host/src/client/style.css', 'secondary')]),
    ('U3', 'ui', 'medium', 'Voice bar shows optimistic state instead of actual phase',
     'InlineVoiceBar uses its own useLocalVoice() instead of shared VoiceSessionContext',
     'InlineVoiceBar.tsx does not read from shared session state',
     'Make InlineVoiceBar read from useVoiceSession() context',
     4, 'low',
     [('apps/host/src/client/InlineVoiceBar.tsx', 'primary'), ('apps/host/src/client/voiceSession.tsx', 'secondary')]),
    ('U4', 'ui', 'low', 'No visual polish on empty/error states',
     'Empty states use basic div with text, no illustrations or CTAs',
     'Components use minimal empty states without visual hierarchy',
     'Add illustrated empty states with call-to-action buttons',
     7, 'medium',
     [('apps/host/src/client/AgentMailPanel.tsx', 'secondary'), ('apps/host/src/client/FilesSurfaceView.tsx', 'secondary'), ('apps/host/src/client/MemoryPanel.tsx', 'secondary')]),
    ('U5', 'ui', 'medium', 'Widgets panel blank in browser-only mode',
     'Fallback loads from /widgets API with no loading/error state or retry button',
     'App.tsx load() function swallows errors silently',
     'Add loading spinner, error banner, retry button to widgets panel',
     5, 'low',
     [('apps/host/src/client/App.tsx', 'primary')]),
    ('C1', 'security', 'critical', 'PowerShell script injection in computer-service.ts',
     'PowerShell scripts built via template literals with user-controlled input',
     'computer-service.ts uses replace(/\\\'/g, "\\\'\\\'") which is insufficient for injection prevention',
     'Use whitelisted commands; parameterize PowerShell arguments; no user input interpolation',
     1, 'high',
     [('apps/host/src/server/computer-service.ts', 'primary'), ('apps/host/src/server/computer-routes.ts', 'secondary')]),
    ('C2', 'security', 'critical', 'exec() arbitrary command execution',
     'exec action passes command directly to execAsync with no whitelisting',
     'computer-service.ts case exec: directly passes command to execAsync',
     'Implement command whitelisting; require explicit approval; audit log all exec commands',
     1, 'high',
     [('apps/host/src/server/computer-service.ts', 'primary')]),
    ('C3', 'security', 'high', 'Mail sender spoofing',
     'from address trusted from client body without authentication',
     'mail-routes.ts sendMail accepts from from request body without verifying sender',
     'Authenticate sender against session token; only allow user@aegis for authenticated users',
     2, 'medium',
     [('apps/host/src/server/mail-routes.ts', 'primary'), ('apps/host/src/server/mailbox.ts', 'secondary')]),
    ('C4', 'memory', 'high', 'Memory leak - WebSocket/AudioContext not cleaned',
     'ScriptProcessorNode deprecated; AudioContext not closed on all error paths',
     'useLocalVoice.ts uses deprecated ScriptProcessorNode; AudioContext not closed',
     'Replace ScriptProcessorNode with AudioWorkletNode; ensure audioContext.close() in all paths',
     2, 'medium',
     [('apps/host/src/client/useLocalVoice.ts', 'primary')]),
    ('C5', 'memory', 'medium', 'Memory leak - taskStatuses map grows unbounded',
     'taskStatuses ref map accumulates entries for every task ever seen',
     'App.tsx line 276 map updated but old entries never removed',
     'Prune old entries from taskStatuses map periodically',
     5, 'low',
     [('apps/host/src/client/App.tsx', 'primary')]),
    ('C6', 'memory', 'medium', 'Memory leak - event listeners not always removed',
     'Rapid view switching may leave orphaned window event listeners',
     'App.tsx multiple addEventListener calls with cleanup that may not run in time',
     'Use single event listener manager with AbortController pattern',
     5, 'medium',
     [('apps/host/src/client/App.tsx', 'primary')]),
    ('C7', 'security', 'medium', 'No CSP nonce for penboard inline scripts',
     'CSP allows /penboard inline scripts without nonce/hash',
     'app-origin.ts CSP header allows inline scripts for penboard',
     'Restrict inline scripts with nonce or hash; validate penboard input',
     4, 'medium',
     [('apps/host/src/server/app-origin.ts', 'primary'), ('apps/host/src/client/PenBoardPanel.tsx', 'secondary')]),
    ('C8', 'core', 'high', 'ELECTRON_RUN_AS_NODE not unset in start scripts',
     'If env var set globally, Electron runs as plain Node and crashes',
     'Start scripts do not unset ELECTRON_RUN_AS_NODE',
     'Add Remove-Item Env:ELECTRON_RUN_AS_NODE to start.ps1; unset to start.bat/start.sh',
     2, 'low',
     [('aegis/start.ps1', 'primary'), ('aegis/start.bat', 'secondary'), ('aegis/start.sh', 'secondary')]),
    ('C9', 'security', 'critical', 'Hook command injection in hooks.ts',
     'hook.command is passed directly to powershell.exe -Command or /bin/sh -c without validation',
     'hooks.ts line 152-153: spawn(shell, [.., hook.command]) with no command whitelisting or sanitization',
     'Whitelist allowed commands; validate command against allowlist; no shell metacharacters',
     1, 'high',
     [('apps/host/src/server/hooks.ts', 'primary')]),
]


def link_file(cur, fpath):
    """Find file_id by trying multiple path patterns."""
    fpath_bs = fpath.replace("/", "\\")
    fpath_fs = fpath.replace("\\", "/")
    patterns = [
        f'%{fpath_fs}%', f'%{fpath_bs}%',
        f'%aegis\\{fpath_bs}%', f'%aegis/{fpath_fs}%',
        f'%\\{fpath_bs}', f'%/{fpath_fs}',
    ]
    for pattern in patterns:
        cur.execute(
            "SELECT id FROM files WHERE relative_path LIKE ? OR abs_path LIKE ? OR path LIKE ?",
            (pattern, pattern, pattern)
        )
        row = cur.fetchone()
        if row:
            return row[0]
    return None


def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Clear existing issue data
    cur.execute("DELETE FROM fix_history")
    cur.execute("DELETE FROM issue_files")
    cur.execute("DELETE FROM issues")

    for (issue_id, category, severity, title, desc, root, fix, prio, effort, files) in ISSUES:
        cur.execute(
            """INSERT OR REPLACE INTO issues
               (issue_id, category, severity, title, description, root_cause, fix,
                priority, effort, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')""",
            (issue_id, category, severity, title, desc, root, fix, prio, effort)
        )
        cur.execute("SELECT id FROM issues WHERE issue_id = ?", (issue_id,))
        issue_db_id = cur.fetchone()[0]

        for fpath, role in files:
            fid = link_file(cur, fpath)
            if fid:
                cur.execute(
                    """INSERT OR IGNORE INTO issue_files (issue_id, file_id, role)
                       VALUES (?, ?, ?)""",
                    (issue_db_id, fid, role)
                )
            else:
                print(f"  Warning: File not indexed: {fpath}")

    conn.commit()
    print(f"Seeded {len(ISSUES)} issues with file links.")
    conn.close()


if __name__ == '__main__':
    main()
