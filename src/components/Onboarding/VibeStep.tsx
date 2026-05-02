// Step 2 — four sliders only. The "she might say" preview was dropped
// per product direction; the sliders speak for themselves with the
// active bracket word that updates as you drag.

import { Slider } from './Slider';
import { StepHeader } from './StepHeader';
import { vibeWord } from '../../services/profile';

export interface VibeValues {
  formality: number;
  humor: number;
  directness: number;
  verbosity: number;
}

interface Props {
  values: VibeValues;
  onChange: (next: VibeValues) => void;
}

export function VibeStep({ values, onChange }: Props) {
  const set = <K extends keyof VibeValues>(key: K, v: number) =>
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
  );
}
