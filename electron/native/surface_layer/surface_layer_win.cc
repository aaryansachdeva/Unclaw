// Copyright Foton Labs. Internal - not for distribution.
//
// surface_layer (Windows) - the consumer half of the direct display path.
//
// This is the Windows twin of surface_layer.mm. Same job, same N-API surface,
// same stats, different OS primitives:
//
//              macOS                     Windows
//   transport  XPC over a Mach service   named pipe
//   texture    IOSurfaceRef              D3D11 shared texture, NT HANDLE
//   handoff    mach port right           DuplicateHandle into our PID
//
// WHY NO LAUNCHD EQUIVALENT IS NEEDED
//
// On macOS only a launchd-launched process may claim a Mach service name, which
// is the entire reason soul/mac_launchd.py exists. Windows has no such rule: any
// process may create a named pipe, and an NT HANDLE is moved between processes
// explicitly with DuplicateHandle. So Unreal can be spawned as an ordinary
// child here and the direct path still works - one whole moving part fewer.
//
// WHY THE PUBLISHER DUPLICATES, AND WE DO NOT OPEN BY NAME
//
// Electron documents handle.ntHandle as "local to current process", so the
// value we hand it must already be valid in THIS process. Two ways to get one:
//
//   1. the publisher names the shared handle and we re-open it with
//      ID3D11Device1::OpenSharedResourceByName - needs a D3D11 device, a DXGI
//      adapter match, and drags the whole D3D dependency into this addon; or
//   2. we tell the publisher our PID, it calls DuplicateHandle, and sends us a
//      handle that is already ours.
//
// (2) is what this implements. The addon needs no graphics API at all: it is a
// pipe client that marshals integers. Everything GPU-shaped happens in Unreal
// (which already has the device) and in Chromium (which imports the handle).
//
// LIFETIME
//
// The publisher owns the pool and holds each slot until the next frame
// supersedes it, exactly as on macOS. Duplicated handles stay valid until WE
// close them, so a publisher restart cannot pull a texture out from under a
// frame Chromium is still sampling. We close ours in Stop().
//
// Threading: one reader thread owns the pipe. Frames reach JS through a napi
// threadsafe function with queue depth 2, nonblocking - if JS is behind,
// dropping beats queueing stale frames (same choice as the Mac addon).

#include <node_api.h>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace {

// ---------------------------------------------------------------------------
// Wire protocol. Fixed-size structs so framing is a plain ReadFile of a known
// length: a length-prefixed varint scheme buys nothing when every message is
// the same shape, and costs a resync path when it desynchronises.
// ---------------------------------------------------------------------------

constexpr uint32_t kMagic = 0x554E4331;  // 'UNC1'
constexpr uint32_t kProtocolVersion = 1;

constexpr uint32_t kKindSurface = 1;  // carries a handle: first sight of this id
constexpr uint32_t kKindFrame = 2;    // id + serial only, the steady state

#pragma pack(push, 1)
struct Hello {
  uint32_t magic;
  uint32_t version;
  uint32_t pid;       // publisher duplicates into this process
  uint32_t reserved;
};

struct FrameMsg {
  uint32_t magic;
  uint32_t version;
  uint32_t kind;
  uint32_t surfaceId;
  uint64_t handle;    // valid when kind == kKindSurface, already ours
  uint32_t width;
  uint32_t height;
  uint64_t serial;
};
#pragma pack(pop)

// What crosses to the JS thread. One per delivered frame.
struct FrameOut {
  uint64_t handle;   // 0 for a ping
  uint32_t sid;
  uint64_t serial;
  uint32_t width;
  uint32_t height;
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

struct State {
  std::thread worker;
  std::atomic<bool> running{false};
  std::atomic<bool> connected{false};

  std::atomic<uint64_t> frames{0};
  std::atomic<uint64_t> gaps{0};
  std::atomic<uint64_t> lastSerial{0};

  // fps over a sliding window; a lifetime average would describe the whole
  // session rather than what the stream is doing now (same reasoning as
  // measure.sh's CPU delta).
  std::mutex fpsMu;
  std::chrono::steady_clock::time_point fpsWindowStart;
  uint64_t fpsWindowFrames = 0;
  double fps = 0.0;

  // Handles we own, keyed by surface id. Closed in Stop().
  std::mutex handlesMu;
  std::unordered_map<uint32_t, HANDLE> handles;

  napi_threadsafe_function tsfn = nullptr;
  std::wstring pipeName;

