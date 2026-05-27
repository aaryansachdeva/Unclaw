---
name: UnClaw
description: A 3D MetaHuman companion living in a frosted anteroom that floats beside your screen.
colors:
  stream-void: "#050506"
  surface-sunken: "#0f0f12"
  surface-elevated: "#1a1a1f"
  frosted-slate-base: "rgba(40, 48, 65, 0.32)"
  frosted-slate-hover: "rgba(40, 48, 65, 0.48)"
  frosted-slate-panel: "rgba(40, 48, 65, 0.52)"
  glass-border: "rgba(255, 255, 255, 0.12)"
  glass-border-focus: "rgba(255, 255, 255, 0.20)"
  border-dim: "rgba(255, 255, 255, 0.04)"
  border-subtle: "rgba(255, 255, 255, 0.08)"
  border-focus-accent: "rgba(196, 68, 68, 0.22)"
  bone-white: "#fafafa"
  warm-ash: "#d4cec7"
  faded-linen: "#a39c95"
  ember-red: "#c44444"
  ember-red-dim: "rgba(196, 68, 68, 0.08)"
  ember-red-glow: "rgba(196, 68, 68, 0.14)"
  ember-red-strong: "rgba(196, 68, 68, 0.32)"
  sage-pulse: "#8cbf8a"
  soft-cinder: "#c87a7a"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  body-emphasis:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.04em"
  micro:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "10.5px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.01em"
  caps:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  pill-sm: "11px"
  lg: "14px"
  xl: "16px"
  xxl: "18px"
  pill-lg: "24px"
spacing:
  hairline: "4px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  base: "12px"
  ml: "14px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  xxxl: "32px"
components:
  input-bar:
    backgroundColor: "{colors.frosted-slate-base}"
    textColor: "{colors.bone-white}"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.pill-lg}"
    padding: "10px 14px"
  input-bar-focus:
    backgroundColor: "{colors.frosted-slate-hover}"
  agent-switcher:
    backgroundColor: "{colors.frosted-slate-base}"
    textColor: "{colors.bone-white}"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  widget-pill-rest:
    backgroundColor: "transparent"
    textColor: "{colors.bone-white}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
  widget-pill-hover:
    backgroundColor: "{colors.frosted-slate-hover}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
  widget-panel:
    backgroundColor: "{colors.frosted-slate-panel}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.xl}"
    padding: "14px 16px"
  titlebar-button:
    backgroundColor: "{colors.frosted-slate-base}"
    textColor: "{colors.warm-ash}"
    rounded: "{rounded.sm}"
    padding: "0"
    size: "26px"
  voice-button-rest:
    backgroundColor: "#ffffff"
    textColor: "#141414"
    rounded: "50%"
    size: "36px"
  voice-button-active:
    backgroundColor: "{colors.ember-red-strong}"
    textColor: "{colors.bone-white}"
    rounded: "50%"
    size: "36px"
  settings-shell:
    backgroundColor: "{colors.frosted-slate-panel}"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.xxl}"
    padding: "0"
  settings-rail-item-rest:
    backgroundColor: "transparent"
    textColor: "{colors.warm-ash}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "9px 12px 9px 14px"
  settings-rail-item-active:
    backgroundColor: "{colors.ember-red-dim}"
    textColor: "{colors.bone-white}"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.md}"
    padding: "9px 12px 9px 14px"
  settings-row:
    backgroundColor: "rgba(255, 255, 255, 0.025)"
    textColor: "{colors.bone-white}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  field-input:
    backgroundColor: "rgba(255, 255, 255, 0.04)"
    textColor: "{colors.bone-white}"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  field-input-focus:
    backgroundColor: "rgba(255, 255, 255, 0.06)"
  button-primary:
    backgroundColor: "{colors.ember-red}"
    textColor: "{colors.bone-white}"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.sm}"
    padding: "8px 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.bone-white}"
    typography: "{typography.body-emphasis}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  toggle-off:
    backgroundColor: "rgba(255, 255, 255, 0.10)"
    rounded: "12px"
    width: "40px"
    height: "24px"
  toggle-on:
    backgroundColor: "{colors.ember-red}"
    rounded: "12px"
    width: "40px"
    height: "24px"
  status-chip-saved:
    backgroundColor: "rgba(140, 191, 138, 0.10)"
    textColor: "{colors.sage-pulse}"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  status-chip-error:
    backgroundColor: "rgba(196, 68, 68, 0.12)"
    textColor: "#f1b5b5"
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

# Design System: UnClaw

## 1. Overview

