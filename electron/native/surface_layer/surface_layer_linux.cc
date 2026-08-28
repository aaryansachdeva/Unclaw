// Copyright Foton Labs. Internal - not for distribution.
//
// surface_layer (Linux) - the consumer half of the direct display path.
//
// Third sibling of surface_layer.mm and surface_layer_win.cc. Same N-API
// surface, same stats, same "hand the compositor a GPU handle instead of an
// H.264 stream" bet, on the Linux primitives:
//
//              macOS                 Windows              Linux
//   transport  XPC / Mach service    named pipe           unix socket
//   texture    IOSurfaceRef          D3D11 NT HANDLE      dmabuf FD(s)
//   handoff    mach port right       DuplicateHandle      SCM_RIGHTS
//
// WHY A UNIX SOCKET AND NOT A PIPE
//
// A dmabuf is a file descriptor, and the only way to move an FD between
// processes is SCM_RIGHTS ancillary data on a unix domain socket. That single
// requirement picks the transport: everything else here would work over a
// FIFO. The FDs we receive are already ours (the kernel installs them in our
// table during recvmsg), so there is no equivalent of the Windows PID
// handshake and no equivalent of the macOS launchd rule.
//
// MULTI-PLANE
//
// Electron's NativePixmap takes an array of planes, each with its own FD,
// stride, offset and size, plus one DRM format modifier for the whole image.
// A BGRA8 image from Unreal is single-plane, but the protocol carries up to
// kMaxPlanes so an NV12 publisher needs no wire change - only a different
// modifier and plane count.
//
// LIFETIME
//
// Each surface's FDs are held for the life of the connection and closed in
// Stop(). Chromium dups what it needs at import time, so closing ours later
// cannot pull a buffer out from under a frame still being sampled.
//
// Threading: one reader thread owns the socket; frames reach JS through a napi
// threadsafe function with queue depth 2, nonblocking - if JS is behind,
// dropping beats queueing stale frames (same choice as the other two addons).

#include <node_api.h>

#include <errno.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace {

constexpr uint32_t kMagic = 0x554E4331;  // 'UNC1'
constexpr uint32_t kProtocolVersion = 1;

constexpr uint32_t kKindSurface = 1;  // carries dmabuf FDs: first sight of id
constexpr uint32_t kKindFrame = 2;    // id + serial only, the steady state

constexpr int kMaxPlanes = 4;

#pragma pack(push, 1)
struct Hello {
  uint32_t magic;
  uint32_t version;
  uint32_t pid;
  uint32_t reserved;
};

struct PlaneWire {
  uint32_t stride;
  uint32_t offset;
  uint64_t size;
};

struct FrameMsg {
  uint32_t magic;
  uint32_t version;
  uint32_t kind;
  uint32_t surfaceId;
  uint32_t width;
  uint32_t height;
  uint32_t planeCount;          // 0 for a ping
  uint32_t reserved;
  uint64_t modifier;            // DRM format modifier
  uint64_t serial;
  PlaneWire planes[kMaxPlanes];
};
#pragma pack(pop)

struct Plane {
  int fd = -1;
  uint32_t stride = 0;
  uint32_t offset = 0;
  uint64_t size = 0;
};

struct Surface {
  std::vector<Plane> planes;
  uint64_t modifier = 0;
};

// What crosses to the JS thread.
struct FrameOut {
  bool carriesSurface = false;
  std::vector<Plane> planes;
  uint64_t modifier = 0;
  uint32_t sid = 0;
  uint64_t serial = 0;
  uint32_t width = 0;
  uint32_t height = 0;
};

struct State {
  std::thread worker;
  std::atomic<bool> running{false};
  std::atomic<bool> connected{false};

  std::atomic<uint64_t> frames{0};
  std::atomic<uint64_t> gaps{0};
  std::atomic<uint64_t> lastSerial{0};

  std::mutex fpsMu;
  std::chrono::steady_clock::time_point fpsWindowStart;
  uint64_t fpsWindowFrames = 0;
  double fps = 0.0;

  std::mutex surfacesMu;
  std::unordered_map<uint32_t, Surface> surfaces;

  napi_threadsafe_function tsfn = nullptr;
  std::string sockPath;
  std::atomic<int> sock{-1};
};

State g;

void NoteFrame(uint64_t serial) {
  const uint64_t prev = g.lastSerial.exchange(serial);
  if (prev != 0 && serial > prev + 1) g.gaps.fetch_add(serial - prev - 1);
  g.frames.fetch_add(1);

  std::lock_guard<std::mutex> lk(g.fpsMu);
  const auto now = std::chrono::steady_clock::now();
  if (g.fpsWindowStart.time_since_epoch().count() == 0) g.fpsWindowStart = now;
  g.fpsWindowFrames += 1;
  const double elapsed =
      std::chrono::duration<double>(now - g.fpsWindowStart).count();
  if (elapsed >= 1.0) {
    g.fps = (double)g.fpsWindowFrames / elapsed;
    g.fpsWindowFrames = 0;
    g.fpsWindowStart = now;
  }
}