  // Signalled by Stop(). The reader waits on this ALONGSIDE its overlapped
  // read, so a blocking ReadFile can never outlive the stop request: a plain
  // synchronous read here hung Electron's quit until the publisher happened to
  // send another frame (caught by smoke_win.js, which never reached SMOKE OK).
  HANDLE stopEvent = nullptr;
};

State g;

std::wstring Widen(const std::string& s) {
  if (s.empty()) return std::wstring();
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring out(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), n);
  return out;
}

void NoteFrame(uint64_t serial) {
  const uint64_t prev = g.lastSerial.exchange(serial);
  // A serial jump means the publisher dropped frames (its pool starved, or it
  // was mid-resize). Counting them separately from delivered frames is what
  // makes "UE is pacing badly" distinguishable from "we are behind".
  if (prev != 0 && serial > prev + 1) g.gaps.fetch_add(serial - prev - 1);
  g.frames.fetch_add(1);

  std::lock_guard<std::mutex> lk(g.fpsMu);
  const auto now = std::chrono::steady_clock::now();
  if (g.fpsWindowStart.time_since_epoch().count() == 0) g.fpsWindowStart = now;
  g.fpsWindowFrames += 1;
  const double elapsed =
      std::chrono::duration<double>(now - g.fpsWindowStart).count();
  // Publish a running estimate from a quarter second on, so `stats()` is
  // informative immediately instead of reporting 0 for the first whole second
  // (which read as "no frames" in the first smoke run). The window still
  // closes and resets at 1s, so the steady-state number stays a clean
  // one-second rate rather than a lifetime average.
  if (elapsed >= 0.25) {
    g.fps = (double)g.fpsWindowFrames / elapsed;
  }
  if (elapsed >= 1.0) {
    g.fpsWindowFrames = 0;
    g.fpsWindowStart = now;
  }
}

// ---------------------------------------------------------------------------
// JS marshalling. Mirrors the Mac addon's CallJs: the object shape is the
// contract directSurface.ts reads, with ntHandle where macOS puts ioSurface.
// ---------------------------------------------------------------------------

void CallJs(napi_env env, napi_value jsCb, void* /*ctx*/, void* data) {
  FrameOut* m = static_cast<FrameOut*>(data);
  if (env != nullptr && jsCb != nullptr) {
    napi_value obj, v, undefined;
    napi_get_undefined(env, &undefined);
    napi_create_object(env, &obj);

    if (m->handle != 0) {
      // Buffer carries the HANDLE VALUE as bytes, the same convention the Mac
      // side uses for IOSurfaceRef and that getNativeWindowHandle uses. Sized
      // to the platform pointer so a 32-bit build stays correct.
      void* bufData = nullptr;
      napi_value buf;
      if (napi_create_buffer(env, sizeof(void*), &bufData, &buf) == napi_ok) {
        void* h = (void*)(uintptr_t)m->handle;
        memcpy(bufData, &h, sizeof(void*));
        napi_set_named_property(env, obj, "ntHandle", buf);
      }
    }
    napi_create_uint32(env, m->sid, &v);
    napi_set_named_property(env, obj, "surfaceId", v);
    napi_create_double(env, (double)m->serial, &v);
    napi_set_named_property(env, obj, "serial", v);
    napi_create_uint32(env, m->width, &v);
    napi_set_named_property(env, obj, "width", v);
    napi_create_uint32(env, m->height, &v);
    napi_set_named_property(env, obj, "height", v);

    napi_call_function(env, undefined, jsCb, 1, &obj, nullptr);
  }
  delete m;
}

// ---------------------------------------------------------------------------
// Reader thread
// ---------------------------------------------------------------------------

// Overlapped read that also watches the stop event. Returns false on EOF,
// error, or a stop request - the caller treats all three the same way.
bool ReadExact(HANDLE pipe, HANDLE readEvent, void* dst, DWORD len) {
  DWORD got = 0;
  auto* p = static_cast<uint8_t*>(dst);
  while (got < len) {
    OVERLAPPED ov{};
    ov.hEvent = readEvent;
    ResetEvent(readEvent);

    DWORD n = 0;
    if (!ReadFile(pipe, p + got, len - got, &n, &ov)) {
      if (GetLastError() != ERROR_IO_PENDING) return false;
      HANDLE waits[2] = {readEvent, g.stopEvent};
      const DWORD w = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
      if (w != WAIT_OBJECT_0) {
        // Stop requested (or the wait failed): cancel the in-flight read so
        // the handle can be closed without stranding kernel state.
        CancelIoEx(pipe, &ov);
        GetOverlappedResult(pipe, &ov, &n, TRUE);
        return false;
      }
      if (!GetOverlappedResult(pipe, &ov, &n, FALSE)) return false;
    }
    if (n == 0) return false;
    got += n;
  }
  return true;
}