**Creative North Star: "The Frosted Anteroom"**

UnClaw is a 3D MetaHuman that lives in a small refined room that floats beside your screen. Everything in the visual system is furniture for that room. The pixel-streamed character holds the center; the chrome around it is frosted glass that picks up the navy ambient of the stream and reads as translucent material, not as a dark slab.

The aesthetic is built from one material (frosted slate) at three opacities (always-on chrome, hover reveal, opened panel), one warm-red accent reserved for moments of attention, and one warm sans (Plus Jakarta Sans) that carries every label, button, body line, and status chip. The system is intentionally dark-only. The character's lighting is calibrated for a dark UI; a light mode would break the visual coherence the product depends on. The system explicitly rejects ChatGPT-style chat bubbles, gaming overlays, corporate dashboards, skeuomorphic chrome, and the inky-black "video player overlay" surfaces that would compete with the stream as a competing dark mass.

What makes the system distinctive is the *two-intensity glass strategy*: primary controls (input bar, agent switcher, titlebar) sit at low intensity full-time so the user always knows where they are. Ambient widgets (Reminders, Stocks, News, Weather) sleep at zero intensity and wake on hover, using text-shadow on bare labels before a glass surface ever appears. The character keeps the eye; the chrome only steps forward when the user reaches for it.

**Key Characteristics:**
- Frosted slate, never inky black: surfaces use the `rgba(40, 48, 65, x)` family so they pick up the stream's navy ambient.
- Two intensities, one material: always-on primary chrome + hover-reveal ambient widgets share the same glass language at different opacity stops.
- The accent is precious: warm red `#c44444` appears only at focus states, transcribing-bars, error chips, and primary save actions.
- Whisper, don't shout: body sits at 13px, labels at 11px, borders at 1px or less, with sparse accent use.
- Breathe, don't blink: motion is spring + ease-out-expo, never snap.

## 2. Colors: The Frosted Slate Palette

A desaturated, warm-tinted palette built around one luminous material (frosted slate over a near-black void), warmed by neutrals that lean into the character's skin tones, and punctuated by a single warm-red accent.

### Primary

- **Ember Red** (`#c44444`): The only saturated color in the system. Used on focus rings (1.5px outline with 2px offset), the transcribing-bars wave inside the voice button, the active save button, the animated rail indicator on the active settings category, and error chips. Three tinted derivatives (ember-red-dim 8%, ember-red-glow 14%, ember-red-strong 32%) handle accent-tinted backgrounds without ever introducing a second hue.

### Secondary

- **Sage Pulse** (`#8cbf8a`): Status-only. The "saved" check chip, "speaking" indicator, "up day" on Stocks. Never decorative. Kept distinct from Ember Red so warmth (action) and live status read as separate signals.

### Tertiary

- **Soft Cinder** (`#c87a7a`): Error-only, separate from the Ember Red accent so an actual failure can shout louder than a focus state. Used in the danger toast border and any "we just lost connection" copy.

### Neutral

- **Stream Void** (`#050506`): The void behind everything, including the pixel-streamed `<video>`. Visible only at the four corners while the stream loads.
- **Surface Sunken** (`#0f0f12`): Used sparingly for the inner shadow of the settings rail (slightly darker than the panel so the rail reads as a tonal step down).
- **Surface Elevated** (`#1a1a1f`): For non-glass overlays that need a flat dark surface (rare).
- **Frosted Slate Base** (`rgba(40, 48, 65, 0.32)`): Always-on primary chrome. The Input Bar and Agent Switcher live here permanently.
- **Frosted Slate Hover** (`rgba(40, 48, 65, 0.48)`): The reveal step. Widget pills wake to this on hover. Field inputs sit here at focus.
- **Frosted Slate Panel** (`rgba(40, 48, 65, 0.52)`): Expanded widget panels and the Settings shell. Slightly heavier than hover so the panel reads as a continuation, not a step into a "modal".
- **Bone White** (`#fafafa`): Primary copy on any chrome surface.
- **Warm Ash** (`#d4cec7`): Secondary copy, subtitles, field labels. Warm grey, not cool grey.
- **Faded Linen** (`#a39c95`): The faintest readable tier. Placeholder text, decorative separators, the caps-label at the top of the settings rail. Cleared WCAG AA on dark glass after a deliberate bump from `#6e6862`.

### Named Rules

**The One Voice Rule.** Ember Red is the only saturated color. If a screen has a second hue, one of them is wrong. Sage Pulse and Soft Cinder are status semantics, not palette extensions.

