// Embeddable auth panel — the provider buttons + email login/register/verify
// forms, with NO full-window framing or background of its own. Hosted by the
// onboarding wizard's "auth" step (the Hyperspace backdrop + window chrome live
// in the wizard). Extracted from the former standalone SignInScreen so login
// can fold into onboarding instead of gating the app behind a separate screen.

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Mail, AlertCircle, ArrowLeft } from 'lucide-react';
import {
  signInWithGoogle,
  signInWithDiscord,
  registerWithEmail,
  loginWithEmail,
  verifyEmailCode,
  resendVerificationCode,
  AuthError,
  type AuthSession,
} from '../../services/auth';

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface Props {
  onSignedIn: (session: AuthSession) => void;
}

type Mode =
  | { kind: 'choose' }
  | { kind: 'email-login' }
  | { kind: 'email-register' }
  | { kind: 'email-verify'; email: string };

export function AuthPanel({ onSignedIn }: Props) {
  const reduce = useReducedMotion() ?? false;
  const [mode, setMode] = useState<Mode>({ kind: 'choose' });
  const [busy, setBusy] = useState<null | 'google' | 'discord' | 'email'>(null);
  const [error, setError] = useState<string | null>(null);

  const handleProvider = async (provider: 'google' | 'discord') => {
    setBusy(provider);
    setError(null);
    try {
      const session =
        provider === 'google' ? await signInWithGoogle() : await signInWithDiscord();
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ width: '100%' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={mode.kind}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: EASE_OUT_EXPO }}
          >
            {mode.kind === 'choose' && (
              <ChooseProviders
                busy={busy}
                onProvider={handleProvider}
                onPickEmail={() => {
                  setError(null);
                  setMode({ kind: 'email-login' });
                }}
              />
            )}
            {mode.kind === 'email-login' && (
              <EmailLoginForm
                onBack={() => { setError(null); setMode({ kind: 'choose' }); }}
                onNeedRegister={() => { setError(null); setMode({ kind: 'email-register' }); }}
                onNeedVerify={(email) => { setError(null); setMode({ kind: 'email-verify', email }); }}
                onSession={onSignedIn}
                setError={setError}
              />
            )}
            {mode.kind === 'email-register' && (
              <EmailRegisterForm
                onBack={() => { setError(null); setMode({ kind: 'email-login' }); }}
                onNeedVerify={(email) => { setError(null); setMode({ kind: 'email-verify', email }); }}
                onSession={onSignedIn}
                setError={setError}
              />
            )}
            {mode.kind === 'email-verify' && (
              <EmailVerifyForm
                email={mode.email}
                onBack={() => { setError(null); setMode({ kind: 'email-login' }); }}
                onSession={onSignedIn}
                setError={setError}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            fontSize: 12.5,
            color: '#f1b5b5',
            padding: '8px 12px',
            background: 'rgba(196, 68, 68, 0.12)',
            border: '1px solid rgba(196, 68, 68, 0.35)',
            borderRadius: 10,
            width: '100%',
            boxSizing: 'border-box',
            letterSpacing: '-0.005em',
          }}
        >
          <AlertCircle size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent)' }} />
          <span style={{ lineHeight: 1.4 }}>{error}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Provider picker — three buttons + email link.
// ---------------------------------------------------------------------

function ChooseProviders({
  busy,
  onProvider,
  onPickEmail,
}: {
  busy: null | 'google' | 'discord' | 'email';
  onProvider: (p: 'google' | 'discord') => void;
  onPickEmail: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProviderButton
        label="Continue with Google"
        loading={busy === 'google'}
        disabled={busy !== null}
        onClick={() => onProvider('google')}
        icon={<GoogleGlyph />}
      />
      <ProviderButton
        label="Continue with Discord"
        loading={busy === 'discord'}
        disabled={busy !== null}
        onClick={() => onProvider('discord')}
        icon={<DiscordGlyph />}
      />
      <Divider />
      <ProviderButton
        label="Continue with email"
        disabled={busy !== null}
        onClick={onPickEmail}
        icon={<Mail size={16} strokeWidth={1.8} />}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Email subforms — login / register / verify.
// ---------------------------------------------------------------------

const FIELD_BASE: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--glass-border)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  letterSpacing: '-0.005em',
  transition:
    'border-color 0.16s var(--ease-out-quart), box-shadow 0.16s var(--ease-out-quart), background 0.16s var(--ease-out-quart)',
};

function applyFocus(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border-focus)';
  el.style.background = 'rgba(255, 255, 255, 0.06)';
  el.style.boxShadow = '0 0 0 3px rgba(196, 68, 68, 0.10)';
}
function applyBlur(el: HTMLElement) {
  el.style.borderColor = 'var(--glass-border)';
  el.style.background = 'rgba(255, 255, 255, 0.04)';
  el.style.boxShadow = 'none';
}

