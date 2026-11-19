import { z } from 'zod';
export const computerPermissionsSchema = z
  .object({
    enabled: z.boolean(),
    browser: z.boolean(),
    files: z.boolean(),
    shell: z.boolean(),
  })
  .strict();
export type ComputerPermissions = z.infer<typeof computerPermissionsSchema>;
export interface ComputerAudit {
  id: string;
  action: string;
  actor: 'owner' | 'agent';
  outcome: 'pending' | 'succeeded' | 'failed';
  createdAt: number;
}
export interface ComputerControl {
  holder: 'bot' | 'human';
  requested: boolean;
  transitioning: boolean;
  resumeSnapshotRequired: boolean;
  request?: { id: string; status: string };
}
export interface ComputerStatus {
  configured: boolean;
  state: 'not_configured' | 'stopped' | 'running' | 'unavailable';
  permissions: ComputerPermissions;
  audit: ComputerAudit[];
  control?: ComputerControl;
  error?: string;
  /** AEGIS (W-COMP): how this computer is provisioned. 'local' runs as a
   * host process with NO sandbox isolation; 'docker' is the upstream
   * supervised container. */
  computerMode?: 'local' | 'docker';
  /** True only for the Docker container mode. Local mode is NOT isolated. */
  isolated?: boolean;
  /** Browser engine serving this computer ('playwright' local Chromium). */
  engine?: string;
  /** AEGIS (W-FIX 1a): which browser binary actually launched the local
   * session   the bundled Playwright Chromium, or the system Edge/Chrome
   * fallback   labelled truthfully by the launch ladder in
   * server/browser-launch.ts. Present only while a local session runs. */
  browserBinary?: string;
  /** Optional openmuse-engine sidecar slot, from the real sidecar probe. */
  aegisSidecar?: {
    label: string;
    configured: boolean;
    available: boolean;
    detail: string;
  };
}
const path = z
  .string()
  .max(1024)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !p.includes('\0') &&
      !p.split('/').some((s) => s === '..'),
    'Use a relative workspace path without traversal.',
  );
