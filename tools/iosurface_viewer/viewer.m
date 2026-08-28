// Copyright Foton Labs. Internal — not for distribution.
//
// iosurface_viewer — displays Unreal's frames with no encode and no decode.
//
// This is the reference consumer for MacDirectSurfaceServer, and it exists to
// prove the transport before any of it goes near Electron's build system. If
// this window shows a live, pixel-exact character then the remaining work is
// only about where the layer is hosted.
//
// It is deliberately tiny: connect, cache surfaces by id, and point a CALayer
// at the newest one. There is no drawing code because there is nothing to draw
// — the window server composites Unreal's GPU surface directly.
//
// Build:  clang -fobjc-arc -framework Cocoa -framework IOSurface \
//               -framework QuartzCore viewer.m -o viewer
// Run:    ./viewer          (honours UNCLAW_SURFACE_SERVICE, same as the server)

#import <Cocoa/Cocoa.h>
#import <IOSurface/IOSurface.h>
#import <QuartzCore/QuartzCore.h>
#import <xpc/xpc.h>

static const uint64_t kProtocolVersion = 1;

@interface Viewer : NSObject <NSApplicationDelegate>
@end

@implementation Viewer {
    NSWindow            *_window;
    CALayer             *_layer;
    NSMutableDictionary *_surfaces;   // @(IOSurfaceID) -> surface (as id)
    xpc_connection_t     _conn;
    uint64_t             _frames;
    uint64_t             _lastReportFrames;
    CFAbsoluteTime       _lastReport;
    uint64_t             _lastSerial;
    uint64_t             _gaps;
}

- (void)applicationDidFinishLaunching:(NSNotification *)n {
    _surfaces = [NSMutableDictionary dictionary];
    _lastReport = CFAbsoluteTimeGetCurrent();

    _window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(120, 120, 960, 540)
                  styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable
                    backing:NSBackingStoreBuffered
                      defer:NO];
    _window.title = @"Unclaw — direct IOSurface (no encode/decode)";
    _window.contentView.wantsLayer = YES;
    _window.contentView.layer.backgroundColor = NSColor.blackColor.CGColor;

    _layer = [CALayer layer];
    _layer.frame = _window.contentView.bounds;
    _layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    // The surface arrives already the right way up for Core Animation, and we
    // letterbox rather than distort so a resolution mismatch is obvious.
    _layer.contentsGravity = kCAGravityResizeAspect;
    // No implicit animation: a frame is a discrete swap, and letting Core
    // Animation cross-fade between them would both blur motion and cost time.
    _layer.actions = @{ @"contents": [NSNull null] };
    [_window.contentView.layer addSublayer:_layer];
    [_window makeKeyAndOrderFront:nil];

    const char *name = getenv("UNCLAW_SURFACE_SERVICE");
    if (!name || !*name) name = "com.fotonlabs.unclaw.surface";

    _conn = xpc_connection_create_mach_service(name, dispatch_get_main_queue(), 0);
    if (!_conn) {
        NSLog(@"viewer: cannot reach service '%s'", name);
        [NSApp terminate:nil];
        return;
    }
    __weak Viewer *weakSelf = self;
    xpc_connection_set_event_handler(_conn, ^(xpc_object_t msg) {
        Viewer *self_ = weakSelf; if (!self_) return;
        if (xpc_get_type(msg) == XPC_TYPE_ERROR) {
            NSLog(@"viewer: %s — is Unreal running as a launchd job?",
                  xpc_dictionary_get_string(msg, XPC_ERROR_KEY_DESCRIPTION));
            return;
        }
        [self_ onFrame:msg];
    });
    xpc_connection_resume(_conn);

    // A first message is what makes the server notice us; it publishes on its
    // own cadence from then on.
    xpc_object_t hello = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_string(hello, "op", "attach");
    xpc_connection_send_message(_conn, hello);
    NSLog(@"viewer: attached to '%s'", name);
}

- (void)onFrame:(xpc_object_t)msg {
    if (xpc_dictionary_get_uint64(msg, "version") != kProtocolVersion) {
        NSLog(@"viewer: protocol mismatch — rebuild both sides");
        return;
    }
    const uint32_t sid = (uint32_t)xpc_dictionary_get_uint64(msg, "surface_id");
    const uint64_t serial = xpc_dictionary_get_uint64(msg, "serial");

    // The port right only rides along the first time a surface is used, so the
    // steady-state message is a few dozen bytes.
    xpc_object_t so = xpc_dictionary_get_value(msg, "surface");
    if (so) {
        IOSurfaceRef s = IOSurfaceLookupFromXPCObject(so);
        if (s) {
            _surfaces[@(sid)] = (__bridge_transfer id)s;
            NSLog(@"viewer: mapped surface %u (%zux%zu), %lu cached",
                  sid, IOSurfaceGetWidth(s), IOSurfaceGetHeight(s),
                  (unsigned long)_surfaces.count);
        }
    }

    id surface = _surfaces[@(sid)];
    if (!surface) return;   // frame for a surface we were never given

    _layer.contents = surface;

    if (_lastSerial && serial != _lastSerial + 1) _gaps++;
    _lastSerial = serial;

    _frames++;
    CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
    if (now - _lastReport >= 2.0) {
        double fps = (_frames - _lastReportFrames) / (now - _lastReport);
        NSLog(@"viewer: %.1f fps, %llu frames, %llu gaps, %lu surfaces",
              fps, _frames, _gaps, (unsigned long)_surfaces.count);
        _lastReport = now;
        _lastReportFrames = _frames;
    }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)a { return YES; }
@end

int main(void) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        Viewer *v = [[Viewer alloc] init];
        app.delegate = v;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        [app run];
    }
    return 0;
}
