import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Mermaid diagrams follow the workspace theme, so a graph drawn from agent
// markup does not stay light on a dark surface (or the reverse).
function appMermaidTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
}

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'default'>(appMermaidTheme);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(appMermaidTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${Math.random().toString(36).slice(2)}`;
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);
  if (error) {
    return (
      <pre className="mermaid-error" role="alert">
        {error}
      </pre>
    );
  }
  return <div className="mermaid-block" ref={ref} />;
}
