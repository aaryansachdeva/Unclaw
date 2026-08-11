// Copyright Foton Labs. Internal — not for distribution.
//
// fake_publisher — stands in for Unreal so the whole consumer side can be built
// and measured before the engine is recompiled.
//
// It speaks the exact protocol MacDirectSurfaceServer speaks: a ring of
// IOSurfaces, each sent once on first use, then a small message per frame
// carrying the surface id and a serial. Consumers cannot tell the difference,
// which is the point: when the real plugin lands it simply replaces this.
//
// Runs as a launchd job for the same reason Unreal must (only the process
// launchd launched can claim a Mach service name).
//
// Build: clang -fobjc-arc -framework Foundation -framework IOSurface \
//              fake_publisher.m -o fake_publisher

#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <xpc/xpc.h>

static const uint64_t kProtocolVersion = 1;
static const int      kSlots  = 4;      // matches the real pool
static const int      kWidth  = 1280;
static const int      kHeight = 720;

static IOSurfaceRef      gSurfaces[kSlots];
static xpc_connection_t  gClient;
static NSMutableSet     *gSent;
static uint64_t          gSerial;

static IOSurfaceRef MakeSurface(void) {
    NSDictionary *props = @{
        (id)kIOSurfaceWidth:           @(kWidth),
        (id)kIOSurfaceHeight:          @(kHeight),
        (id)kIOSurfaceBytesPerElement: @4,
        (id)kIOSurfacePixelFormat:     @((uint32_t)'BGRA'),
    };
    return IOSurfaceCreate((__bridge CFDictionaryRef)props);
}

// A moving gradient: any tearing, staleness or a stuck frame is obvious on
// screen, which a static image would hide.
static void Paint(IOSurfaceRef s, uint64_t frame) {
    IOSurfaceLock(s, 0, NULL);
    uint8_t *base = IOSurfaceGetBaseAddress(s);
    const size_t stride = IOSurfaceGetBytesPerRow(s);
    for (int y = 0; y < kHeight; y++) {
        uint32_t *row = (uint32_t *)(base + y * stride);
        for (int x = 0; x < kWidth; x++) {
            uint8_t r = (uint8_t)((x * 255) / kWidth);
            uint8_t g = (uint8_t)((y * 255) / kHeight);
            uint8_t b = (uint8_t)(frame * 3);
            row[x] = (0xFFu << 24) | (r << 16) | (g << 8) | b;   // BGRA
        }
    }
    IOSurfaceUnlock(s, 0, NULL);
}

static void PublishFrame(void) {
    if (!gClient) return;
    const int slot = (int)(gSerial % kSlots);
    IOSurfaceRef s = gSurfaces[slot];
    Paint(s, gSerial);

    const uint32_t sid = IOSurfaceGetID(s);
    xpc_object_t msg = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_uint64(msg, "version", kProtocolVersion);
    xpc_dictionary_set_uint64(msg, "surface_id", sid);
    xpc_dictionary_set_uint64(msg, "serial", ++gSerial);
    xpc_dictionary_set_uint64(msg, "width", kWidth);
    xpc_dictionary_set_uint64(msg, "height", kHeight);

    if (![gSent containsObject:@(sid)]) {
        [gSent addObject:@(sid)];
        xpc_object_t so = IOSurfaceCreateXPCObject(s);
        xpc_dictionary_set_value(msg, "surface", so);
        NSLog(@"fake: sent surface %u (%dx%d)", sid, kWidth, kHeight);
    }
    xpc_connection_send_message(gClient, msg);
}

int main(void) {
    gSent = [NSMutableSet set];
    for (int i = 0; i < kSlots; i++) gSurfaces[i] = MakeSurface();

    const char *name = getenv("UNCLAW_SURFACE_SERVICE");
    if (!name || !*name) name = "com.fotonlabs.unclaw.surface";

    xpc_connection_t listener = xpc_connection_create_mach_service(
        name, dispatch_get_main_queue(), XPC_CONNECTION_MACH_SERVICE_LISTENER);
    if (!listener) { NSLog(@"fake: cannot create listener"); return 2; }

    xpc_connection_set_event_handler(listener, ^(xpc_object_t peer) {
        if (xpc_get_type(peer) == XPC_TYPE_ERROR) {
            NSLog(@"fake: listener error %s — not running as a launchd job?",
                  xpc_dictionary_get_string(peer, XPC_ERROR_KEY_DESCRIPTION));
            return;
        }
        gClient = (xpc_connection_t)peer;
        [gSent removeAllObjects];   // a reconnect must be re-sent the surfaces
        xpc_connection_set_event_handler(gClient, ^(xpc_object_t m) {
            if (xpc_get_type(m) == XPC_TYPE_ERROR) {
                NSLog(@"fake: consumer gone");
                gClient = nil;
                [gSent removeAllObjects];
            }
        });
        xpc_connection_resume(gClient);
        NSLog(@"fake: consumer attached");
    });
    xpc_connection_resume(listener);
    NSLog(@"fake: publishing %dx%d at 60fps on '%s'", kWidth, kHeight, name);

    dispatch_source_t timer = dispatch_source_create(
        DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, DISPATCH_TIME_NOW,
                              (uint64_t)(NSEC_PER_SEC / 60), NSEC_PER_MSEC);
    dispatch_source_set_event_handler(timer, ^{ PublishFrame(); });
    dispatch_resume(timer);

    dispatch_main();
}
