// Copyright Foton Labs. Internal — not for distribution.
//
// surface_layer — hosts Unreal's IOSurface directly inside the app window.
//
// The frame Unreal rendered is placed on a CALayer sitting behind the web
// content. Nothing is encoded, transported or decoded: the window server
// composites Unreal's GPU surface with the React chrome the same way it would
// composite any two layers. That removes the H.264 encoder, the decoder, the
// WebRTC jitter buffer and their frame queues, and it removes 4:2:0 chroma
// subsampling, so what you see is exactly what Unreal drew.
//
// Layer ordering: our layer is inserted at index 0 of the window's content
// view, i.e. UNDER the web contents. The BrowserWindow must therefore be
// created transparent, otherwise Chromium paints an opaque background over us.
//
// Threading: every AppKit and Core Animation call here runs on the main thread.
// The XPC connection is bound to the main queue for exactly that reason, and
// Electron's main thread runs a CFRunLoop, so those blocks are serviced without
// any extra pumping.
//
// The N-API surface is deliberately tiny: start, stop, stats. Anything more
// belongs in JS.

#import <Cocoa/Cocoa.h>
#import <IOSurface/IOSurface.h>
#import <QuartzCore/QuartzCore.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>
#import <xpc/xpc.h>

#include <node_api.h>

#include <atomic>

