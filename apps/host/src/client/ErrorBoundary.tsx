import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, Home, Copy, Check } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, copied: false };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
    this.props.onReset?.();
  };

  private handleCopy = () => {
    const text = `${this.state.error?.name}: ${this.state.error?.message}\n${this.state.error?.stack || ''}\n${this.state.errorInfo?.componentStack || ''}`;
    navigator.clipboard?.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="aegis-recovery-wrapper">
          <div className="aegis-recovery-card" role="alert">
            <div className="aegis-recovery-badge">
              <img
                src="/assets/aegis-mark.svg"
                alt=""
                aria-hidden="true"
                width={30}
                height={30}
              />
            </div>

            <div className="aegis-recovery-headings">
              <span className="recovery-eyebrow">DIAGNOSTIC SYSTEM RECOVERY</span>
              <h2>{this.props.fallbackTitle ?? 'Aegis Desktop Recovery'}</h2>
              <p className="recovery-tagline">
                An isolated interface fault was caught and contained. Aegis state remains secure.
              </p>
            </div>

            <div className="aegis-recovery-error-box">
              <div className="error-title-row">
                <span className="error-type-tag">EXCEPTION</span>
                <span className="error-name">{this.state.error?.name || 'Error'}</span>
              </div>
              <p className="error-message-text">
                {this.state.error?.message || 'An error caused this view to stop rendering.'}
              </p>
            </div>

            {(this.state.error?.stack || this.state.errorInfo?.componentStack) && (
              <details className="aegis-recovery-details">
                <summary>
                  <span>Technical Diagnostic Stack</span>
                  <button
                    type="button"
                    className="copy-stack-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      this.handleCopy();
                    }}
                  >
                    {this.state.copied ? <Check size={12} /> : <Copy size={12} />}
                    <span>{this.state.copied ? 'Copied' : 'Copy Stack'}</span>
                  </button>
                </summary>
                <pre>{this.state.error?.stack || this.state.errorInfo?.componentStack}</pre>
              </details>
            )}

            <div className="aegis-recovery-actions">
              <button
                type="button"
                className="recovery-primary-btn"
                onClick={this.handleReset}
              >
                <RefreshCw size={14} />
                <span>Resume & Try Again</span>
              </button>

              <button
                type="button"
                className="recovery-secondary-btn"
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  window.location.hash = '';
                  window.location.reload();
                }}
              >
                <Home size={14} />
                <span>Reload Aegis Workspace</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