void WorkerMain() {
  // Reconnect loop. Unreal restarting (crash recovery, character swap) breaks
  // the pipe; without retrying here the app would silently sit on the WebRTC
  // fallback for the rest of the session. directSurface.ts ALSO re-attaches on
  // two disconnected polls, so this is belt and braces - both are cheap.
  while (g.running.load(std::memory_order_acquire)) {
    HANDLE pipe = CreateFileW(g.pipeName.c_str(), GENERIC_READ | GENERIC_WRITE,
                              0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED,
                              nullptr);
    if (pipe == INVALID_HANDLE_VALUE) {
      // Not an error: the normal state before Unreal is up. Wait on the stop
      // event rather than sleeping, so Stop() during the retry loop is instant.
      if (WaitForSingleObject(g.stopEvent, 500) == WAIT_OBJECT_0) break;
      continue;
    }

    // Manual-reset, reused for every read on this connection.
    HANDLE readEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (readEvent == nullptr) { CloseHandle(pipe); break; }

    DWORD mode = PIPE_READMODE_BYTE;
    SetNamedPipeHandleState(pipe, &mode, nullptr, nullptr);

    Hello hello{kMagic, kProtocolVersion, GetCurrentProcessId(), 0};
    {
      OVERLAPPED ov{};
      ov.hEvent = readEvent;
      ResetEvent(readEvent);
      DWORD wrote = 0;
      bool wok = WriteFile(pipe, &hello, sizeof(hello), &wrote, &ov) != 0;
      if (!wok && GetLastError() == ERROR_IO_PENDING) {
        wok = GetOverlappedResult(pipe, &ov, &wrote, TRUE) != 0;
      }
      if (!wok || wrote != sizeof(hello)) {
        CloseHandle(readEvent);
        CloseHandle(pipe);
        if (WaitForSingleObject(g.stopEvent, 500) == WAIT_OBJECT_0) break;
        continue;
      }
    }

    g.connected.store(true, std::memory_order_release);

    while (g.running.load(std::memory_order_acquire)) {
      FrameMsg msg{};
      if (!ReadExact(pipe, readEvent, &msg, sizeof(msg))) break;
      // A version mismatch is ignored rather than misread - the same rule the
      // Mac side applies to its XPC dictionaries.
      if (msg.magic != kMagic || msg.version != kProtocolVersion) continue;

      if (msg.kind == kKindSurface && msg.handle != 0) {
        HANDLE h = (HANDLE)(uintptr_t)msg.handle;
        std::lock_guard<std::mutex> lk(g.handlesMu);
        auto it = g.handles.find(msg.surfaceId);
        if (it != g.handles.end() && it->second != h) {
          // A pool rebuild (resize) mints new ids, but a publisher that reuses
          // an id with a new handle must not leak the old one.
          CloseHandle(it->second);
          it->second = h;
        } else if (it == g.handles.end()) {
          g.handles.emplace(msg.surfaceId, h);
        }
      } else if (msg.kind != kKindFrame) {
        continue;
      }

      NoteFrame(msg.serial);

      if (g.tsfn) {
        auto* out = new FrameOut{msg.kind == kKindSurface ? msg.handle : 0,
                                 msg.surfaceId, msg.serial, msg.width,
                                 msg.height};
        // Nonblocking: a full queue means JS is behind, and the newest frame
        // is worth more than a backlog of stale ones.
        if (napi_call_threadsafe_function(g.tsfn, out, napi_tsfn_nonblocking) !=
            napi_ok) {
          delete out;
        }
      }
    }

    g.connected.store(false, std::memory_order_release);
    CancelIoEx(pipe, nullptr);
    CloseHandle(pipe);
    CloseHandle(readEvent);
    if (g.running.load(std::memory_order_acquire)) {
      if (WaitForSingleObject(g.stopEvent, 300) == WAIT_OBJECT_0) break;
    }
  }
}

// ---------------------------------------------------------------------------
// N-API entry points. Same names and shapes as the Mac addon so
// directSurface.ts needs no per-platform branch to call them.
// ---------------------------------------------------------------------------

// start(handle, service) - mode 1 only, which is a CAMetalLayer path with no
// Windows equivalent. Returns false so directSurface.ts falls back cleanly if
// it is ever reached (mode() already forces '2' off-darwin).
napi_value Start(napi_env env, napi_callback_info /*info*/) {
  napi_value out;
  napi_get_boolean(env, false, &out);
  return out;
}

