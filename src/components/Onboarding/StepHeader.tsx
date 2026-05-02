// Shared step heading — quiet, sized in the same family as SheetPanel
// titles (16/600). The wizard is the focal point so we stretch to 19px,
// but the voice stays consistent with the rest of the chrome.

interface Props {
  title: string;
  subtitle?: string;
}

export function StepHeader({ title, subtitle }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h2
        style={{
          fontSize: 19,
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
          margin: 0,
          lineHeight: 1.2,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            margin: 0,
            letterSpacing: '0.005em',
            lineHeight: 1.45,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
