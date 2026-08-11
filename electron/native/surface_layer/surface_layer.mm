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
#import <xpc/xpc.h>

#include <node_api.h>

#include <atomic>

namespace {

constexpr uint64_t kProtocolVersion = 1;

struct State {
  CALayer            *layer = nil;
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
  g.surfaces = nil;
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
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  g.layer.contents = surface;
  [CATransaction commit];

  if (g.lastSerial && serial != g.lastSerial + 1) {
    g.gaps.fetch_add(1);
  }
  g.lastSerial = serial;
  g.frames.fetch_add(1);
  g.connected.store(true);
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

    view.wantsLayer = YES;
    g.layer = [CALayer layer];
    g.layer.frame = view.bounds;
    g.layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    // Letterbox rather than distort, so a resolution mismatch is visible
    // instead of silently stretching the character's face.
    g.layer.contentsGravity = kCAGravityResizeAspect;
    g.layer.backgroundColor = NSColor.clearColor.CGColor;
    g.layer.actions = @{ @"contents": [NSNull null] };
    // Index 0: behind the web contents. The window must be transparent or
    // Chromium's own background paints straight over this.
    [view.layer insertSublayer:g.layer atIndex:0];

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
