// Shared CLI-subscription provider status card. Renders the
// install/sign-in/ready state for keyless CLI providers (claude-code,
// gemini-cli, codex). Used by:
//
//   * SettingsPanel (Chat facet + Agentic facet) for post-onboarding
//     setup and ongoing status checks.
//   * Onboarding ConnectionsStep (LLM section + Agentic section) so a
//     first-run user can sign in to a CLI provider without leaving
//     onboarding.
//
// Self-contained: renders its own label + status chip, no FieldStack
// dependency. Drop in anywhere as a standalone block.
//
// Status states:
//   probing       , validateKeys is in-flight (or never fired yet)
//   ready         , CLI installed + OAuth token present, ready to use
//   setup_token   , CLI installed but needs `<provider> setup-token`
//   not_installed , the CLI binary isn't on PATH

import { useCallback, useState } from 'react';
import {
  AlertCircle, Check, Copy, Loader2, Terminal as TerminalIcon,
} from 'lucide-react';
import type {
  KeyValidationOutcome, LLMProviderId,
} from '../services/apiKeys';

/** Providers that authenticate via a local CLI's OAuth token instead
 *  of a request-body API key. Centralised here so both Settings and
 *  Onboarding share the same set, no risk of drift between surfaces. */
export const KEYLESS_CLI_PROVIDERS = new Set<LLMProviderId>([
  'claude-code', 'gemini-cli', 'codex',
]);

interface CliProviderMeta {
  /** What to call this provider in user-facing copy. */
  displayName: string;
  /** npm or installer command (rendered when not installed). */
  installCmd: string;
  /** One-time auth command (rendered when installed-but-not-signed-in). */
  setupCmd: string;
  /** What "ready" copy says about billing/quota for this provider. */
  readyDetail: string;
}

// Install commands track the OFFICIAL recommended install method per
// vendor (re-verified 2026-05-27). Claude + Codex have native one-line
// installers that don't require Node.js, those are now the canonical
// path; the npm packages still work but are no longer the first
// recommendation. Gemini CLI is still npm-only on Mac (no native
// installer published yet) and needs Node 20+.
const CLI_PROVIDER_META: Partial<Record<LLMProviderId, CliProviderMeta>> = {
  'claude-code': {
    displayName: 'Claude Code',
    // Native installer per https://code.claude.com/docs/en/setup — no
    // Node.js, auto-updates in background. Alt: `brew install
    // claude-code` or `npm install -g @anthropic-ai/claude-code`.
    installCmd: 'curl -fsSL https://claude.ai/install.sh | bash',
    setupCmd: 'claude setup-token',
    readyDetail: "Chat and agentic route through your Claude Pro or Max plan's Agent SDK credit.",
  },
  'gemini-cli': {
    displayName: 'Gemini CLI',
    // npm is the official path per https://geminicli.com/docs/get-started
    // /installation/ — requires Node 20+. Alt: `brew install gemini-cli`.
    installCmd: 'npm install -g @google/gemini-cli',
    setupCmd: 'gemini',
    readyDetail: 'Free tier covers 1000 requests/day on your personal Google account. Pro/Ultra subscription quota beyond that.',
  },
  'codex': {
    displayName: 'Codex',
    // Native installer per https://developers.openai.com/codex/cli — no
    // Node.js required. Alt: `npm install -g @openai/codex` (Node 18+).
    // WARNING: `npm i -g codex` (no scope) installs an unrelated 2012
    // package, must use the `@openai/` scope when going via npm.
    installCmd: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    setupCmd: 'codex login',
    readyDetail: 'GPT-5.x family routed through your ChatGPT Plus / Pro subscription credit.',
  },
};

interface Props {
  provider: LLMProviderId;
  outcome: KeyValidationOutcome | null;
  isProbing: boolean;
  /** When omitted, the header reads "Subscription". Pass a custom label
   *  if the host surface wants different wording (e.g. "Agentic
   *  Subscription" vs "Chat Subscription"). */
  label?: string;
}

