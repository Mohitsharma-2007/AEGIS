#!/usr/bin/env python3
"""
Seed the issues from DEEP_ANALYSIS_ISSUES.md into the Context Memory database.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")

ISSUES = [
    # === Category 1: Functionality ===
    {
        'issue_id': 'F1', 'category': 'functionality', 'severity': 'high',
        'title': 'Voice mode auto-switches to text while listening',
        'description': 'App.tsx resets emptyInlineVoice on thread change even while mic is live',
        'root_cause': 'App.tsx line 308-310: setEmptyInlineVoice(false) on thread change resets voice state mid-turn',
        'fix': "Guard with 'if (!isAnyVoiceActive) setEmptyInlineVoice(false);'",
        'priority': 2, 'effort': 'low',
        'files': [
            ('apps/host/src/client/App.tsx', 'primary'),
            ('apps/host/src/client/Chat.tsx', 'secondary'),
            ('apps/host/src/client/voiceSession.tsx', 'related'),
        ]
    },
    {
        'issue_id': 'F2', 'category': 'functionality', 'severity': 'high',
        'title': 'Microphone not released when leaving voice mode',
        'description': 'WebSocket/AudioContext cleanup may not run on unexpected unmount',
        'root_cause': 'useLocalVoice.ts cleanup depends on stop() callback identity',
        'fix': 'Add beforeunload/pagehide listener; ensure releaseInput() in all error paths',
        'priority': 3, 'effort': 'medium',
        'files': [
            ('apps/host/src/client/useLocalVoice.ts', 'primary'),
            ('apps/host/src/client/voiceSession.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'F3', 'category': 'functionality', 'severity': 'medium',
        'title': '/call silent no-op in browser-only mode',
        'description': 'Widget call fails silently if bridge.action is undefined',
        'root_cause': 'App.tsx onCallWidget handler does not validate widget name',
        'fix': 'Add widget name validation and fallback error for desktop mode',
        'priority': 5, 'effort': 'low',
        'files': [
            ('apps/host/src/client/App.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'F4', 'category': 'functionality', 'severity': 'high',
        'title': 'Mail report not sent on host restart for in-flight tasks',
        'description': 'mail-processed.json write failure silently caught; inflight map lost on crash',
        'root_cause': 'mail-orchestrator.ts saveProcessed failure caught and ignored',
        'fix': 'Add retry for saveProcessed; startup reconciliation for orphaned tasks',
        'priority': 3, 'effort': 'medium',
        'files': [
            ('apps/host/src/server/mail-orchestrator.ts', 'primary'),
            ('apps/host/src/server/mailbox.ts', 'secondary'),
            ('apps/host/src/server/agent-swarm.ts', 'related'),
        ]
    },
    {
        'issue_id': 'F5', 'category': 'functionality', 'severity': 'medium',
        'title': 'Swarm task dispatch - no provider fallback',
        'description': 'Provider failure (401/402/403/rate limit) fails entire task',
        'root_cause': 'agent-swarm.ts uses configured provider without fallback chain',
        'fix': 'Add provider fallback chain in dispatch logic',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('apps/host/src/server/agent-swarm.ts', 'primary'),
            ('apps/host/src/server/providers.ts', 'secondary'),
        ]
    },
    {
        'issue_id': 'F6', 'category': 'functionality', 'severity': 'medium',
        'title': 'Computer service - orphaned sessions on host crash',
        'description': 'Playwright browser contexts tracked in-memory; host crash leaves orphaned processes',
        'root_cause': 'computer-service.ts only handles graceful context close, not process crash',
        'fix': 'Add startup cleanup for orphaned processes; add session TTL',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('apps/host/src/server/computer-service.ts', 'primary'),
            ('apps/host/src/server/browser-launch.ts', 'secondary'),
        ]
    },
    {
        'issue_id': 'F7', 'category': 'functionality', 'severity': 'high',
        'title': 'Voice/TTS - no sentence segmentation or punctuation stripping',
        'description': 'TTS receives raw markdown (**$, ?, #, *, _, etc.) without preprocessing',
        'root_cause': 'useLocalVoice.ts playChunk() sends raw text to synthesizer',
        'fix': 'Add sanitizeForTTS() with punctuation stripping and sentence segmentation',
        'priority': 2, 'effort': 'medium',
        'files': [
            ('apps/host/src/client/useLocalVoice.ts', 'primary'),
            ('apps/host/src/client/read-aloud.ts', 'secondary'),
        ]
    },
    {
        'issue_id': 'F8', 'category': 'functionality', 'severity': 'medium',
        'title': 'Finance/News clones - no UI implementation',
        'description': 'API routes exist but no frontend UI for watchlist, charts, article list',
        'root_cause': 'Clones planned but only backend routes built',
        'fix': 'Build React components for finance watchlist, charts, news article list',
        'priority': 4, 'effort': 'high',
        'files': [
            ('apps/host/src/server/free-api-routes.ts', 'related'),
            ('apps/host/src/server/research-web.ts', 'related'),
        ]
    },

    # === Category 2: UI & Visual ===
    {
        'issue_id': 'U1', 'category': 'ui', 'severity': 'medium',
        'title': 'Notch lacks glassmorphism (Droppy/NotchNook style)',
        'description': 'TSX scaffold built but lacks backdrop-filter blur, vibrant accents, rounded corners',
        'root_cause': 'notch.css has basic styles but no glassmorphism effects',
        'fix': 'Add backdrop-filter: blur(20px), rgba backgrounds, border gradients, vibrant accents',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('apps/desktop/desktop-ui/src/notch.css', 'primary'),
            ('apps/desktop/desktop-ui/src/NotchApp.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'U2', 'category': 'ui', 'severity': 'medium',
        'title': 'Sidebar auto-collapse causes layout shift',
        'description': 'Non-chat views force sidebar collapse, overriding user preference',
        'root_cause': 'App.tsx lines 437-440 force setNavCollapsed(true) on non-chat views',
        'fix': 'Add CSS transition for sidebar width; make collapse optional per-view',
        'priority': 5, 'effort': 'low',
        'files': [
            ('apps/host/src/client/App.tsx', 'primary'),
            ('apps/host/src/client/style.css', 'secondary'),
        ]
    },
    {
        'issue_id': 'U3', 'category': 'ui', 'severity': 'medium',
        'title': 'Voice bar shows optimistic state instead of actual phase',
        'description': 'InlineVoiceBar uses its own useLocalVoice() instead of shared VoiceSessionContext',
        'root_cause': 'InlineVoiceBar.tsx does not read from shared session state',
        'fix': 'Make InlineVoiceBar read from useVoiceSession() context',
        'priority': 4, 'effort': 'low',
        'files': [
            ('apps/host/src/client/InlineVoiceBar.tsx', 'primary'),
            ('apps/host/src/client/voiceSession.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'U4', 'category': 'ui', 'severity': 'low',
        'title': 'No visual polish on empty/error states',
        'description': 'Empty states use basic div with text, no illustrations or CTAs',
        'root_cause': 'Components use minimal empty states without visual hierarchy',
        'fix': 'Add illustrated empty states with call-to-action buttons',
        'priority': 7, 'effort': 'medium',
        'files': [
            ('apps/host/src/client/AgentMailPanel.tsx', 'secondary'),
            ('apps/host/src/client/FilesSurfaceView.tsx', 'secondary'),
            ('apps/host/src/client/MemoryPanel.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'U5', 'category': 'ui', 'severity': 'medium',
        'title': 'Widgets panel blank in browser-only mode',
        'description': 'Fallback loads from /widgets API with no loading/error state or retry button',
        'root_cause': 'App.tsx load() function swallows errors silently',
        'fix': 'Add loading spinner, error banner, retry button to widgets panel',
        'priority': 5, 'effort': 'low',
        'files': [
            ('apps/host/src/client/App.tsx', 'primary'),
        ]
    },

    # === Category 3: Core, Security, Memory ===
    {
        'issue_id': 'C1', 'category': 'security', 'severity': 'critical',
        'title': 'PowerShell script injection in computer-service.ts',
        'description': 'PowerShell scripts built via template literals with user-controlled input',
        'root_cause': 'computer-service.ts uses replace(/\\\'/g, "\\\'\\\'") which is insufficient for injection prevention',
        'fix': 'Use whitelisted commands; parameterize PowerShell arguments; no user input interpolation',
        'priority': 1, 'effort': 'high',
        'files': [
            ('apps/host/src/server/computer-service.ts', 'primary'),
            ('apps/host/src/server/computer-routes.ts', 'secondary'),
        ]
    },
    {
        'issue_id': 'C2', 'category': 'security', 'severity': 'critical',
        'title': 'exec() arbitrary command execution',
        'description': 'exec action passes command directly to execAsync with no whitelisting',
        'root_cause': 'computer-service.ts case exec: directly passes command to execAsync',
        'fix': 'Implement command whitelisting; require explicit approval; audit log all exec commands',
        'priority': 1, 'effort': 'high',
        'files': [
            ('apps/host/src/server/computer-service.ts', 'primary'),
        ]
    },
    {
        'issue_id': 'C3', 'category': 'security', 'severity': 'high',
        'title': 'Mail sender spoofing',
        'description': 'from address trusted from client body without authentication',
        'root_cause': 'mail-routes.ts sendMail accepts from from request body without verifying sender',
        'fix': 'Authenticate sender against session token; only allow user@aegis for authenticated users',
        'priority': 2, 'effort': 'medium',
        'files': [
            ('apps/host/src/server/mail-routes.ts', 'primary'),
            ('apps/host/src/server/mailbox.ts', 'secondary'),
        ]
    },
    {
        'issue_id': 'C4', 'category': 'memory', 'severity': 'high',
        'title': 'Memory leak - WebSocket/AudioContext not cleaned',
        'description': 'ScriptProcessorNode deprecated; AudioContext not closed on all error paths',
        'root_cause': 'useLocalVoice.ts uses deprecated ScriptProcessorNode; AudioContext not closed',
        'fix': 'Replace ScriptProcessorNode with AudioWorkletNode; ensure audioContext.close() in all paths',
        'priority': 2, 'effort': 'medium',
        'files': [
            ('apps/host/src/client/useLocalVoice.ts', 'primary'),
        ]
    },
    {
        'issue_id': 'C5', 'category': 'memory', 'severity': 'medium',
        'title': 'Memory leak - taskStatuses map grows unbounded',
        'description': 'taskStatuses ref map accumulates entries for every task ever seen',
        'root_cause': 'App.tsx line 276 map updated but old entries never removed',
        'fix': 'Prune old entries from taskStatuses map periodically',
        'priority': 5, 'effort': 'low',
        'files': [
            ('apps/host/src/client/App.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'C6', 'category': 'memory', 'severity': 'medium',
        'title': 'Memory leak - event listeners not always removed',
        'description': 'Rapid view switching may leave orphaned window event listeners',
        'root_cause': 'App.tsx multiple addEventListener calls with cleanup that may not run in time',
        'fix': 'Use single event listener manager with AbortController pattern',
        'priority': 5, 'effort': 'medium',
        'files': [
            ('apps/host/src/client/App.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'C7', 'category': 'security', 'severity': 'medium',
        'title': 'No CSP nonce for penboard inline scripts',
        'description': 'CSP allows /penboard inline scripts without nonce/hash',
        'root_cause': 'app-origin.ts CSP header allows inline scripts for penboard',
        'fix': 'Restrict inline scripts with nonce or hash; validate penboard input',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('apps/host/src/server/app-origin.ts', 'primary'),
            ('apps/host/src/client/PenBoardPanel.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'C8', 'category': 'core', 'severity': 'high',
        'title': 'ELECTRON_RUN_AS_NODE not unset in start scripts',
        'description': 'If env var set globally, Electron runs as plain Node and crashes',
        'root_cause': 'Start scripts do not unset ELECTRON_RUN_AS_NODE',
        'fix': 'Add Remove-Item Env:ELECTRON_RUN_AS_NODE to start.ps1; unset to start.bat/start.sh',
        'priority': 2, 'effort': 'low',
        'files': [
            ('aegis/start.ps1', 'primary'),
            ('aegis/start.bat', 'secondary'),
            ('aegis/start.sh', 'secondary'),
        ]
    },
    {
        'issue_id': 'C10', 'category': 'core', 'severity': 'critical',
        'title': 'Temporal dead zone crash: block-scoped variables used before declaration in App.tsx',
        'description': 'ReferenceError: Cannot access \'ae\' before initialization at runtime. Block-scoped state variables (rawSetView, setIntegrationsTab, setPane, setError, setNavCollapsed, isAnyVoiceActive) were referenced in useCallback/useEffect dependency arrays before their useState declarations later in the component body.',
        'root_cause': 'App.tsx had useState declarations for view, integrationsTab, pane, error/setError, navCollapsed, emptyInlineVoice/chatInlineVoice/inlineVoiceToken, and isAnyVoiceActive scattered below the useCallback/useEffect blocks that referenced them, causing TDZ errors on first render.',
        'fix': 'Moved all state declarations referenced before their definition to the top of the App() component, right after the initial useState calls, and removed duplicate declarations.',
        'priority': 1, 'effort': 'high',
        'files': [
            ('aegis/apps/host/src/client/App.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'U6', 'category': 'ui', 'severity': 'medium',
        'title': 'Composer textarea has black border instead of styled border',
        'description': 'Composer textarea (.chat-compose-row) missing explicit border declaration, causing default black border to appear. Also missing proper padding and background styling.',
        'root_cause': '.chat-compose-row CSS has border-radius and background but no explicit border-width/style, falling back to browser default (1px solid black). Parent container needs position: relative for command menu absolute positioning.',
        'fix': 'Add explicit border: 1px solid var(--line), background: var(--surface), position: relative, and improved padding to .chat-compose-row. Also fix duplicate .chat-compose-row CSS definition.',
        'priority': 4, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/client/style.css', 'primary'),
        ]
    },
    {
        'issue_id': 'U7', 'category': 'ui', 'severity': 'medium',
        'title': '" /" and "@" command menu not visible when triggered',
        'description': 'Command menu logic exists in Chat.tsx but .chat-compose-row parent lacks position: relative for absolute-positioned .cmd-menu, so the menu may render off-screen or behind other elements.',
        'root_cause': '.cmd-menu uses position: absolute but parent .chat-compose-row does not have position: relative, causing incorrect positioning.',
        'fix': 'Add position: relative to .chat-compose-row so command menu positions correctly relative to the composer.',
        'priority': 3, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/client/style.css', 'primary'),
        ]
    },
    {
        'issue_id': 'U8', 'category': 'ui', 'severity': 'low',
        'title': 'UI padding improvements needed for composer and chat area',
        'description': 'Composer padding is too tight (8px), chat area padding needs refinement for better visual breathing room.',
        'root_cause': '.chat-compose-row padding is only 8px, .live-chat padding could be improved.',
        'fix': 'Increase .chat-compose-row padding to 10px 12px, review .live-chat padding for better spacing.',
        'priority': 6, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/client/style.css', 'primary'),
        ]
    },
    {
        'issue_id': 'U9', 'category': 'ui', 'severity': 'medium',
        'title': 'Notch not visible in web view',
        'description': 'Desktop notch panel not rendered in browser-only mode, making desktop-only features inaccessible from web.',
        'root_cause': 'Notch component not conditionally rendered for browser-only mode.',
        'fix': 'Add notch rendering fallback for web/browser-only mode.',
        'priority': 5, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/client/App.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'U10', 'category': 'ui', 'severity': 'high',
        'title': 'Website closes early / app terminates unexpectedly',
        'description': 'The Aegis web application closes or terminates prematurely, possibly due to unhandled client-side errors, service worker issues, or navigation state problems.',
        'root_cause': 'Potential causes: unhandled promise rejections, missing error boundaries, service worker termination, or improper cleanup on route changes.',
        'fix': 'Add global error boundary, handle unhandled rejections, ensure proper cleanup on unmount, and verify service worker registration.',
        'priority': 2, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/client/App.tsx', 'primary'),
            ('aegis/apps/host/src/client/index.html', 'secondary'),
        ]
    },
    {
        'issue_id': 'U11', 'category': 'ui', 'severity': 'medium',
        'title': 'Visual Annotation and Rendering Engine - missing feature',
        'description': 'New feature: Win+Shift hotkey to enter annotation mode, draw/highlight regions on screen, then ask Aegis to explain the annotated area. Supports real-time drawings with pen, eraser, line, arrow, rect, circle, and text tools.',
        'root_cause': 'Feature not yet implemented.',
        'fix': 'Created AnnotationEngine.tsx component with Win+Shift global hotkey, canvas-based drawing overlay, multiple tools, color/width controls, clear/capture functionality, and integration with App.tsx.',
        'priority': 3, 'effort': 'high',
        'files': [
            ('aegis/apps/host/src/client/AnnotationEngine.tsx', 'primary'),
            ('aegis/apps/host/src/client/App.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'U12', 'category': 'ui', 'severity': 'medium',
        'title': 'Delete icon missing in agents page',
        'description': 'The delete icon/button is not present in the agents management page, preventing users from removing agents.',
        'root_cause': 'Delete action button not implemented in the agent card/component UI.',
        'fix': 'Add delete button with trash icon to each agent card in the agents page.',
        'priority': 4, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/client/AgentsWorkspace.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'U13', 'category': 'ui', 'severity': 'medium',
        'title': 'File previews missing for images, video, doc, PPT, Excel',
        "description": 'File attachments do not show previews for common file types (images, video, .doc, .ppt, .xlsx). Users cannot see file content in chat.',
        'root_cause': 'File preview component lacks support for multiple file MIME types and rendering engines.',
        'fix': 'Implement file preview support for images (img tag), video (video tag), and office documents (doc/ppt/xlsx viewers).',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/client/Chat.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'U14', 'category': 'ui', 'severity': 'low',
        'title': 'Generated document UI needs improvement',
        'description': 'Generated documents have poor UI/UX and lack proper formatting and functionality.',
        'root_cause': 'Document generation output uses basic styling without professional layout.',
        'fix': 'Improve generated document UI with better typography, layout, and export functionality.',
        'priority': 5, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/client/VisualCards.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'U15', 'category': 'ui', 'severity': 'medium',
        'title': 'Memory diamond status alert shows incorrectly',
        'description': 'Memory diamond status alert appears even when diamond is connected, showing for a few seconds then disappearing. Should only show when disconnected.',
        'root_cause': 'Status check runs on page load instead of on connect, and doesn\'t persist connection state.',
        'fix': 'Check diamond status on component mount and cache the result. Only show alert when actually disconnected.',
        'priority': 5, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/client/MemoryPanel.tsx', 'primary'),
        ]
    },
    {
        'issue_id': 'U16', 'category': 'ui', 'severity': 'high',
        'title': 'Finance page needs Google Finance replication',
        'description': 'Finance page should replicate Google Finance with full functionality: graphs, news, balance sheets, company data, and AI features.',
        'root_cause': 'Finance page not yet implemented with real financial data integration.',
        'fix': 'Build finance page with stock charts, company profiles, financial statements, news aggregation, and AI analysis.',
        'priority': 3, 'effort': 'high',
        'files': [
            ('aegis/apps/host/src/client/FinancePage.tsx', 'new'),
        ]
    },
    {
        'issue_id': 'U17', 'category': 'ui', 'severity': 'medium',
        'title': 'Reverse AI concept engine',
        'description': 'AI concept engine needs to be reversed/reworked for proper functionality.',
        'root_cause': 'AI concept engine logic needs architectural revision.',
        'fix': 'Review and reverse the AI concept engine implementation for better concept mapping and relationship analysis.',
        'priority': 4, 'effort': 'high',
        'files': [
            ('aegis/apps/host/src/server/agent-swarm.ts', 'primary'),
        ]
    },
    {
        'issue_id': 'U18', 'category': 'ui', 'severity': 'medium',
        'title': 'News intelligence should use 2050 news engine',
        "description": 'Global news intelligence currently depends only on Google News RSS. Should use 2050 news engine for real-time same-day news data ingestion.',
        'root_cause': 'News source limited to Google News RSS only.',
        'fix': 'Integrate 2050 news engine for real-time news. When user asks for news, source from internal data collection engine instead of external search.',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/server/research.ts', 'primary'),
        ]
    },
    {
        'issue_id': 'U19', 'category': 'ui', 'severity': 'medium',
        'title': 'Research sources need expansion',
        'description': 'Research should depend on Open Alex, Research Gate, Google Scholar, and arXiv APIs instead of only Open Alex.',
        'root_cause': 'Research data sources are too limited.',
        'fix': 'Integrate Research Gate, Google Scholar, and arXiv APIs alongside Open Alex for comprehensive research coverage.',
        'priority': 4, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/server/research.ts', 'primary'),
        ]
    },
    {
        'issue_id': 'U20', 'category': 'ui', 'severity': 'medium',
        'title': 'WebScraper and GitHub integration needed',
        'description': 'Add WebScraper functionality and improve GitHub repository and code analysis section. Also improve settings URL setting section.',
        'root_cause': 'Web scraping and GitHub integration features not implemented.',
        'fix': 'Implement WebScraper for web content extraction, enhance GitHub repo analysis, and improve settings URL configuration UI.',
        'priority': 5, 'effort': 'medium',
        'files': [
            ('aegis/apps/host/src/server/web-scraper.ts', 'new'),
            ('aegis/apps/host/src/client/SettingsForm.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'H1', 'category': 'functionality', 'severity': 'high',
        'title': 'Harness prompt held the HTTP request open for minutes',
        'description': 'POST /harness/sessions/:id/prompt awaited completeConversation (90s timeout x 3 attempts) before responding, so a cold local model made the panel look hung and the request could be cut before the reply was stored.',
        'root_cause': 'sendNativePrompt awaited the model call instead of returning after queueing it; both callers already poll the session messages.',
        'fix': 'Return as soon as the assistant message id is reserved and answer in the background, pushing the reply into the session when the model finishes (and a fallback message on failure).',
        'priority': 2, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/server/harness.ts', 'primary'),
            ('aegis/apps/host/src/client/HarnessPanel.tsx', 'secondary'),
        ]
    },
    {
        'issue_id': 'H2', 'category': 'functionality', 'severity': 'medium',
        'title': 'Harness tool runtime faked success',
        'description': 'Approving a tool: command ran node to print "Invoked tool: <name>", which reported success in the log while executing nothing.',
        'root_cause': 'The tool runtime had no handler and a placeholder branch that produced a success-looking execution record.',
        'fix': 'Report honestly that no tool handler is wired, point at the working runtimes, and keep the approval record.',
        'priority': 3, 'effort': 'low',
        'files': [
            ('aegis/apps/host/src/server/harness.ts', 'primary'),
        ]
    },
    {
        'issue_id': 'D1', 'category': 'functionality', 'severity': 'medium',
        'title': 'Duplicate desktop surface sources and builders',
        'description': 'ui-kit/src was a stale fork of desktop-ui/src, ui-kit/build.mjs was a second builder over that fork, and an orphaned React notch was wired as the desktop-ui build script, so running it overwrote the real ui-kit/notch.html. Root copies of the surfaces also shipped stale.',
        'root_cause': 'Two parallel UI pipelines were left in place when the HTML surfaces replaced the React notch, and the stale one owned the build script.',
        'fix': 'Point the build script at the canonical build.mjs, delete the fork, the second builder, the orphaned React notch and every stale root copy; packaging now ships only ui-kit/*.html.',
        'priority': 3, 'effort': 'medium',
        'files': [
            ('aegis/apps/desktop/desktop-ui/package.json', 'primary'),
            ('aegis/apps/desktop/package.json', 'secondary'),
            ('aegis/tests/verify-agent-widget-integration.mjs', 'related'),
        ]
    },
    {
        'issue_id': 'D2', 'category': 'functionality', 'severity': 'critical',
        'title': 'start.ps1 could not launch the app at all (corrupt byte)',
        'description': 'The Windows launcher contained a literal BEL byte (0x07) inside $dots = "$Root?pps\\host", so the host path resolved to a non-existent directory. The launcher therefore never started the host, the browser sidecar or the WhatsApp sidecar, and the desktop app had nothing to load.',
        'root_cause': 'A \\a escape was written into the file as a real 0x07 control byte instead of the four characters backslash-a-p-p-s, most likely from a non-escaped string substitution in an earlier edit.',
        'fix': 'Replaced the control byte with the literal apps path, confirmed zero BEL bytes remain in the file, and checked it parses with the PowerShell AST parser before launching.',
        'priority': 1, 'effort': 'low',
        'files': [
            ('aegis/start.ps1', 'primary'),
        ]
    },
]


def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    for issue in ISSUES:
        # Preserve a status that was already set. Seeding used to force every
        # row back to 'open', so re-running it after adding one issue silently
        # erased every recorded fix in the database.
        cur.execute("SELECT status FROM issues WHERE issue_id = ?", (issue['issue_id'],))
        row = cur.fetchone()
        status = row[0] if row and row[0] else 'open'

        # Insert issue
        cur.execute(
            """INSERT OR REPLACE INTO issues
               (issue_id, category, severity, title, description, root_cause, fix,
                priority, effort, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (issue['issue_id'], issue['category'], issue['severity'], issue['title'],
             issue['description'], issue['root_cause'], issue['fix'],
             issue['priority'], issue['effort'], status)
        )
        # Get issue id
        cur.execute("SELECT id FROM issues WHERE issue_id = ?", (issue['issue_id'],))
        issue_db_id = cur.fetchone()[0]

        # Link files
        for fpath, role in issue['files']:
            # Try multiple path formats: relative_path, abs_path, path
            # Handle both forward and backslash separators
            fpath_bs = fpath.replace("/", "\\")
            fpath_fs = fpath.replace("\\", "/")
            patterns = [
                f'%{fpath_fs}%',
                f'%{fpath_bs}%',
                f'%aegis\\{fpath_bs}%',
                f'%aegis/{fpath_fs}%',
                f'%\\{fpath_bs}',
                f'%/{fpath_fs}',
            ]
            frow = None
            for pattern in patterns:
                cur.execute("SELECT id FROM files WHERE relative_path LIKE ? OR abs_path LIKE ? OR path LIKE ?",
                            (pattern, pattern, pattern))
                frow = cur.fetchone()
                if frow:
                    break
            if frow:
                cur.execute(
                    """INSERT OR IGNORE INTO issue_files (issue_id, file_id, role)
                       VALUES (?, ?, ?)""",
                    (issue_db_id, frow[0], role)
                )
            else:
                print(f"  Warning: File not indexed: {fpath}")

    conn.commit()
    print(f"Seeded {len(ISSUES)} issues into Context Memory database.")
    conn.close()


if __name__ == '__main__':
    main()