function EmailLoginForm({
  onBack, onNeedRegister, onNeedVerify, onSession, setError,
}: {
  onBack: () => void;
  onNeedRegister: () => void;
  onNeedVerify: (email: string) => void;
  onSession: (s: AuthSession) => void;
  setError: (e: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await loginWithEmail(email.trim(), password);
      if (res.kind === 'needs-verification') onNeedVerify(res.email);
      else onSession(res.session);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BackHeader title="Sign in with email" onBack={onBack} />
      <input
        type="email" autoFocus autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" style={FIELD_BASE}
        onFocus={(e) => applyFocus(e.target)} onBlur={(e) => applyBlur(e.target)}
      />
      <input
        type="password" autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Password" style={FIELD_BASE}
        onFocus={(e) => applyFocus(e.target)} onBlur={(e) => applyBlur(e.target)}
      />
      <PrimaryButton type="submit" loading={submitting} disabled={!email.trim() || !password || submitting}>
        Sign in
      </PrimaryButton>
      <button type="button" onClick={onNeedRegister} style={subtleLinkStyle}>
        Don't have an account? Create one
      </button>
    </form>
  );
}

function EmailRegisterForm({
  onBack, onNeedVerify, onSession, setError,
}: {
  onBack: () => void;
  onNeedVerify: (email: string) => void;
  onSession: (s: AuthSession) => void;
  setError: (e: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await registerWithEmail(email.trim(), password, name.trim());
      if (res.kind === 'needs-verification') onNeedVerify(res.email);
      else onSession(res.session);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-up failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BackHeader title="Create your account" onBack={onBack} />
      <input
        type="text" autoFocus autoComplete="name"
        value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Your name" style={FIELD_BASE}
        onFocus={(e) => applyFocus(e.target)} onBlur={(e) => applyBlur(e.target)}
      />
      <input
        type="email" autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" style={FIELD_BASE}
        onFocus={(e) => applyFocus(e.target)} onBlur={(e) => applyBlur(e.target)}
      />
      <input
        type="password" autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (8+ characters)" style={FIELD_BASE}
        onFocus={(e) => applyFocus(e.target)} onBlur={(e) => applyBlur(e.target)}
      />
      <PrimaryButton type="submit" loading={submitting}
        disabled={!name.trim() || !email.trim() || password.length < 8 || submitting}>
        Create account
      </PrimaryButton>
    </form>
  );
}

function EmailVerifyForm({
  email, onBack, onSession, setError,
}: {
  email: string;
  onBack: () => void;
  onSession: (s: AuthSession) => void;
  setError: (e: string | null) => void;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length !== 6) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await verifyEmailCode(email, trimmed);
      onSession(session);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError(null);
    try {
      await resendVerificationCode(email);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Resend failed');
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BackHeader title="Check your email" onBack={onBack} />
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
        We sent a 6-digit code to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
      </p>
      <input
        type="text" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6}
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        style={{ ...FIELD_BASE, fontFamily: 'ui-monospace, SFMono-Regular, monospace', letterSpacing: '0.4em', fontSize: 18, textAlign: 'center' }}
        onFocus={(e) => applyFocus(e.target)} onBlur={(e) => applyBlur(e.target)}
      />
      <PrimaryButton type="submit" loading={submitting} disabled={code.length !== 6 || submitting}>
        Verify
      </PrimaryButton>
      <button type="button" onClick={resend} disabled={resending} style={{ ...subtleLinkStyle, opacity: resending ? 0.5 : 1 }}>
        {resending ? 'Sending...' : 'Resend code'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <button
        type="button" onClick={onBack} aria-label="Back"
        style={{
          width: 24, height: 24, background: 'transparent', border: 'none', borderRadius: 6,
          color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s var(--ease-out-quart), color 0.15s var(--ease-out-quart)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
      >
        <ArrowLeft size={14} strokeWidth={2} />
      </button>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.005em', margin: 0 }}>
        {title}
      </h2>
    </div>
  );
}

function ProviderButton({
  label, icon, loading, disabled, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--glass-border)',
        borderRadius: 10, color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 14,
        fontWeight: 500, padding: '10px 14px', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !loading ? 0.5 : 1,
        transition: 'background 0.15s var(--ease-out-quart), border-color 0.15s var(--ease-out-quart)',
        width: '100%',
      }}
      onMouseEnter={(e) => { if (disabled) return; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'; e.currentTarget.style.borderColor = 'var(--glass-border-focus)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; e.currentTarget.style.borderColor = 'var(--glass-border)'; }}
    >
      {loading ? <Spinner /> : icon}
      <span>{label}</span>
    </button>
  );
}

function PrimaryButton({
  type = 'button', loading, disabled, onClick, children,
}: {
  type?: 'button' | 'submit';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const enabled = !disabled && !loading;
  return (
    <motion.button
      type={type} onClick={onClick} disabled={!enabled}
      whileHover={enabled ? { y: -1 } : undefined}
      whileTap={enabled ? { y: 0, scale: 0.98 } : undefined}
      transition={{ duration: 0.12, ease: EASE_OUT_EXPO }}
      style={{
        background: '#ffffff', color: 'rgba(20, 20, 20, 0.88)', border: 'none', borderRadius: 10,
        fontSize: 13.5, fontFamily: 'inherit', fontWeight: 500, padding: '9px 14px',
        cursor: enabled ? 'pointer' : 'default', letterSpacing: '0.005em', opacity: enabled ? 1 : 0.4,
        boxShadow: enabled ? '0 2px 8px rgba(0, 0, 0, 0.20)' : 'none', marginTop: 4,
      }}
    >
      {loading ? 'Working...' : children}
    </motion.button>
  );
}

const subtleLinkStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 12,
  fontFamily: 'inherit', padding: '6px 4px', cursor: 'pointer', letterSpacing: '0.005em',
  alignSelf: 'center', marginTop: 2,
};

function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', color: 'var(--text-ghost)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
      <span style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.07)' }} />
      <span>or</span>
      <span style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.07)' }} />
    </div>
  );
}

function Spinner() {
  return (
    <span style={{ width: 14, height: 14, border: '2px solid rgba(255, 255, 255, 0.15)', borderTopColor: 'var(--text-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

function DiscordGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2" aria-hidden>
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z"/>
    </svg>
  );
}