**The Frosted Slate Rule.** Surfaces use `rgba(40, 48, 65, x)` and the `blur(36px) saturate(1.7)` filter, never plain dark backgrounds. The saturation boost is load-bearing: without it, the glass reads as tinted plastic instead of translucent material. If you remove the blur or saturation, the surface stops being part of this system.

**The Two-Intensities Rule.** Primary chrome is always visible at frosted-slate-base. Ambient widgets are transparent at rest with text-shadow on their bare labels, waking to frosted-slate-hover only on hover or active. Same material, different opacity stops. A widget that's always visible at full intensity is miscategorized.

## 3. Typography

**Family:** Plus Jakarta Sans (with `system-ui, -apple-system, sans-serif` fallback). One family carries every level.

**Character:** Plus Jakarta Sans is warm, rounded, and characterful without being decorative. The slight humanist tone keeps small labels readable on glass while the heavier weights stay clean at display sizes. The system is mono-family by intent: a serif or display pairing would create a typographic hierarchy that competes with the visual hierarchy already established by the chrome tiers.

### Hierarchy

- **Display** (700, 34px, line-height 1.05, letter-spacing -0.03em): The Greeting at the top-left of the workspace, the temperature on the Weather widget. Drop-shadowed when it sits over the stream without chrome.
- **Headline** (600, 26px, line-height 1.15, letter-spacing -0.02em): Reserved for moments of identity (SoulBootScreen / SetupWizard monument zone). Not used in steady-state UI.
- **Title** (600, 18px, line-height 1.25, letter-spacing -0.015em): The Settings pane header, the SheetPanel title, the persona switcher label.
- **Body** (400, 13px, line-height 1.45, letter-spacing -0.005em): The default. Settings-row labels, widget panel content, conversational copy in the chat pane. Body line length is naturally capped by the 420px window width; never exceeds 65ch in practice.
- **Body Emphasis** (500, 13.5px, line-height 1.4): The slightly louder body weight for interactive controls (button labels, dropdown selections, agent name). Adds presence without jumping to bold.
- **Label** (600, 11px, line-height 1.3, letter-spacing 0.04em): Section labels above grouped fields, "Provider" / "Model" inside settings rows. Always sentence case unless paired with caps.
- **Micro** (500, 10.5px, line-height 1.3, letter-spacing 0.01em): Status chips, inline hints, the "N models from provider" affordance. Never used for primary content.
- **Caps** (600, 10.5px, line-height 1.2, letter-spacing 0.16em, uppercase): The single decorative spot. Used once: the "SETTINGS" label at the top of the settings rail. Never on body, never on buttons.

### Named Rules

**The One Family Rule.** Plus Jakarta Sans only. No display pairing, no monospace for code-flavored copy. The exception is the "Version" line in the Settings About pane (SF Mono / Menlo for the version string itself) where the monospace IS the meaning.

**The Quiet Caps Rule.** Uppercase letter-spacing is `0.04em` for small labels, `0.16em` for the single decorative caps moment in the settings rail. Never `0.10em`. The wide-tracked corporate look is forbidden.

## 4. Elevation

UnClaw is flat-with-tonal-layering, not shadow-driven. Depth is conveyed by the three glass intensities (`--glass-bg`, `--glass-bg-hover`, `--glass-bg-panel`) plus a 1px inset highlight on opened panels that suggests light catching the top edge of the glass. The pixel stream itself supplies the dynamic depth; chrome stays restrained so the eye reads the character first.

Shadows appear only on **grounded chrome** (the settings shell, the widget panels when opened, the action bar that slides up over content). The shadow vocabulary is small and rarely deviated from.

### Shadow Vocabulary