// startFrames(pipeName: string, onFrame: (frame) => void): boolean
napi_value StartFrames(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  napi_value out;
  if (argc < 2) {
    napi_get_boolean(env, false, &out);
    return out;
  }
  if (g.running.load(std::memory_order_acquire)) {
    napi_get_boolean(env, true, &out);
    return out;
  }

  size_t len = 0;
  napi_get_value_string_utf8(env, argv[0], nullptr, 0, &len);
  std::string name(len, '\0');
  napi_get_value_string_utf8(env, argv[0], name.data(), len + 1, &len);
  g.pipeName = Widen(name);

  napi_value resName;
  napi_create_string_utf8(env, "unclaw_surface_frames", NAPI_AUTO_LENGTH,
                          &resName);
  if (napi_create_threadsafe_function(env, argv[1], nullptr, resName, 2, 1,
                                      nullptr, nullptr, nullptr, CallJs,
                                      &g.tsfn) != napi_ok) {
    napi_get_boolean(env, false, &out);
    return out;
  }
  // The reader thread must not keep the event loop alive: Electron quitting
  // with a live ref here would hang the process on exit.
  napi_unref_threadsafe_function(env, g.tsfn);

  g.frames.store(0);
  g.gaps.store(0);
  g.lastSerial.store(0);
  {
    std::lock_guard<std::mutex> lk(g.fpsMu);
    g.fps = 0.0;
    g.fpsWindowFrames = 0;
    g.fpsWindowStart = {};
  }

  if (g.stopEvent) CloseHandle(g.stopEvent);
  g.stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);  // manual reset
  if (g.stopEvent == nullptr) {
    napi_get_boolean(env, false, &out);
    return out;
  }

  g.running.store(true, std::memory_order_release);
  g.worker = std::thread(WorkerMain);

  napi_get_boolean(env, true, &out);
  return out;
}

napi_value Stop(napi_env env, napi_callback_info /*info*/) {
  g.running.store(false, std::memory_order_release);
  // Signalling this is what actually unblocks the reader. The first cut opened
  // a SECOND connection to "nudge" it, which does nothing to a ReadFile already
  // pending on the first one - Stop() then blocked until the publisher sent
  // another frame, i.e. forever once Unreal had gone. smoke_win.js caught it.
  if (g.stopEvent) SetEvent(g.stopEvent);
  if (g.worker.joinable()) g.worker.join();
  {
    std::lock_guard<std::mutex> lk(g.handlesMu);
    for (auto& kv : g.handles) CloseHandle(kv.second);
    g.handles.clear();
  }
  if (g.tsfn) {
    napi_release_threadsafe_function(g.tsfn, napi_tsfn_release);
    g.tsfn = nullptr;
  }
  g.connected.store(false, std::memory_order_release);
  if (g.stopEvent) { CloseHandle(g.stopEvent); g.stopEvent = nullptr; }

  napi_value out;
  napi_get_boolean(env, true, &out);
  return out;
}

napi_value Stats(napi_env env, napi_callback_info /*info*/) {
  napi_value obj, v;
  napi_create_object(env, &obj);

  napi_get_boolean(env, g.connected.load(std::memory_order_acquire), &v);
  napi_set_named_property(env, obj, "connected", v);
  napi_create_double(env, (double)g.frames.load(), &v);
  napi_set_named_property(env, obj, "frames", v);
  napi_create_double(env, (double)g.gaps.load(), &v);
  napi_set_named_property(env, obj, "gaps", v);

  double fps;
  size_t surfaces;
  {
    std::lock_guard<std::mutex> lk(g.fpsMu);
    fps = g.fps;
  }
  {
    std::lock_guard<std::mutex> lk(g.handlesMu);
    surfaces = g.handles.size();
  }
  napi_create_double(env, fps, &v);
  napi_set_named_property(env, obj, "fps", v);
  napi_create_uint32(env, (uint32_t)surfaces, &v);
  napi_set_named_property(env, obj, "surfaces", v);
  return obj;
}

}  // namespace

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, nullptr, &fn);
  napi_set_named_property(env, exports, "start", fn);
  napi_create_function(env, "startFrames", NAPI_AUTO_LENGTH, StartFrames,
                       nullptr, &fn);
  napi_set_named_property(env, exports, "startFrames", fn);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, nullptr, &fn);
  napi_set_named_property(env, exports, "stop", fn);
  napi_create_function(env, "stats", NAPI_AUTO_LENGTH, Stats, nullptr, &fn);
  napi_set_named_property(env, exports, "stats", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
