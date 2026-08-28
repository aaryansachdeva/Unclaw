# Direct IOSurface path (Mac) — no encode, no decode

Unreal and the app run on the same Mac, so compressing a frame to H.264, pushing
it through loopback WebRTC and decoding it again is pure waste. This path hands
the rendered IOSurface straight to the consumer.

What it removes: the VideoToolbox encoder, the decoder, the WebRTC jitter buffer
and pacing, and their frame queues. What it gains besides CPU and memory: the
pixels are exactly what Unreal rendered, with no 4:2:0 chroma subsampling and no
bitrate ceiling, and several frames of latency disappear with the encode and
decode stages.

## The one constraint

Sharing an IOSurface means passing a Mach port right. Passing a port right needs
an existing Mach channel, and on macOS that can only be bootstrapped through a
name in launchd's registry. **Only the process launchd itself launched may claim
such a name.**

Measured 2026-08-11:

| setup | result |
|---|---|
| ordinary process claims the service | `Connection invalid` |
| LaunchAgent registers the name, ordinary process claims it | `Connection invalid` |
| same binary declared as the job's `Program` | binds; client read `0xDEADBEEF` back out of the other process's surface |

So Unreal has to be started by launchd. That is the only reason `soul/mac_launchd.py`
exists. `kIOSurfaceIsGlobal` + `IOSurfaceLookup` would sidestep all of it and is
why the route is tempting; it has been deprecated as insecure since 10.11.

## Pieces

| where | what |
|---|---|
| `Plugins/PixelStreaming2NativeMac/.../MacDirectSurfaceServer.{h,mm}` | XPC listener, publishes finished surfaces |
| `Plugins/PixelStreaming2NativeMac/.../MacBackBufferProducer.cpp` | routes the frame to a viewer when one is attached, otherwise to the encoder exactly as before |
| `soul/soul/mac_launchd.py` | writes the plist, bootstraps the job, `LaunchdProc` stands in for `Popen` |
| `tools/iosurface_viewer/viewer.m` | reference consumer, proves the transport with no Electron risk |

Surfaces are sent once each, on first use; after that a frame is a ~64-byte
message carrying an id and a serial. A pool rebuild on resize mints new ids and
re-sends them automatically, so resolution changes need no special case.

Each published frame holds its pool slot and releases the previous one only
after the next has been handed over, so a slot is never overwritten while it is
on screen. Exactly one extra slot is held.

## Verify

1. Build the UE project (the plugin has new files, so it needs a compile).
2. Start soul with the launchd path on:

   ```
   UNCLAW_UE_LAUNCHD=1 ./run_soul.sh
   ```

3. Build and run the viewer:

   ```
   cd tools/iosurface_viewer
   clang -fobjc-arc -framework Cocoa -framework IOSurface -framework QuartzCore viewer.m -o viewer
   ./viewer
   ```

Expected: the viewer window shows the live character, and `game.log` carries
`[DirectSurface] viewer attached`. The viewer prints fps, frame count, gaps and
how many surfaces it has mapped (should settle at the pool size).

If Unreal was not started under launchd the listener will not bind, the log says
so once, and everything continues on the encoder path unchanged.

## Not done yet

- Hosting the layer inside the Electron window (native addon + `CALayer` on the
  `BrowserWindow`'s view). The viewer exists to de-risk exactly this.
- Turning the WebRTC **video** track off while a viewer is attached. The frame
  already bypasses the encoder, but the track is still negotiated.
- Colour: the surface is tagged 709 primaries for VideoToolbox's benefit. With
  no VideoToolbox in the path, the P3-to-sRGB correction currently applied in
  CSS needs revisiting so the conversion happens once, or not at all.
