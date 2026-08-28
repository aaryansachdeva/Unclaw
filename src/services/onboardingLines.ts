// What she says during onboarding, and how it varies.
//
// Every beat has several phrasings and one is picked at random, never the
// same one twice in a row. Onboarding is the first minute anyone spends
// with her, and a fixed script is the fastest way to feel like software:
// two people setting up on the same day should not hear identical audio.
//
// All of it is synthesized live through the local Pocket engine, which is
// what makes this possible at all: no key, no network, ~10ms to first
// audio, so a line can be composed from the user's name, the name they
// just gave HER, and the actual time of day. The welcome line in
// particular is deliberately un-pre-generatable, it greets the real
// weekday and part of day, so the first thing she says could not have
// come from a shipped audio file.

export type OnboardingBeat =
  | 'welcome'
  | 'nice-to-meet-you'
  | 'name-liked'
  | 'keys-wrong'
  | 'excited-to-start';

export interface LineContext {
  /** What the user calls themselves. Absent on the welcome beat. */
  userName?: string;
  /** What the user just named HER. Absent until the vibe step. */
  agentName?: string;
}

/** Local weekday + part of day, read at call time. */
function whenItIs(): { day: string; part: string } {
  const now = new Date();
  const h = now.getHours();
  let day: string;
  try {
    day = now.toLocaleDateString(undefined, { weekday: 'long' });
  } catch {
    day = 'day';
  }
  const part = h < 5 ? 'night'
    : h < 12 ? 'morning'
    : h < 17 ? 'afternoon'
    : h < 22 ? 'evening'
    : 'night';
  return { day, part };
}

function variants(beat: OnboardingBeat, ctx: LineContext): string[] {
  const { day, part } = whenItIs();
  const you = ctx.userName?.trim();
  const me = ctx.agentName?.trim();

  switch (beat) {
    case 'welcome':
      // Time-aware on purpose: this is the line that proves she is being
      // generated right now rather than played back.
      return [
        `Oh, hello. I hope your ${day} ${part} is going well. Welcome to Unclaw, I'm Grace.`,
        `Hey there. Happy ${day}. I'm Grace, and this is Unclaw. Let's get you set up.`,
        `Hi! Good ${part}. Welcome to Unclaw, I'm Grace.`,
        `There you are. I hope you're having a good ${day}. I'm Grace, welcome to Unclaw.`,
      ];

    case 'nice-to-meet-you':
      return you ? [
        `Nice to meet you, ${you}.`,
        `${you}. That's a good name. Nice to meet you.`,
        `Lovely to meet you, ${you}.`,
        `Hi ${you}. It's really nice to meet you.`,
      ] : [
        'Nice to meet you.',
        'Lovely to meet you.',
        "It's really nice to meet you.",
      ];

    case 'name-liked':
      // Only fires when the user actually renamed her, so `me` is set.
      return [
        `${me}? Oh, I like that. That's me now. And if you ever want to change anything about me, it's all in the agents section.`,
        `${me}. Yeah, that suits me. Anything about me can be adjusted later in agents, whenever you like.`,
        `You're calling me ${me}? That's lovely. You can tweak me, or any of your agents, from the agents section later.`,
        `${me} it is. Thank you. If you ever want to change how I look or sound, the agents section has all of it.`,
      ];

    case 'keys-wrong':
      return [
        "Hmm, those keys don't look right. Let's take another look.",
        "That didn't go through. Want to check the keys again?",
        "Something's off with those keys. Have another look?",
      ];

    case 'excited-to-start':
      return you ? [
        `We're all set, ${you}. I can't wait to get started.`,
        `That's everything, ${you}. I'm really looking forward to this.`,
        `All done, ${you}. Let's begin.`,
        `Perfect, ${you}. I'm so glad you're here.`,
      ] : [
        "We're all set. I can't wait to get started.",
        "That's everything. I'm really looking forward to this.",
        "All done. Let's begin.",
      ];
  }
}

/** Last index used per beat, so a repeat within a session never picks the
 *  same phrasing twice running (the thing that would give the variation
 *  away). Module scope: onboarding is a single flow per launch. */
const lastPick: Partial<Record<OnboardingBeat, number>> = {};

export function lineFor(beat: OnboardingBeat, ctx: LineContext = {}): string {
  const options = variants(beat, ctx);
  if (options.length === 1) return options[0];
  let i = Math.floor(Math.random() * options.length);
  if (i === lastPick[beat]) i = (i + 1) % options.length;
  lastPick[beat] = i;
  return options[i];
}