- **Panel ground** (`box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 30px 70px -16px rgba(0,0,0,0.62), 0 14px 32px -10px rgba(0,0,0,0.45)`): The settings shell, widget panels, the lifted setup wizard card. Two-layer ambient (a longer soft shadow underneath, a tighter middle shadow for grip) plus a 1px inset highlight at the top edge.
- **Panel rest** (`box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 14px rgba(0,0,0,0.30)`): The smaller panel shadow used on hover-revealed widget pills (the WidgetRail's button-hovered state).
- **Save bar lift** (`backdrop-filter: blur(20px) saturate(1.5)` over a `linear-gradient(to top, rgba(20, 24, 32, 0.72), rgba(20, 24, 32, 0.30))`): The sticky save bar at the bottom of the Settings shell. The gradient provides the lift without a hard shadow line.
- **Primary button glow** (`box-shadow: 0 4px 14px -4px rgba(196, 68, 68, 0.55)`): The Save Changes button. The accent-tinted glow makes it the single warmest object on screen when changes are pending.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (opening a panel, raising the save bar, focusing a primary action). A flat chrome that opens into shadowed depth is the entire elevation language.

**The Inset Highlight Rule.** Every opened panel carries a 1px inset highlight at the top (`0 1px 0 rgba(255,255,255,0.06) inset`). This is what makes the glass read as a real piece of material catching ambient light rather than as a flat tinted slab. Skip the highlight and the panel falls dead.

## 5. Components

The component philosophy is **refined and restrained**: small text, subtle borders, sparse accent, generous internal breathing room. Every interactive component has visible default, hover, focus, and disabled states. The shape vocabulary is narrow: 6 to 8px radius for tight chrome (titlebar buttons, settings rows), 10 to 14px for groups (settings cards, dropdown menus), 16 to 18px for panels, and `pill` (24px or 50%) for the input bar and the circular voice button.

### Buttons

- **Shape:** 8px radius (`{rounded.sm}`) for standard buttons, full pill (50%) for the voice button.
- **Primary:** Ember Red background (`{colors.ember-red}`) with an accent-tinted glow `0 4px 14px -4px rgba(196, 68, 68, 0.55)`. Bone-white text at body-emphasis weight. Padding 8px 18px. The single warmest object on screen when present; never more than one Primary in view.
- **Ghost:** Transparent background with a 1px `{colors.glass-border}` border. Same padding and typography as Primary. Used as the Discard / Close partner for any Primary action.
- **Hover:** Background brightens by one opacity stop (transparent goes to `rgba(255,255,255,0.04)`, ember-red shifts toward the brighter end of its tint range). Border-color shifts to `{colors.glass-border-focus}`. Transition `0.16s var(--ease-out-quart)`.
- **Focus:** 1.5px Ember Red outline with 2px offset. Never a glow inside the button.

### Chips

- **Status chip** (Saved / Error / Verifying): Micro typography (10.5px, 500 weight), 6px x 10px padding, 8px radius. Background is a 10 to 12 percent tint of the meaning color (sage-pulse for saved, ember-red for error, transparent with a 1px border for "verifying" because in-flight state should not commit color). Always paired with a 12px Lucide icon on the left at 2px stroke width.

### Cards (Settings Group)

- **Corner Style:** 14px radius (`{rounded.lg}`).
- **Background:** `rgba(255, 255, 255, 0.025)` over the panel surface (a barely-there lift on top of frosted-slate-panel).
- **Shadow Strategy:** None at rest. See Elevation.
- **Border:** 1px `{colors.glass-border}`.
- **Internal Padding:** Rows divided by 1px `rgba(255, 255, 255, 0.05)` hairlines, each row at 12px x 16px.
- **Critical:** Nested cards are forbidden. A Settings Group never contains another card; rows inside are dividers, not containers.

### Inputs

- **Style:** `rgba(255, 255, 255, 0.04)` background, 1px `{colors.glass-border}` border, 8px radius, 8px x 10px padding.
- **Focus:** Border shifts to `{colors.glass-border-focus}`, background brightens to `rgba(255, 255, 255, 0.06)`. No glow, no shadow.
- **Disabled:** Opacity 0.4, cursor not-allowed.
- **Secret variant:** Letter-spacing `0.18em` to make the password dots evenly visible; a 13px Lucide eye/eye-off toggle on the right for reveal. When revealed, font swaps to SF Mono / Menlo so the key is properly readable.

### Dropdowns

- **Trigger:** Same shape as Input (8px radius, rgba background) with a custom chevron rendered as an inline SVG at right 10px center.
- **Menu:** Frosted-slate-panel with glass-blur, 12px radius, 6px padding, portal-rendered so it escapes parent overflow. Each row 8px x 10px padding, 8px radius on row hover.
- **Searchable variant:** A sticky search input at the top of the menu, auto-focused on open, filters by case-insensitive substring against label or id. The Settings model picker and the agentic backend picker both use this.

### Toggle (iOS-style switch)

- 40px x 24px track, 12px radius, 18px white thumb with `0 1px 3px rgba(0, 0, 0, 0.35)` shadow. Off-state track is `rgba(255, 255, 255, 0.10)`. On-state track is `{colors.ember-red}` with a `rgba(255, 200, 190, 0.35)` border tint. Thumb position springs (stiffness 520, damping 36). The accent track is one of the few places Ember Red sits at full intensity.

### Navigation

- **Settings Rail:** Vertical list of categories with a Lucide icon (15px, 1.8 stroke) and a body-weight label. Active row gets `{colors.ember-red-dim}` background, body-emphasis weight, accent-colored icon, and an animated 2px Ember Red bar on the left edge that slides between categories via Framer Motion's `layoutId` (spring 520 / 38).
- **Titlebar pin/min/close:** 26px pill icons on frosted-slate-base, faded-linen icon color, hover bumps to `rgba(255, 255, 255, 0.12)`. On macOS the OS traffic-light buttons sit in the top-left and our custom min/close are hidden.

### Signature: The Input Bar

- **Shape:** Full pill (24px radius), 36px tall content area, frosted-slate-base background that brightens to hover on focus.
- **Right cluster (left to right):** the `+` image-attach button, the chat-pane toggle (PanelRight icons), the cross-fading Voice button / Send button.
- **Voice button:** 36px white circle at rest with a dark wave glyph. Transitions to the transcribing wave (Ember Red bars) when voice mode is active. The single piece of chrome where saturated color is allowed at full intensity, because it IS the voice metaphor.
- **Send button:** Cross-fades over the Voice button when the input has content. White circular with an arrow glyph. Spring transition: scale 0.94 to 1, opacity 0 to 1, 0.18s ease-out-quart.

### Signature: The Settings Shell

- 780px x 560px frosted-slate-panel modal with two columns: a 208px left rail with categories and a content pane on the right. Hairline highlight at the top edge of the shell. The right pane has a sticky action bar at the bottom that slides in from below when changes are pending, never visible at rest. Future configuration surfaces mirror this layout (left rail of categories, right pane of rows, sticky save bar) rather than the scrolling-page pattern.

## 6. Do's and Don'ts

### Do:

- **Do** use `rgba(40, 48, 65, x)` for any glass surface. Never plain `rgba(0, 0, 0, x)` or `rgba(255, 255, 255, x)`.
- **Do** ship every glass surface with both `backdrop-filter: blur(36px) saturate(1.7)` and the WebKit prefix. The saturation boost is load-bearing.
- **Do** keep Ember Red on focus, primary actions, and error chips only. If a screen has more than one Ember Red moment, one of them is wrong.
- **Do** add the 1px inset highlight (`0 1px 0 rgba(255,255,255,0.06) inset`) on every opened panel. It's what makes the glass read as a real piece of material.
- **Do** use the animated `layoutId` accent indicator pattern for any future left-rail navigation. Springs with stiffness 520, damping 36 or 38.
- **Do** put the action bar at the bottom of any modal that has unsaved changes. Slide it in from below only while dirty.
- **Do** preview WCAG AA contrast for any secondary or ghost copy before shipping. Bone-white passes everywhere; warm-ash passes on glass-bg-panel; faded-linen passes only as decorative microcopy.

### Don't:

- **Don't** use ChatGPT or Discord chatbot UI patterns (white bubbles, message lists, sterile chrome).
- **Don't** use gamer or RGB aesthetics (neon, aggressive angles, gaming-overlay vibes).
- **Don't** use corporate dashboard patterns (sidebar nav, identical card grids, enterprise SaaS).
- **Don't** use skeuomorphic or heavy chrome (decorative drop shadows, fake textures, thick borders).
- **Don't** ship inky-black "video player overlay" surfaces that compete with the stream as a competing dark mass. If the surface reads as a dark slab, it is wrong.
- **Don't** use light-on-dark glass tinted with white-alpha. White-alpha disappears against the character's skin tones in the stream.
- **Don't** nest cards. A Settings Group never contains another card.
- **Don't** wrap everything in a container. Most things do not need one.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent. The animated `layoutId` bar in the Settings rail is the one place a colored vertical bar is allowed, and it sits outside the rail item, not as a border on it.
- **Don't** use gradient text (`background-clip: text`). Emphasis comes from weight, not gradient.
- **Don't** reach for glassmorphism on non-chrome surfaces. The frosted-slate material is reserved for chrome. Body content, status chips, and field inputs use solid alpha tints.
- **Don't** use em dashes in product copy, status messages, or error chips. Commas, colons, periods, parentheses. Hyphens for compound modifiers only.
- **Don't** introduce a second font family. Plus Jakarta Sans only, with a monospace exception for the Version string in the Settings About pane.
- **Don't** use 0.10em or wider letter-spacing on uppercase text. The wide-tracked corporate look is forbidden.
- **Don't** ship a light mode. The character's lighting is calibrated for a dark UI.
