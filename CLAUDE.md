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

### Brand Personality
**Sleek, intimate, alive.** A living companion, not a tool. Premium, breathing, warm despite the dark palette.

### Aesthetic Direction
- **Reference**: Apple Vision Pro — glass panels floating in space, spatial computing, refined translucency
- **Theme**: Dark-only. Void-black (#050506) with teal accent (#2dd4bf). Warm off-white text (#f0ede8).
- **Materials**: Frosted glass (backdrop-blur with white-alpha), soft borders, no heavy shadows
- **Motion**: Subtle, purposeful spring-based transitions. Nothing flashy.

### Design Principles
1. **The stream is the star** — Minimize chrome. The 3D character dominates.
2. **Glass, not walls** — Translucent surfaces that float, not opaque panels that block.
3. **Breathe, don't blink** — Organic animations (breathing pulses, smooth springs), not mechanical.
4. **Whisper, don't shout** — Small text, subtle borders, sparse accents. Confidence from restraint.
5. **One material** — Same frosted glass everywhere: `rgba(255,255,255,0.06)` bg, `blur(40px) saturate(1.6)`, `1px solid rgba(255,255,255,0.09)`.

### Avoid
- ChatGPT / generic chatbot UI
- Gamer/RGB/neon aesthetic
- Corporate dashboard patterns
- Skeuomorphic / heavy chrome

Full design tokens in `.impeccable.md`.
