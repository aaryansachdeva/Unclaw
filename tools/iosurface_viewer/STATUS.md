# Direct IOSurface path — status 2026-08-11

**It works.** Grace renders in the Unclaw app from Unreal's IOSurface with no
encode, no transport and no decode. See `working-screenshot.png`.

## Running it

```
UNCLAW_UE_LAUNCHD=1   ./run_soul.sh          # Unreal as a launchd job
UNCLAW_DIRECT_SURFACE=1 npm run dev          # app hosts the layer
```

Order matters: start soul first. The app spawns the character once its stream
connects, and Unreal boots blank by design, so an app started against an older
Unreal shows the empty set (backdrop and watermark, no character) until it is
restarted. The app re-attaches to a restarted publisher on its own, but the
character spawn is a separate, WebRTC-side concern.

Both flags default to OFF. Without them the app is exactly what it was.

## Measured

Same Electron build both sides, so the Electron row is the honest comparison.

| | before (WebRTC) | after (direct) |
|---|---|---|
| **Electron RAM** | 1695 MB | **734 MB** |
| Electron CPU | 25.7% | 32.6% |
| Unreal | 1889 MB / 71% | 1192 MB / 90% |
| GPU | 75% util, 9716 MB | 80% util, 7221 MB |

Electron drops **961 MB, 57%**: the H.264 decoder, the WebRTC jitter buffer and
their frame queues are simply gone. Electron CPU rises ~7 points for the Metal
blit, which is the honest cost of doing the composite ourselves.

Unreal's numbers are NOT comparable: the working build is Development, the
baseline was Shipping. Treat them as noise until the Shipping variant works.

## What is not done

**Shipping builds do not publish.** The carve claims the Mach service (the
launchd endpoint goes `active = 1`) but the viewer connection never
establishes, with or without `app-sandbox`, and with the
`temporary-exception.mach-register` entitlement present. Shipping strips
`UE_LOG`, so there is nothing to read; the next step is a Development build
with the Shipping *packaging* so the log survives, or a temporary
`UE_LOG(LogTemp, Display)` which Shipping keeps.

Until then `UE_APP_DEFAULT` points at the Development build `2026.0811.04`.
Last known-good Shipping build for ordinary use is `2026.0811.02`.

## The five bugs that cost the most, so they are not re-derived

1. **Only a launchd-launched process can own a Mach service.** Registering the
   name via a LaunchAgent is not enough; the job's `Program` must be the
   process itself. This is why Unreal's launch had to move.
2. **`bootout` returns before the job is gone.** A bootstrap in that window
   fails with `Input/output error` or leaves exit 78. Intermittent, so it looks
   like flakiness rather than a race.
3. **launchd cannot adopt a log file soul already holds open.** The spawn fails
   with a bare `EX_CONFIG` and writes nothing anywhere, which reads exactly like
   a corrupt binary. launchd runs now use `game.launchd.log`.
4. **Unreal's backbuffer has alpha 0.** The WebRTC path discards alpha at H.264
   so nothing ever wrote it; Core Animation honours it and composites a good
   frame as fully transparent. The layer is marked opaque.
5. **`CALayer.contents = IOSurface` does not draw here.** Widely described as
   working. With a correctly sized, visible, opaque layer and a surface full of
   verified live pixels, nothing was ever drawn. `CAMetalLayer` plus an explicit
   blit works, and is still zero-copy: the surface is wrapped as a Metal texture
   and never read back.

`LimitLoadToSessionType: Aqua` also stops the job starting, despite looking
like the correct key for a GUI app.