export function CliProviderStatusCard({
  provider, outcome, isProbing, label = 'Subscription',
}: Props) {
  const meta = CLI_PROVIDER_META[provider] ?? CLI_PROVIDER_META['claude-code']!;

  type Status = 'probing' | 'ready' | 'setup_token' | 'not_installed';

  const status: Status = (() => {
    if (isProbing || outcome === null) return 'probing';
    if (outcome.ok) return 'ready';
    if (outcome.needs_setup_token) return 'setup_token';
    return 'not_installed';
  })();

  const palette = {
    probing:       { dot: 'var(--text-secondary)', tint: 'rgba(255,255,255,0.06)' },
    ready:         { dot: '#67c285',               tint: 'rgba(103,194,133,0.10)' },
    setup_token:   { dot: '#d4a35a',               tint: 'rgba(212,163,90,0.10)' },
    not_installed: { dot: 'var(--accent)',         tint: 'rgba(196,68,68,0.10)' },
  }[status];

  const headline: Record<Status, string> = {
    probing: `Checking for ${meta.displayName}`,
    ready: `Signed in to ${meta.displayName}`,
    setup_token: `${meta.displayName} is installed, but you need to sign in`,
    not_installed: `${meta.displayName} isn't installed on this computer`,
  };

  const statusWord: Record<Status, string> = {
    probing: 'probing',
    ready: 'ready',
    setup_token: 'sign-in needed',
    not_installed: 'not installed',
  };

  const detail: string = (() => {
    if (status === 'probing') return 'Looking for the local CLI and your stored OAuth token.';
    if (status === 'ready') {
      const v = outcome?.version ? `Detected ${outcome.version}. ` : '';
      return (v + meta.readyDetail).trim();
    }
    if (status === 'setup_token') {
      return outcome?.error
        || 'Run the command below in Terminal to complete OAuth. It opens once and stores a long-lived token.';
    }
    return outcome?.error || 'Install the CLI first, then run the sign-in command.';
  })();

  const command = status === 'not_installed' ? meta.installCmd : meta.setupCmd;
  const showCommand = status === 'setup_token' || status === 'not_installed';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header row: label on the left, live status chip on the right.
          Mirrors the visual shape of FieldStack so the card slots into
          a vertical Stack alongside other fields cleanly. */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <span style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-ghost)',
        }}>
          {label}
        </span>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10.5,
          color: palette.dot,
          letterSpacing: '0.01em',
        }}>
          {status === 'probing' && <Loader2 size={10} className="animate-spin" />}
          {status === 'ready' && <Check size={11} strokeWidth={2.5} />}
          {status === 'setup_token' && (
            <span style={{
              display: 'inline-block', width: 7, height: 7,
              borderRadius: '50%', background: palette.dot,
            }} />
          )}
          {status === 'not_installed' && <AlertCircle size={11} strokeWidth={2} />}
          <span>{statusWord[status]}</span>
        </span>
      </div>

      {/* Status box: tinted background by state, headline + detail copy,
          plus a copyable command pill when action is needed. */}
      <div style={{
        padding: '12px 14px',
        background: palette.tint,
        border: '1px solid var(--hairline)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div>
          <div style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--text-primary)',
            letterSpacing: '0.005em',
            marginBottom: 3,
          }}>
            {headline[status]}
          </div>
          <div style={{
            fontSize: 11.5,
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
            letterSpacing: '0.005em',
          }}>
            {detail}
          </div>
        </div>
        {showCommand && <CommandPill command={command} />}
      </div>
    </div>
  );
}

function CommandPill({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  }, [command]);

  const onOpen = useCallback(() => {
    void window.electronAPI?.openTerminalWithCommand?.(command);
  }, [command]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: 'rgba(0,0,0,0.28)',
      border: '1px solid var(--hairline)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <code style={{
        flex: 1,
        padding: '8px 12px',
        fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
        fontSize: 11.5,
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        overflowX: 'auto',
        letterSpacing: '0.005em',
      }}>
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy command"
        title="Copy"
        style={CMD_PILL_BTN}
      >
        {copied
          ? <Check size={12} strokeWidth={2.5} style={{ color: '#67c285' }} />
          : <Copy size={12} strokeWidth={2} />}
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open in Terminal"
        title="Open in Terminal"
        style={CMD_PILL_BTN}
      >
        <TerminalIcon size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

const CMD_PILL_BTN: React.CSSProperties = {
  padding: '0 12px',
  background: 'transparent',
  border: 'none',
  borderLeft: '1px solid var(--hairline)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
