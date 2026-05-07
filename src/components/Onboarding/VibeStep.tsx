// Step 2 — agent-name input + four vibe sliders. Naming the assistant
// belongs here (not on Identity) because it's a personality choice,
// not an identity fact about the user — same conceptual category as
// "how formal", "how playful", etc.

import { Slider } from './Slider';
import { StepHeader } from './StepHeader';
import { vibeWord } from '../../services/userSettings';

export interface VibeValues {
  formality: number;
  humor: number;
  directness: number;
  verbosity: number;
  /** Custom name for the primary assistant. Empty = default persona
   *  name (Grace) flows through unchanged. */
  agent_name: string;
}

interface Props {
  values: VibeValues;
  onChange: (next: VibeValues) => void;
}

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

export function VibeStep({ values, onChange }: Props) {
  const set = <K extends keyof VibeValues>(key: K, v: VibeValues[K]) =>
    onChange({ ...values, [key]: v });

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
      <div style={{ width: 180, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title="Set the vibe."
          subtitle="You can change this anytime."
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Agent name — full-width row at the top of the step.
            Optional; placeholder shows the default. */}
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-secondary)',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Name your primary assistant
          </span>
          <input
            type="text"
            value={values.agent_name}
            onChange={(e) => set('agent_name', e.target.value)}
            placeholder="Grace"
            style={FIELD_BASE}
            onFocus={(e) => applyFocus(e.target)}
            onBlur={(e) => applyBlur(e.target)}
          />
        </label>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            rowGap: 14,
            columnGap: 28,
          }}
        >
          <Slider
            value={values.formality}
            onChange={(v) => set('formality', v)}
            leftLabel="Casual"
            rightLabel="Formal"
            caption="Formality"
            word={vibeWord('formality', values.formality)}
          />
          <Slider
            value={values.humor}
            onChange={(v) => set('humor', v)}
            leftLabel="Dry"
            rightLabel="Playful"
            caption="Humor"
            word={vibeWord('humor', values.humor)}
          />
          <Slider
            value={values.directness}
            onChange={(v) => set('directness', v)}
            leftLabel="Gentle"
            rightLabel="Blunt"
            caption="Directness"
            word={vibeWord('directness', values.directness)}
          />
          <Slider
            value={values.verbosity}
            onChange={(v) => set('verbosity', v)}
            leftLabel="Brief"
            rightLabel="Thorough"
            caption="Verbosity"
            word={vibeWord('verbosity', values.verbosity)}
          />
        </div>
      </div>
    </div>
  );
}
