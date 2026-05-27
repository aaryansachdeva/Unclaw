# Product

## Register

product

## Users

Desktop users running an Unreal Engine pixel-streamed 3D AI character as a personal companion. They interact via text and voice through a 420x760 always-on-top Electron window that floats on the side of the display. The character responds with speech, lip-synced animation, mood-driven facial expressions, and short montages (kiss, dance, hello). Range goes from tech-savvy early adopters down to casual users who want an AI presence on screen.

The pixel stream is the experience. The character lives over a dark navy background; the chrome lives in the margins.

## Product Purpose

UnClaw is a presence, not a tool. It runs a 3D MetaHuman on the side of the display, listens, replies, expresses, and stays alive between conversations. Success is the user opening their laptop and wanting to say hi back, the same way they would to a person.

Functionally the product is a multi-provider BYOK shell. The user brings their own LLM key (OpenAI, Anthropic, Gemini, Groq, DeepSeek, OpenRouter, xAI, or local Ollama), TTS key (ElevenLabs, Kokoro, or Qwen3-TTS), and optional agentic escalation key. The soul backend orchestrates chat, voice, lipsync, agentic tool use, and the streamed face. The Electron renderer wraps it all in a single floating window.

## Brand Personality

Sleek, intimate, alive. The interface should feel like a portal to another being. Warm despite the dark palette, restrained despite the depth of features behind it. Think a luxury device that wakes up to greet you, with a personality you'd actually miss if it were gone.

Three-word personality: warm, present, refined.

Reference points: Apple Vision Pro materials, the macOS Sequoia translucent control language, Apple TV+ overlay player chrome. Frosted slate panels floating over moving image content.

## Anti-references

- ChatGPT or Discord chatbot UI (white bubbles, message lists, sterile chrome).
- Gamer or RGB aesthetics (neon, aggressive angles, gaming-overlay vibes).
- Corporate dashboard patterns (sidebar nav, identical card grids, enterprise SaaS).
- Skeuomorphic or heavy chrome (drop-shadows-as-decoration, fake textures, thick borders).
- Inky-black "video player overlay" surfaces that compete with the stream as a competing dark mass.
- Light-on-dark glass tinted with white-alpha (disappears against bright skin tones).

## Design Principles

1. **Stream is the star.** Chrome lives in the margins; the character holds the center. If a UI element ever obscures the character's face, redesign it.

2. **Frosted slate, never inky black.** Surfaces pick up the stream's navy ambient and read as translucent material, not a flat dark slab.

3. **Two intensities, one material.** Primary controls (input bar, agent switcher, titlebar) are always present at low intensity; ambient widgets sleep at zero intensity and wake on hover. Same glass language, different opacity stops.

4. **Whisper, don't shout.** Small text, subtle borders, sparse accent use. Confidence comes from restraint, not size.

5. **Breathe, don't blink.** Animations use spring + ease-out-expo. Nothing snaps.

6. **The accent is precious.** Warm red (#c44444) appears only at moments of attention: focus states, the transcribing-bars wave, error chips, primary save actions. If everything is accent, nothing is.

7. **BYOK with live capability discovery.** Users bring their own keys for chat, voice, and agentic. The app validates each key against the provider's own /v1/models endpoint and populates dropdowns from that live response, filtered to chat-capable model ids. No baked model catalogs that drift stale, no model picker that lets the user choose something their key can't reach.

8. **Settings live in a two-pane shell.** Configuration surfaces use a left rail for categories with an animated accent indicator on the active row, a right pane for the selected category's rows, and a sticky save bar that slides in from the bottom only while changes are pending. Future configuration surfaces mirror this layout, not the scrolling-blog pattern.

## Copy & Voice

- Every word earns its place. No restated headings, no intros that repeat the title.
- No em dashes. Use commas, colons, semicolons, periods, or parentheses. Hyphens are for compound modifiers only.
- Tone is warm and direct. Status messages read like a confident person speaking, not a system log ("Verifying key", not "Validating credentials").
- Errors propose a next move when one exists. "Couldn't reach OpenAI, check the key" beats "401 Unauthorized".
- Plus Jakarta Sans throughout, never a fallback or system stack for body copy.

## Accessibility & Inclusion

- A reduced-motion media query in `styles.css` cuts every animation to 10ms, required for vestibular sensitivity.
- Color contrast clears WCAG AA on `--glass-bg-panel` for `--text-primary` and `--text-secondary` at body sizes. `--text-ghost` is decorative-only and never used for content.
- Voice mode is keyboard-accessible. The mic button is focusable and ARIA-labelled.
- Hold-Space push-to-talk is gated on no-input-focus so typing a space in chat never triggers the mic.
- Widget pills carry `aria-expanded` and dynamic `aria-label` for screen readers.
- Dark-only by intent. The character's lighting is calibrated for a dark UI; a light mode would break the visual coherence the product depends on.