namespace {

constexpr uint64_t kProtocolVersion = 1;

struct State {
  CAMetalLayer       *layer = nil;
  id<MTLDevice>       device = nil;
  id<MTLCommandQueue> queue = nil;
  NSMutableDictionary *textures = nil;   // @(IOSurfaceID) -> id<MTLTexture>
  NSView             *backingView = nil;   // our own view, below the web view
  NSView             *host = nil;
  NSMutableDictionary *surfaces = nil;   // @(IOSurfaceID) -> surface
  xpc_connection_t    conn = nullptr;
  std::atomic<bool>   connected{false};
  std::atomic<uint64_t> frames{0};
  std::atomic<uint64_t> gaps{0};
  uint64_t            lastSerial = 0;
  CFAbsoluteTime      startedAt = 0;
};

State g;

void Teardown() {
  if (g.conn) {
    xpc_connection_cancel(g.conn);
    g.conn = nullptr;
  }
  g.connected.store(false);
  if (g.layer) {
    [g.layer removeFromSuperlayer];
    g.layer = nil;
  }
  if (g.backingView) {
    [g.backingView removeFromSuperview];
    g.backingView = nil;
  }
  g.surfaces = nil;
  g.textures = nil;
  g.queue = nil;
  g.device = nil;
  g.host = nil;
  g.lastSerial = 0;
}

void OnMessage(xpc_object_t msg) {
  if (xpc_get_type(msg) == XPC_TYPE_ERROR) {
    g.connected.store(false);
    return;
  }
  if (xpc_dictionary_get_uint64(msg, "version") != kProtocolVersion) {
    return;  // built against a different protocol; ignore rather than misread
  }

  const uint32_t sid = (uint32_t)xpc_dictionary_get_uint64(msg, "surface_id");
  const uint64_t serial = xpc_dictionary_get_uint64(msg, "serial");

  // The port right rides along only on a surface's first use; afterwards the
  // message is just an id, so steady state costs no port traffic at all.
  xpc_object_t so = xpc_dictionary_get_value(msg, "surface");
  if (so) {
    IOSurfaceRef s = IOSurfaceLookupFromXPCObject(so);
    if (s) {
      g.surfaces[@(sid)] = (__bridge_transfer id)s;
    }
  }

  id surface = g.surfaces[@(sid)];
  if (!surface || !g.layer) {
    return;
  }

  // A frame is a discrete swap. Without disabling implicit animation Core
  // Animation cross-fades between contents, which both blurs motion and adds
  // work per frame.
  IOSurfaceRef surf = (__bridge IOSurfaceRef)surface;
  const size_t sw = IOSurfaceGetWidth(surf), sh = IOSurfaceGetHeight(surf);

  // Wrap the surface as a texture once per surface, not per frame: the ring
  // reuses the same four, so this settles immediately.
  id<MTLTexture> tex = g.textures[@(sid)];
  if (!tex) {
    MTLTextureDescriptor *td =
        [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                           width:sw height:sh mipmapped:NO];
    td.usage = MTLTextureUsageShaderRead;
    td.storageMode = MTLStorageModePrivate;
    tex = [g.device newTextureWithDescriptor:td iosurface:surf plane:0];
    if (!tex) { NSLog(@"[direct-native] texture wrap FAILED for surface %u", sid); return; }
    g.textures[@(sid)] = tex;
  }

  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  // Sized every frame: a sublayer under an AppKit-managed view layer is not
  // autoresized, so nothing else keeps this in step with the window.
  g.layer.frame = g.backingView.bounds;
  // Drawable matches the SOURCE, so the blit is a straight copy and the layer
  // does the scaling, keeping the character's aspect.
  g.layer.drawableSize = CGSizeMake(sw, sh);
  [CATransaction commit];

  id<CAMetalDrawable> drawable = [g.layer nextDrawable];
  if (!drawable) { return; }
  id<MTLCommandBuffer> cb = [g.queue commandBuffer];
  id<MTLBlitCommandEncoder> blit = [cb blitCommandEncoder];
  [blit copyFromTexture:tex sourceSlice:0 sourceLevel:0
            sourceOrigin:MTLOriginMake(0, 0, 0)
              sourceSize:MTLSizeMake(sw, sh, 1)
               toTexture:drawable.texture destinationSlice:0 destinationLevel:0
       destinationOrigin:MTLOriginMake(0, 0, 0)];
  [blit endEncoding];
  [cb presentDrawable:drawable];
  [cb commit];

  if (g.lastSerial && serial != g.lastSerial + 1) {
    g.gaps.fetch_add(1);
  }
  g.lastSerial = serial;
  const uint64_t n = g.frames.fetch_add(1) + 1;
  g.connected.store(true);

  // Sample the centre pixel occasionally. "Purple window" has two very
  // different causes: the layer not displaying our surface, or the surface
  // genuinely being black because Unreal is rendering an empty scene. Reading
  // the bytes tells them apart without guessing.
  if (n == 1 || (n % 1800) == 0) {
    IOSurfaceRef s = (__bridge IOSurfaceRef)surface;
    IOSurfaceLock(s, kIOSurfaceLockReadOnly, NULL);
    const size_t w = IOSurfaceGetWidth(s), h = IOSurfaceGetHeight(s);
    const size_t stride = IOSurfaceGetBytesPerRow(s);
    uint8_t *base = (uint8_t *)IOSurfaceGetBaseAddress(s);
    uint32_t centre = 0; uint64_t sum = 0;
    if (base) {
      centre = *(uint32_t *)(base + (h / 2) * stride + (w / 2) * 4);
      for (size_t y = 0; y < h; y += 16)
        for (size_t x = 0; x < w; x += 16) {
          uint8_t *px = base + y * stride + x * 4;
          sum += px[0] + px[1] + px[2];
        }
    }
    IOSurfaceUnlock(s, kIOSurfaceLockReadOnly, NULL);
    NSLog(@"[direct-native] frame %llu surf=%zux%zu centre=0x%08X sum=%llu "
           "layer=%.0fx%.0f view=%.0fx%.0f hidden=%d opacity=%.2f super=%@",
          n, w, h, centre, sum,
          g.layer.bounds.size.width, g.layer.bounds.size.height,
          g.backingView.bounds.size.width, g.backingView.bounds.size.height,
          (int)g.layer.hidden, g.layer.opacity,
          g.layer.superlayer ? @"yes" : @"NO");
  }
}

// N-API calls arrive on Electron's main thread, which IS the AppKit thread.
// dispatch_sync onto the main queue from the main queue deadlocks, so run the
// block inline when we are already there.
static void RunOnMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

// ---- N-API -----------------------------------------------------------------

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  napi_value out;
  if (argc < 1) {
    napi_get_boolean(env, false, &out);
    return out;
  }

  // Electron hands back the NSView* for the window's content view, as the
  // raw bytes of the pointer inside a Buffer.
  void *data = nullptr;
  size_t len = 0;
  if (napi_get_buffer_info(env, argv[0], &data, &len) != napi_ok
      || len < sizeof(void *) || !data) {
    napi_get_boolean(env, false, &out);
    return out;
  }
  NSView *view = (__bridge NSView *)(*reinterpret_cast<void **>(data));
  if (!view) {
    napi_get_boolean(env, false, &out);
    return out;
  }

  char serviceBuf[256] = "com.fotonlabs.unclaw.surface";
  if (argc >= 2) {
    size_t n = 0;
    napi_get_value_string_utf8(env, argv[1], serviceBuf, sizeof(serviceBuf), &n);
  }
  // A C array cannot be captured by a block; hand the block an object instead.
  NSString *service = [NSString stringWithUTF8String:serviceBuf];

