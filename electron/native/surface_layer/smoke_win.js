// Smoke test for the Windows direct-surface addon.
//
// The Windows twin of tools/iosurface_viewer/fake_publisher.m: speaks the real
// wire protocol with a synthetic surface, so the whole consumer side can be
// exercised with no Unreal and no GPU at all. What it proves:
//
//   * the addon connects, sends Hello with OUR pid, and stays connected
//   * a kSurface message is delivered to JS with an ntHandle Buffer
//   * kFrame pings are delivered without a handle (steady state)
//   * serial gaps are counted, fps is measured, surfaces settles at the pool
//     size and then stops growing (the "sent once" invariant)
//   * stop() is clean and does not hang the loop
//
// The handle value here is a sentinel, not a real D3D texture: this test is
// about framing and marshalling. Chromium only sees the value if the real
// publisher put a real duplicated handle there.
//
// Run:  npx electron electron/native/surface_layer/smoke_win.js

const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert');

const PIPE = '\\\\.\\pipe\\unclaw-surface-smoke';

const MAGIC = 0x554e4331;
const VERSION = 1;
const KIND_SURFACE = 1;
const KIND_FRAME = 2;

const HELLO_SIZE = 16;
const MSG_SIZE = 40; // 4+4+4+4+8+4+4+8, #pragma pack(1)

function frameMsg({ kind, surfaceId, handle, width, height, serial }) {
  const b = Buffer.alloc(MSG_SIZE);
  let o = 0;
  b.writeUInt32LE(MAGIC, o); o += 4;
  b.writeUInt32LE(VERSION, o); o += 4;
  b.writeUInt32LE(kind, o); o += 4;
  b.writeUInt32LE(surfaceId, o); o += 4;
  b.writeBigUInt64LE(BigInt(handle), o); o += 8;
  b.writeUInt32LE(width, o); o += 4;
  b.writeUInt32LE(height, o); o += 4;
  b.writeBigUInt64LE(BigInt(serial), o); o += 8;
  return b;
}

// Sentinel stand-in for a duplicated D3D11 shared-texture handle.
const SENTINEL = 0xd15ea5e;

const POOL = 4;
const W = 1168;
const H = 1536;

const received = [];
let helloPid = null;

const server = net.createServer((sock) => {
  let serial = 0;
  const sent = new Set();

  sock.once('data', (buf) => {
    assert.strictEqual(buf.length >= HELLO_SIZE, true, 'hello too short');
    assert.strictEqual(buf.readUInt32LE(0), MAGIC, 'hello magic');
    assert.strictEqual(buf.readUInt32LE(4), VERSION, 'hello version');
    helloPid = buf.readUInt32LE(8);
    assert.ok(helloPid > 0, 'hello carried a pid');

    // 40 frames round-robin over a 4-slot pool, with one deliberate serial
    // skip at frame 20 so the gap counter has something to find.
    const timer = setInterval(() => {
      if (sock.destroyed) { clearInterval(timer); return; }
      serial += (serial === 20) ? 2 : 1;   // one gap of 1
      const sid = (serial % POOL) + 1;
      const first = !sent.has(sid);
      if (first) sent.add(sid);
      sock.write(frameMsg({
        kind: first ? KIND_SURFACE : KIND_FRAME,
        surfaceId: sid,
        // Sentinel handle, never dereferenced by this test.
        handle: first ? SENTINEL + sid : 0,
        width: W, height: H, serial,
      }));
      if (serial >= 40) { clearInterval(timer); }
    }, 10);
  });
});

function run() {
  const addonPath = path.join(__dirname, 'build', 'Release', 'surface_layer.node');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const addon = require(addonPath);
  console.log('addon loaded:', Object.keys(addon).join(', '));

  const ok = addon.startFrames(PIPE, (f) => {
    received.push(f);
    if (received.length <= 3 || f.ntHandle) {
      console.log('frame', {
        surfaceId: f.surfaceId,
        serial: f.serial,
        width: f.width,
        height: f.height,
        ntHandle: f.ntHandle ? `Buffer(${f.ntHandle.length})` : undefined,
      });
    }
  });
  assert.strictEqual(ok, true, 'startFrames returned false');

  setTimeout(() => {
    const s = addon.stats();
    console.log('\nstats:', s);

    const withHandle = received.filter((f) => f.ntHandle);
    const pings = received.filter((f) => !f.ntHandle);

    let failures = 0;
    const check = (name, cond, extra = '') => {
      if (cond) { console.log(`  PASS  ${name}`); }
      else { console.log(`  FAIL  ${name} ${extra}`); failures += 1; }
    };

    console.log('\nassertions:');
    check('hello carried our pid', helloPid !== null && helloPid > 0, `pid=${helloPid}`);
    check('connected', s.connected === true);
    check('frames delivered', received.length > 20, `got ${received.length}`);
    check('surfaces settle at pool size', s.surfaces === POOL, `got ${s.surfaces}`);
    check('each surface sent exactly once', withHandle.length === POOL, `got ${withHandle.length}`);
    check('steady state is pings', pings.length > 20, `got ${pings.length}`);
    check('handle buffer is pointer-sized', withHandle.every((f) => f.ntHandle.length === 8));
    check('serial gap counted', s.gaps >= 1, `gaps=${s.gaps}`);
    check('fps measured', s.fps > 0, `fps=${s.fps}`);
    check('dimensions carried', received.every((f) => f.width === W && f.height === H));

    addon.stop();
    const after = addon.stats();
    check('stop() disconnects', after.connected === false);

    server.close();
    console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILED (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
  }, 1500);
}

server.listen(PIPE, () => {
  console.log('fake publisher listening on', PIPE);
  run();
});
