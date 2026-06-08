// Step 2 — agent-name input + four vibe sliders. Naming the assistant
// belongs here (not on Identity) because it's a personality choice,
// not an identity fact about the user, same conceptual category as
// "how formal", "how playful", etc. Uses the shared onboarding kit so the
// header / labels / field surface match every other step.

import { Slider } from './Slider';
import { StepHeader } from './StepHeader';
import { FIELD_BASE, applyFocus, applyBlur, FieldLabel, STEP_COL_WIDTH } from './onboardingKit';
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

export function VibeStep({ values, onChange }: Props) {
  const set = <K extends keyof VibeValues>(key: K, v: VibeValues[K]) =>
    onChange({ ...values, [key]: v });

  return (
    <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
      <div style={{ width: STEP_COL_WIDTH, flexShrink: 0, paddingTop: 2 }}>
        <StepHeader
          title="Set the vibe."
          subtitle="How Grace talks to you. Change it anytime."
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <FieldLabel text="Name your assistant">
          <input
            type="text"
            value={values.agent_name}
            onChange={(e) => set('agent_name', e.target.value)}
            placeholder="Grace"
            style={FIELD_BASE}
            onFocus={(e) => applyFocus(e.target)}
            onBlur={(e) => applyBlur(e.target)}
          />
        </FieldLabel>

        {/* Hairline groups the name from the personality sliders. */}
        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0 0' }} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            rowGap: 16,
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
