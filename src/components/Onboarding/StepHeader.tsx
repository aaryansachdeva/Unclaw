// Shared step heading. The wizard is the focal point of the app, so the
// title carries real weight here (bolder + larger than steady-state chrome)
// while the voice stays on brand. A single ember accent tick sits above the
// title as the step's one precious accent moment, the only saturated mark on
// the screen until a field is focused or an option selected.

interface Props {
  title: string;
  subtitle?: string;
  /** Band mode: the header runs across the top of a step instead of
   *  down a side column, so the subtitle may breathe to a full line. */
  wide?: boolean;
}

export function StepHeader({ title, subtitle, wide }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span
        aria-hidden
        style={{
          width: 26,
          height: 3,
          borderRadius: 2,
          background: 'var(--accent, #c44444)',
          boxShadow: '0 0 12px -1px rgba(196, 68, 68, 0.55)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.022em',
            margin: 0,
            lineHeight: 1.12,
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text-secondary)',
              margin: 0,
              letterSpacing: '-0.003em',
              lineHeight: 1.5,
              maxWidth: wide ? 560 : 240,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