  __block bool ok = false;
  RunOnMain(^{
    Teardown();

    g.host = view;
    g.surfaces = [NSMutableDictionary dictionary];
    g.startedAt = CFAbsoluteTimeGetCurrent();
    g.frames = 0;
    g.gaps = 0;

    // Our own NSView, inserted BELOW Chromium's. A bare sublayer on the content
    // view's layer is not reliably under the web contents: Electron hosts the
    // page in a sibling NSView, and a subview draws above the host layer's
    // sublayers whatever index they were given. Owning a view puts us
    // unambiguously in the view order.
    view.wantsLayer = YES;
    g.backingView = [[NSView alloc] initWithFrame:view.bounds];
    g.backingView.wantsLayer = YES;
    g.backingView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [view addSubview:g.backingView positioned:NSWindowBelow relativeTo:nil];

    // A DEDICATED sublayer, never the view's own layer. AppKit owns the backing
    // layer of a layer-backed NSView and rewrites its contents on display, so
    // assigning an IOSurface there is silently discarded: the tint keeps
    // showing and the frames go nowhere. A sublayer we own is left alone.
    // Black, not a debug tint: this is what shows in the moment before the
    // first frame arrives and behind the letterbox bars.
    g.backingView.layer.backgroundColor = CGColorCreateGenericRGB(0.0, 0.0, 0.0, 1.0);

    // CAMetalLayer + an explicit GPU blit, rather than assigning the IOSurface
    // to CALayer.contents. That assignment is widely cited as working and it
    // does not here: with a correctly sized, visible, opaque layer holding a
    // surface full of good pixels, nothing was ever drawn. A Metal layer makes
    // the copy explicit and is the path Apple actually documents. It stays
    // zero-copy in the sense that matters: the IOSurface is wrapped as a
    // texture, never read back to the CPU.
    g.device = MTLCreateSystemDefaultDevice();
    g.queue = [g.device newCommandQueue];
    g.textures = [NSMutableDictionary dictionary];

    g.layer = [CAMetalLayer layer];
    g.layer.device = g.device;
    g.layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    g.layer.framebufferOnly = NO;
    g.layer.frame = g.backingView.bounds;
    // Letterbox rather than distort, so a resolution mismatch is visible
    // instead of silently stretching the character's face.
    g.layer.contentsGravity = kCAGravityResizeAspect;
    g.layer.actions = @{ @"contents": [NSNull null] };
    // Unreal's backbuffer carries alpha 0: it renders colour and never writes
    // an alpha channel, because in the WebRTC path alpha is discarded on the
    // way into H.264. Core Animation does NOT discard it, so an untouched
    // surface composites as fully transparent and the window shows whatever is
    // behind it while the pixels are perfectly good. Marking the layer opaque
    // tells the compositor to ignore alpha entirely.
    g.layer.opaque = YES;
    [g.backingView.layer addSublayer:g.layer];

    g.conn = xpc_connection_create_mach_service([service UTF8String], dispatch_get_main_queue(), 0);
    if (!g.conn) {
      Teardown();
      return;
    }
    xpc_connection_set_event_handler(g.conn, ^(xpc_object_t m) { OnMessage(m); });
    xpc_connection_resume(g.conn);

    // The publisher only notices us once we say something.
    xpc_object_t hello = xpc_dictionary_create(nullptr, nullptr, 0);
    xpc_dictionary_set_string(hello, "op", "attach");
    xpc_connection_send_message(g.conn, hello);
    ok = true;
  });

  napi_get_boolean(env, ok, &out);
  return out;
}

napi_value Stop(napi_env env, napi_callback_info info) {
  RunOnMain(^{ Teardown(); });
  napi_value out;
  napi_get_boolean(env, true, &out);
  return out;
}

napi_value Stats(napi_env env, napi_callback_info info) {
  const uint64_t frames = g.frames.load();
  const double elapsed = g.startedAt ? (CFAbsoluteTimeGetCurrent() - g.startedAt) : 0.0;

  napi_value obj, v;
  napi_create_object(env, &obj);
  napi_get_boolean(env, g.connected.load(), &v);
  napi_set_named_property(env, obj, "connected", v);
  napi_create_double(env, (double)frames, &v);
  napi_set_named_property(env, obj, "frames", v);
  napi_create_double(env, (double)g.gaps.load(), &v);
  napi_set_named_property(env, obj, "gaps", v);
  napi_create_double(env, elapsed > 0.5 ? frames / elapsed : 0.0, &v);
  napi_set_named_property(env, obj, "fps", v);
  napi_create_double(env, g.surfaces ? (double)g.surfaces.count : 0.0, &v);
  napi_set_named_property(env, obj, "surfaces", v);
  return obj;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, nullptr, &fn);
  napi_set_named_property(env, exports, "start", fn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, nullptr, &fn);
  napi_set_named_property(env, exports, "stop", fn);
  napi_create_function(env, "stats", NAPI_AUTO_LENGTH, Stats, nullptr, &fn);
  napi_set_named_property(env, exports, "stats", fn);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
