// Top-level error boundary. Without one, ANY thrown exception during render
// (an unexpected roster/profile shape from soul or the store worker, a
// character-catalog lookup returning undefined, etc.) unmounts the entire
// React tree to a blank #root with no way back short of quitting. This
// converts every render bug from "white screen, force-quit" into a
// recoverable surface with Reload + Open logs.
//
// Must be a class component , React error boundaries have no hooks equivalent.

import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console (teed into the renderer devtools) so the stack
    // is recoverable even though we swallow the crash for the user.
    console.error('[unclaw] render crash caught by ErrorBoundary:', error, info.componentStack);
  }

  private handleReload = () => {
    // Full renderer reload. The main process + soul + UE are untouched, so
    // this re-mounts the UI against the still-live backend , far cheaper
    // than an app restart, and it clears whatever transient state threw.
    window.location.reload();
  };

  private handleOpenLogs = () => {
    void window.electronAPI?.soul?.openLogs?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#050506',
          color: 'rgba(255,255,255,0.9)',
          fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif',
          padding: '0 48px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
          Something went wrong
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.6)', maxWidth: 380 }}>
          Unclaw hit an unexpected error. Reloading usually fixes it, your companion keeps running in the background.
        </div>
        <details style={{ maxWidth: 460, width: '100%' }}>
          <summary style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', userSelect: 'none' }}>
            Show details
          </summary>
          <pre style={{
            marginTop: 8,
            maxHeight: 160,
            overflow: 'auto',
            textAlign: 'left',
            fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
            fontSize: 10,
            lineHeight: 1.5,
            color: 'rgba(220, 170, 160, 0.7)',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            padding: '10px 12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {String(error.stack || error.message || error)}
          </pre>
        </details>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '10px 26px',
              borderRadius: 999,
              border: '1px solid rgba(196, 68, 68, 0.5)',
              background: 'var(--accent-dim, rgba(196,68,68,0.16))',
              color: 'rgba(255,255,255,0.95)',
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.handleOpenLogs}
            style={{
              padding: '10px 20px',
              borderRadius: 999,
              border: '1px solid rgba(255, 255, 255, 0.16)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Open logs
          </button>
        </div>
      </div>
    );
  }
}