const empty = z.object({}).strict();
const ref = {
  ref: z.string().min(1).max(100),
  snapshotId: z.number().int().nonnegative(),
};
export const computerInputs = {
  navigate: z
    .object({
      url: z
        .string()
        .url()
        .max(2048)
        .refine(
          (s) =>
            ['http:', 'https:'].includes(new URL(s).protocol) &&
            !new URL(s).username &&
            !new URL(s).password,
        ),
    })
    .strict(),
  read: empty,
  snapshot: empty,
  screenshot: empty,
  browser_back: empty,
  browser_forward: empty,
  browser_reload: empty,
  click: z.object(ref).strict(),
  type: z
    .object({
      ...ref,
      text: z.string().max(16000),
      submit: z.boolean().optional(),
    })
    .strict(),
  key: z.object({ key: z.string().min(1).max(100) }).strict(),
  scroll: z
    .object({ deltaY: z.number().finite().min(-10000).max(10000) })
    .strict(),
  files_list: z.object({ path: path.default('') }).strict(),
  files_read: z.object({ path: path.refine((p) => p.length > 0) }).strict(),
  files_write: z
    .object({
      path: path.refine((p) => p.length > 0),
      contents: z.string().max(100000),
      append: z.boolean().optional(),
    })
    .strict(),
  exec: z
    .object({
      command: z.string().trim().min(1).max(8000),
      timeoutMs: z.number().int().min(1000).max(60000).default(30000),
    })
    .strict(),
  open_app: z
    .object({
      app: z.string().trim().min(1).max(60),
      // Optional target URL. When opening a browser (chrome/edge/browser/
      // youtube) the browser is launched or focused and navigated here so a
      // request like "open YouTube" actually lands on YouTube instead of a
      // blank browser window.
      url: z.string().url().max(2048).optional(),
    })
    .strict(),
  list_windows: empty,
  switch_window: z.object({ title: z.string().trim().min(1).max(300) }).strict(),
  window_switch: z.object({ title: z.string().trim().min(1).max(300) }).strict(),
  minimize_window: z.object({ title: z.string().trim().min(1).max(300) }).strict(),
  window_minimize: z.object({ title: z.string().trim().min(1).max(300) }).strict(),
  maximize_window: z.object({ title: z.string().trim().min(1).max(300) }).strict(),
  window_maximize: z.object({ title: z.string().trim().min(1).max(300) }).strict(),
  resize_window: z
    .object({
      title: z.string().trim().min(1).max(300),
      width: z.number().int().min(200).max(12000),
      height: z.number().int().min(120).max(8000),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
    })
    .strict(),
  window_resize: z
    .object({
      title: z.string().trim().min(1).max(300),
      width: z.number().int().min(200).max(12000),
      height: z.number().int().min(120).max(8000),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
    })
    .strict(),
  desktop_snapshot: empty,
  // Guidance annotations over the owner's real desktop. The overlay animates a
  // pointer to the target, draws a hand-drawn circle/arrow and a short note,
  // then stays until the agent verifies the new screen state or clears it.
  annotate: z
    .object({
      x: z.number().finite().min(0).max(32000).optional(),
      y: z.number().finite().min(0).max(32000).optional(),
      width: z.number().finite().min(1).max(12000).optional(),
      height: z.number().finite().min(1).max(8000).optional(),
      // Normalised box from the snapshot, as named edges so the order cannot be
      // misread (models frequently send [x1,y1,x2,y2]). All values are 0..1 of
      // the captured desktop; this survives DPI and multi-monitor scaling.
      bbox: z
        .object({
          top: z.number().finite().min(0).max(1),
          left: z.number().finite().min(0).max(1),
          bottom: z.number().finite().min(0).max(1),
          right: z.number().finite().min(0).max(1),
        })
        .strict()
        .optional(),
      label: z.string().trim().max(120).optional(),
      note: z.string().trim().max(400).optional(),
      step: z.number().int().min(1).max(20).optional(),
      shape: z.enum(['circle', 'box', 'arrow', 'pointer', 'none']).optional(),
      direction: z.enum(['left', 'right', 'up', 'down', 'none']).optional(),
      explanation: z.string().trim().max(500).optional(),
      next: z.string().trim().max(300).optional(),
      pointer: z.boolean().optional(),
      timeoutMs: z.number().int().min(2000).max(60000).optional(),
      unit: z.enum(['px', 'norm']).optional(),
      cursorName: z.string().trim().max(80).optional(),
      caption: z.string().trim().max(300).optional(),
      dim: z.boolean().optional(),
      targets: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
      drawings: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
      steps: z.array(z.record(z.string(), z.unknown())).max(30).optional(),
    })
    .strict(),
  clear_annotations: empty,
  mouse_click: z
    .object({
      x: z.number().finite().min(0).max(32000),
      y: z.number().finite().min(0).max(32000),
      button: z.enum(['left', 'right', 'middle']).optional(),
      double: z.boolean().optional(),
    })
    .strict(),
  mouse_move: z
    .object({
      x: z.number().finite().min(0).max(32000),
      y: z.number().finite().min(0).max(32000),
    })
    .strict(),
  mouse_drag: z
    .object({
      fromX: z.number().finite().min(0).max(32000).optional(),
      fromY: z.number().finite().min(0).max(32000).optional(),
      toX: z.number().finite().min(0).max(32000).optional(),
      toY: z.number().finite().min(0).max(32000).optional(),
      points: z
        .array(
          z
            .array(z.number().finite().min(0).max(32000))
            .length(2),
        )
        .optional(),
    })
    .refine(
      (data) =>
        (data.points && data.points.length >= 2) ||
        (data.fromX !== undefined &&
          data.fromY !== undefined &&
          data.toX !== undefined &&
          data.toY !== undefined),
      {
        message: 'mouse_drag requires either points array or fromX, fromY, toX, toY',
      },
    ),
  keyboard_type: z.object({ text: z.string().max(16000) }).strict(),
  keyboard_press: z.object({ key: z.string().min(1).max(100) }).strict(),
  desktop: z
    .object({
      command: z.enum([
        'snapshot',
        'find',
        'list-apps',
        'list-windows',
        'list-displays',
        'get',
        'is',
        'click',
        'set-value',
        'clear',
        'select',
        'toggle',
        'check',
        'uncheck',
        'expand',
        'collapse',
        'scroll',
        'scroll-to',
        'launch',
      ]),
      args: z.array(z.string().max(500)).max(20).optional(),
      label: z.string().max(80).optional(),
    })
    .strict(),
  ui_automation_tree: z
    .object({
      processName: z.string().optional(),
      title: z.string().optional(),
      maxDepth: z.number().int().min(1).max(10).optional(),
    })
    .strict(),
  human_click: z
    .object({
      x: z.number().finite().min(0).max(16000),
      y: z.number().finite().min(0).max(16000),
    })
    .strict(),
  human_type: z.object({ text: z.string().max(16000) }).strict(),
  human_key: z.object({ key: z.string().min(1).max(100) }).strict(),
  human_scroll: z
    .object({ deltaY: z.number().finite().min(-10000).max(10000) })
    .strict(),
};
export type ComputerAction = keyof typeof computerInputs;
