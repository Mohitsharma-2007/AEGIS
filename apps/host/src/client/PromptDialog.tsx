import { useEffect, useRef, useState } from 'react';

// Electron renderers do not implement window.prompt: calling it throws
// "prompt() is not supported", so every feature that asked for a line of text
// (renaming a conversation, scheduling a task, saving a page, inserting a
// link) was broken in the desktop app. This is the in-app replacement.

export interface PromptRequest {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return a message to refuse the value, or undefined to accept it. */
  validate?: (value: string) => string | undefined;
}

type Resolver = (value: string | null) => void;

let host:
  | ((request: PromptRequest, resolve: Resolver) => void)
  | null = null;

/** Ask the owner for a line of text. Resolves to null when cancelled. */
export function promptText(request: PromptRequest): Promise<string | null> {
  if (!host) return Promise.resolve(null);
  return new Promise((resolve) => host?.(request, resolve));
}

export function PromptHost() {
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const resolverRef = useRef<Resolver | null>(null);

  useEffect(() => {
    host = (next, resolve) => {
      // Only one dialog at a time: a second request closes the first.
      resolverRef.current?.(null);
      resolverRef.current = resolve;
      setRequest(next);
      setValue(next.defaultValue ?? '');
      setError('');
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    return () => {
      host = null;
      resolverRef.current?.(null);
      resolverRef.current = null;
    };
  }, []);

  const finish = (result: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    setValue('');
    setError('');
    resolve?.(result);
  };

  if (!request) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) finish(null);
      }}
    >
      <div className="modal prompt-modal" role="dialog" aria-modal="true">
        <h2>{request.title}</h2>
        {request.message ? <p className="muted">{request.message}</p> : null}
        <label className="prompt-field">
          <span>{request.label ?? 'Value'}</span>
          <input
            ref={inputRef}
            value={value}
            placeholder={request.placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const problem = request.validate?.(value);
                if (problem) setError(problem);
                else finish(value);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                finish(null);
              }
            }}
          />
        </label>
        {error ? <p className="prompt-error">{error}</p> : null}
        <div className="modal-actions">
          <button className="secondary" onClick={() => finish(null)}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => {
              const problem = request.validate?.(value);
              if (problem) setError(problem);
              else finish(value);
            }}
          >
            {request.confirmLabel ?? 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