// ---------------------------------------------------------------------------
// JS marshalling
// ---------------------------------------------------------------------------

void CallJs(napi_env env, napi_value jsCb, void* /*ctx*/, void* data) {
  FrameOut* m = static_cast<FrameOut*>(data);
  if (env != nullptr && jsCb != nullptr) {
    napi_value obj, v, undefined;
    napi_get_undefined(env, &undefined);
    napi_create_object(env, &obj);

    if (m->carriesSurface && !m->planes.empty()) {
      napi_value pixmap, arr;
      napi_create_object(env, &pixmap);
      napi_create_array_with_length(env, m->planes.size(), &arr);
      for (size_t i = 0; i < m->planes.size(); ++i) {
        napi_value pl, pv;
        napi_create_object(env, &pl);
        napi_create_int32(env, m->planes[i].fd, &pv);
        napi_set_named_property(env, pl, "fd", pv);
        napi_create_uint32(env, m->planes[i].stride, &pv);
        napi_set_named_property(env, pl, "stride", pv);
        napi_create_uint32(env, m->planes[i].offset, &pv);
        napi_set_named_property(env, pl, "offset", pv);
        napi_create_double(env, (double)m->planes[i].size, &pv);
        napi_set_named_property(env, pl, "size", pv);
        napi_set_element(env, arr, i, pl);
      }
      napi_set_named_property(env, pixmap, "planes", arr);

      // Electron types `modifier` as a string: a DRM modifier is 64-bit and
      // would lose its top bits through a JS number.
      char mod[32];
      snprintf(mod, sizeof(mod), "%llu", (unsigned long long)m->modifier);
      napi_create_string_utf8(env, mod, NAPI_AUTO_LENGTH, &v);
      napi_set_named_property(env, pixmap, "modifier", v);

      napi_get_boolean(env, true, &v);
      napi_set_named_property(env, pixmap, "supportsZeroCopyWebGpuImport", v);

      napi_set_named_property(env, obj, "nativePixmap", pixmap);
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

// Reads exactly one FrameMsg, collecting any SCM_RIGHTS FDs that ride with it.
// The publisher must send the whole struct in ONE sendmsg: ancillary data is
// attached to a datagram boundary, so a split write would strand the FDs on a
// fragment. Returns false on EOF/error.
bool ReadMessage(int fd, FrameMsg* out, std::vector<int>* fds) {
  struct iovec iov;
  iov.iov_base = out;
  iov.iov_len = sizeof(*out);

  char cbuf[CMSG_SPACE(sizeof(int) * kMaxPlanes)];
  memset(cbuf, 0, sizeof(cbuf));

  struct msghdr msg;
  memset(&msg, 0, sizeof(msg));
  msg.msg_iov = &iov;
  msg.msg_iovlen = 1;
  msg.msg_control = cbuf;
  msg.msg_controllen = sizeof(cbuf);

  ssize_t n;
  do {
    n = recvmsg(fd, &msg, 0);
  } while (n < 0 && errno == EINTR);
  if (n <= 0) return false;

  for (struct cmsghdr* c = CMSG_FIRSTHDR(&msg); c != nullptr;
       c = CMSG_NXTHDR(&msg, c)) {
    if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
      const int count =
          (int)((c->cmsg_len - CMSG_LEN(0)) / sizeof(int));
      const int* p = reinterpret_cast<const int*>(CMSG_DATA(c));
      for (int i = 0; i < count; ++i) fds->push_back(p[i]);
    }
  }

  // A short read cannot be resynchronised (the FDs are already installed), so
  // treat it as a protocol break and let the reconnect loop start clean.
  if ((size_t)n != sizeof(*out)) {
    for (int f : *fds) close(f);
    fds->clear();
    return false;
  }
  return true;
}

void CloseSurface(Surface& s) {
  for (auto& p : s.planes) {
    if (p.fd >= 0) close(p.fd);
  }
  s.planes.clear();
}

void WorkerMain() {
  while (g.running.load(std::memory_order_acquire)) {
    int fd = socket(AF_UNIX, SOCK_SEQPACKET, 0);
    if (fd < 0) {
      // SOCK_SEQPACKET preserves message boundaries, which SCM_RIGHTS needs.
      // Fall back to SOCK_STREAM only if the kernel refuses it outright.
      fd = socket(AF_UNIX, SOCK_STREAM, 0);
    }
    if (fd < 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      continue;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, g.sockPath.c_str(), sizeof(addr.sun_path) - 1);

    if (connect(fd, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
      // Normal before Unreal is up.
      close(fd);
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      continue;
    }
    g.sock.store(fd, std::memory_order_release);

    Hello hello{kMagic, kProtocolVersion, (uint32_t)getpid(), 0};
    if (send(fd, &hello, sizeof(hello), MSG_NOSIGNAL) != (ssize_t)sizeof(hello)) {
      g.sock.store(-1, std::memory_order_release);
      close(fd);
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      continue;
    }

    g.connected.store(true, std::memory_order_release);

    while (g.running.load(std::memory_order_acquire)) {
      FrameMsg msg{};
      std::vector<int> fds;
      if (!ReadMessage(fd, &msg, &fds)) break;

      if (msg.magic != kMagic || msg.version != kProtocolVersion) {
        for (int f : fds) close(f);
        continue;
      }

      bool carries = false;
      std::vector<Plane> planesForJs;
      uint64_t modifierForJs = 0;

      if (msg.kind == kKindSurface && msg.planeCount > 0) {
        const uint32_t count =
            msg.planeCount > kMaxPlanes ? kMaxPlanes : msg.planeCount;
        if (fds.size() < count) {
          // Metadata and FDs disagreed: drop rather than hand Chromium a
          // half-built pixmap.
          for (int f : fds) close(f);
          continue;
        }
        Surface s;
        s.modifier = msg.modifier;
        for (uint32_t i = 0; i < count; ++i) {
          Plane p;
          p.fd = fds[i];
          p.stride = msg.planes[i].stride;
          p.offset = msg.planes[i].offset;
          p.size = msg.planes[i].size;
          s.planes.push_back(p);
        }
        for (size_t i = count; i < fds.size(); ++i) close(fds[i]);

        {
          std::lock_guard<std::mutex> lk(g.surfacesMu);
          auto it = g.surfaces.find(msg.surfaceId);
          if (it != g.surfaces.end()) {
            // Pool rebuild reusing an id: close the old FDs or they leak.
            CloseSurface(it->second);
            it->second = s;
          } else {
            g.surfaces.emplace(msg.surfaceId, s);
          }
        }
        carries = true;
        planesForJs = s.planes;
        modifierForJs = s.modifier;
      } else if (msg.kind != kKindFrame) {
        for (int f : fds) close(f);
        continue;
      } else {
        for (int f : fds) close(f);
      }

      NoteFrame(msg.serial);

      if (g.tsfn) {
        auto* out = new FrameOut();
        out->carriesSurface = carries;
        out->planes = planesForJs;
        out->modifier = modifierForJs;
        out->sid = msg.surfaceId;
        out->serial = msg.serial;
        out->width = msg.width;
        out->height = msg.height;
        if (napi_call_threadsafe_function(g.tsfn, out, napi_tsfn_nonblocking) !=
            napi_ok) {
          delete out;
        }
      }
    }

    g.connected.store(false, std::memory_order_release);
    g.sock.store(-1, std::memory_order_release);
    close(fd);
    if (g.running.load(std::memory_order_acquire)) {
      std::this_thread::sleep_for(std::chrono::milliseconds(300));
    }
  }
}

// ---------------------------------------------------------------------------
// N-API entry points
// ---------------------------------------------------------------------------

// mode 1 is the macOS CAMetalLayer path; no Linux equivalent.
napi_value Start(napi_env env, napi_callback_info /*info*/) {
  napi_value out;
  napi_get_boolean(env, false, &out);
  return out;
}

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
  std::string path(len, '\0');
  napi_get_value_string_utf8(env, argv[0], path.data(), len + 1, &len);
  g.sockPath = path;

  napi_value resName;
  napi_create_string_utf8(env, "unclaw_surface_frames", NAPI_AUTO_LENGTH,
                          &resName);
  if (napi_create_threadsafe_function(env, argv[1], nullptr, resName, 2, 1,
                                      nullptr, nullptr, nullptr, CallJs,
                                      &g.tsfn) != napi_ok) {
    napi_get_boolean(env, false, &out);
    return out;
  }
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

  g.running.store(true, std::memory_order_release);
  g.worker = std::thread(WorkerMain);

  napi_get_boolean(env, true, &out);
  return out;
}

napi_value Stop(napi_env env, napi_callback_info /*info*/) {
  g.running.store(false, std::memory_order_release);
  // Shut the socket down so a blocking recvmsg returns instead of waiting for
  // the publisher's next frame.
  const int s = g.sock.load(std::memory_order_acquire);
  if (s >= 0) shutdown(s, SHUT_RDWR);
  if (g.worker.joinable()) g.worker.join();

  {
    std::lock_guard<std::mutex> lk(g.surfacesMu);
    for (auto& kv : g.surfaces) CloseSurface(kv.second);
    g.surfaces.clear();
  }
  if (g.tsfn) {
    napi_release_threadsafe_function(g.tsfn, napi_tsfn_release);
    g.tsfn = nullptr;
  }
  g.connected.store(false, std::memory_order_release);

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
    std::lock_guard<std::mutex> lk(g.surfacesMu);
    surfaces = g.surfaces.size();
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
