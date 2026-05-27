# UnClaw

Electron desktop AI companion app. Streams a 3D Unreal Engine character via Pixel Streaming in an always-on-top sidebar window.

## Tech Stack
- Electron + electron-vite
- React 19 + TypeScript
- Framer Motion (animations)
- Tailwind CSS 4
- @epicgames-ps/lib-pixelstreamingfrontend-ue5.6
- Plus Jakarta Sans (Google Fonts)

## Design Context

> **Source of truth: `PRODUCT.md` (strategy + principles) + `DESIGN.md` (tokens + components).** Both live at the project root and are managed via `/impeccable`. The summary below is the version to skim before any UI change.

### Brand Personality
**Sleek, intimate, alive.** A presence, not a tool. Premium and warm despite the dark palette. 3-word personality: **warm · present · refined**.

### Aesthetic Direction
- **Reference**: Apple Vision Pro materials, macOS Sequoia translucent controls, Apple TV+ overlay player chrome.
- **Theme**: Dark-only. The pixel stream provides ambient color (dark navy + character); chrome stays a desaturated **frosted slate** that coexists with the stream rather than competing.
- **Materials**: `rgba(40, 48, 65, x)` family glass — never inky black, never light-on-dark white-alpha. Strong blur (`32–40 px`) with `saturate(1.6–1.7)` so the surface reads translucent, not tinted.
- **Accent**: warm red `#c44444`. Used sparingly — only at moments of attention (focus rings, transcribing-bars wave, error chips).
- **Motion**: Framer Motion spring + `ease-out-expo`. Organic (breathing, morphing), never mechanical (snapping, blinking).

### Design Principles
1. **Stream is the star.** Chrome lives in the margins; the character holds the center.
2. **Frosted slate, never inky black.** Surfaces pick up the stream's navy ambient.
3. **Two intensities, one material.** Primary controls (AgentSwitcher, InputBar) are always present at low intensity; ambient widgets (Reminders, Stocks, News, Weather) sleep at zero intensity and wake on hover. Same material, different opacity stops.
4. **Whisper, don't shout.** Small text, subtle borders, restraint over volume.
5. **Breathe, don't blink.** Spring + ease-out-expo, nothing snaps.
6. **The accent is precious.** If everything is warm-red, nothing is.
7. **Text-shadow over backdrop where possible.** When a label floats on the stream without chrome (hover-only pills at rest), use `0 1px 2px rgba(0,0,0,0.55)` text-shadow + matching `drop-shadow` filter on icons.

### Material Tiers
| Layer | Surface | At rest |
|---|---|---|
| Primary chrome (AgentSwitcher, InputBar) | `--glass-bg` | Always visible |
| Ambient widgets (Reminders / Stocks / News / Weather pills) | `transparent` (text-shadow only) → `--glass-bg-hover` on hover | Invisible |
| Expanded widget panels | `--glass-bg-panel` + `--glass-blur` | Only while open |

### Avoid
- ChatGPT / Discord chatbot UI (white bubbles, message lists, sterile chrome).
- Gamer/RGB/neon aesthetic.
- Corporate dashboard patterns (cards, charts, sidebar nav).
- Skeuomorphic / heavy chrome.
- **Inky black panels** that compete with the stream as a competing dark mass.
- **Light-on-dark glass** with white-alpha — disappears against bright skin tones.
