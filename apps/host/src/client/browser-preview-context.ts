import { createContext, useContext } from 'react';

// AEGIS (W-LIVE): the browse tool pushes the page it loaded to the chat as a
// custom event (`aegis.browser_preview`). The chat keeps the newest preview
// per URL here, so the tool card can draw the real page while the call is
// still in flight. Re-fetching through /browse-preview is not an option there:
// the browser service serialises jobs and answers "Browser is busy" while the
// tool's own browse runs.
export type LivePagePreview = {
  url: string;
  title: string;
  screenshot: string;
};

export function previewKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export type BrowserPreviewStore = {
  threadId: string;
  previews: Record<string, LivePagePreview>;
};

export const BrowserPreviewContext = createContext<BrowserPreviewStore>({
  threadId: '',
  previews: {},
});

export function useBrowserPreviewStore(): BrowserPreviewStore {
  return useContext(BrowserPreviewContext);
}

export function useLivePagePreview(url: string): LivePagePreview | undefined {
  const { previews } = useBrowserPreviewStore();
  if (!url) return undefined;
  return previews[previewKey(url)];
}
