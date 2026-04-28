// AudioWorklet that consumes mic audio at the AudioContext's sample rate
// (we ask for 16 kHz at context creation, so this is one-to-one) and posts
// fixed-size mono frames of `frameSize` samples to the main thread.
//
// Why a worklet instead of a ScriptProcessorNode:
//   - real-time priority audio thread, no main-thread jank during VAD/UI work
//   - reliable 128-sample render quantum, lossless framing
//   - portable across modern browsers
//
// Silero v5 expects 512 samples per frame at 16 kHz (= 32 ms). We choose
// `frameSize = 512` to match. Frames are sent over MessagePort as
// transferable Float32Array buffers so there's no copy.

const FRAME_SIZE = 512;

class CaptureWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(FRAME_SIZE);
    this._fill = 0;
    this._frameId = 0;
    this._port = this.port;
  }

  process(inputs, outputs) {
    // Always silence the output. We only declare an output channel so the
    // audio graph has a path to destination and the runtime keeps calling
    // us. Without this, Chromium/Electron may garbage-collect or skip
    // process() entirely when numberOfOutputs is 0 and the node has no
    // destination — which manifests as "mic granted but no frames flow."
    const outCh = outputs[0]?.[0];
    if (outCh) outCh.fill(0);

    const input = inputs[0];
    // No mic data this quantum (e.g. before stream is connected). Stay alive.
    if (!input || input.length === 0 || !input[0]) return true;

    // Mono channel. If the mic is stereo, the AudioContext is already set
    // to channelCount=1 so we expect [0] to be the only channel.
    const ch = input[0];
    let i = 0;
    while (i < ch.length) {
      const room = FRAME_SIZE - this._fill;
      const take = Math.min(room, ch.length - i);
      // Subarray + set is faster than per-sample copy.
      this._buffer.set(ch.subarray(i, i + take), this._fill);
      this._fill += take;
      i += take;

      if (this._fill === FRAME_SIZE) {
        // Allocate a fresh buffer per frame and transfer it. Reusing one
        // shared buffer would race with main thread reads.
        const out = new Float32Array(FRAME_SIZE);
        out.set(this._buffer);
        this._port.postMessage(
          { kind: 'frame', id: this._frameId++, samples: out },
          [out.buffer],
        );
        this._fill = 0;
      }
    }

    return true;
  }
}

registerProcessor('voice-capture-worklet', CaptureWorklet);
