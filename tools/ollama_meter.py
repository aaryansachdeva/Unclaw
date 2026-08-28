#!/usr/bin/env python3
"""
ollama_meter.py , a transparent metering proxy for Ollama.

Sits between soul and the Ollama daemon. Forwards every request untouched and
prints per-request timing: time to first byte, generation tok/s, prompt tok/s
and token counts. Streaming responses are passed through chunk by chunk as they
arrive, so soul's TTS chunking latency is unaffected.

Usage:
    python3 tools/ollama_meter.py                    # listen :11435 -> :11434
    python3 tools/ollama_meter.py --port 11435 --upstream 127.0.0.1:11434
    python3 tools/ollama_meter.py --quiet-polls      # hide /api/tags heartbeats

Then point soul at it instead of the daemon:
    OLLAMA_BASE_URL=http://127.0.0.1:11435

Ctrl-C prints a session summary. Stdlib only, no dependencies.
"""

import argparse
import http.client
import json
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Paths worth metering. Everything else is forwarded silently.
METERED = ("/api/chat", "/api/generate", "/v1/chat/completions", "/v1/completions")
HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "te", "trailer",
              "proxy-authorization", "proxy-authenticate", "upgrade", "content-length"}

C = {"dim": "\033[2m", "b": "\033[1m", "g": "\033[32m", "y": "\033[33m",
     "c": "\033[36m", "r": "\033[31m", "0": "\033[0m"}

STATS = []          # one dict per metered request
START = time.time()


def read_some(resp, n):
    """Read whatever is available without waiting for a full buffer.

    read1 keeps streaming responses flowing token by token. Older
    HTTPResponse objects lack it, so fall back to a blocking read.
    """
    reader = getattr(resp, "read1", None)
    return reader(n) if reader else resp.read(n)


def fmt_ms(seconds):
    if seconds is None:
        return "  n/a "
    ms = seconds * 1000.0
    return f"{ms:7.0f}ms" if ms >= 1000 else f"{ms:7.1f}ms"


def extract_metrics(tail: bytes):
    """Pull Ollama's timing fields out of the last complete JSON object.

    Native /api/chat streams NDJSON and puts the numbers on the final
    object (done=true). Non-streaming puts them on the only object.
    """
    text = tail.decode("utf-8", "replace")
    for line in reversed([l for l in text.splitlines() if l.strip()]):
        s = line.strip()
        if s.startswith("data: "):          # OpenAI-compat SSE
            s = s[6:].strip()
        if s == "[DONE]" or not s.startswith("{"):
            continue
        try:
            obj = json.loads(s)
        except ValueError:
            continue
        if "eval_count" in obj or "usage" in obj:
            return obj
    return None


def report(path, model, ttfb, wall, obj, quiet_polls):
    if obj is None:
        print(f"{C['dim']}{path} {fmt_ms(wall)}  (no metrics in response){C['0']}")
        return

    ec = obj.get("eval_count")
    ed = obj.get("eval_duration")
    pc = obj.get("prompt_eval_count")
    pd = obj.get("prompt_eval_duration")
    load = obj.get("load_duration")

    # OpenAI-compat shape carries counts but no durations.
    if ec is None and isinstance(obj.get("usage"), dict):
        u = obj["usage"]
        pc = u.get("prompt_tokens")
        ec = u.get("completion_tokens")

    gen_tps = (ec / (ed / 1e9)) if (ec and ed) else None
    pp_tps = (pc / (pd / 1e9)) if (pc and pd) else None

    tps_txt = f"{C['b']}{C['g']}{gen_tps:6.1f} tok/s{C['0']}" if gen_tps else f"{C['dim']}   n/a tok/s{C['0']}"
    pp_txt = f"{pp_tps:6.1f}" if pp_tps else "   n/a"

    print(
        f"{C['c']}{model or path}{C['0']}  "
        f"{tps_txt}  "
        f"{C['dim']}gen{C['0']} {ec or 0:>5}tok  "
        f"{C['dim']}prompt{C['0']} {pc or 0:>6}tok @ {pp_txt} tok/s  "
        f"{C['dim']}ttfb{C['0']} {fmt_ms(ttfb)}  "
        f"{C['dim']}wall{C['0']} {fmt_ms(wall)}"
        + (f"  {C['y']}load {fmt_ms(load / 1e9)}{C['0']}" if load and load > 5e8 else "")
    )

    STATS.append({"model": model, "gen_tps": gen_tps, "pp_tps": pp_tps,
                  "eval_count": ec or 0, "prompt_count": pc or 0,
                  "ttfb": ttfb, "wall": wall})


def summary(*_):
    print(f"\n{C['b']}session summary{C['0']}  ({len(STATS)} metered requests, "
          f"{time.time() - START:.0f}s elapsed)")
    if not STATS:
        print(f"{C['dim']}  nothing metered yet{C['0']}")
        sys.exit(0)

    gts = [s["gen_tps"] for s in STATS if s["gen_tps"]]
    ttfbs = [s["ttfb"] for s in STATS if s["ttfb"] is not None]
    tot_out = sum(s["eval_count"] for s in STATS)
    tot_in = sum(s["prompt_count"] for s in STATS)

    if gts:
        gts_sorted = sorted(gts)
        med = gts_sorted[len(gts_sorted) // 2]
        print(f"  generation   median {C['b']}{med:.1f}{C['0']} tok/s   "
              f"min {min(gts):.1f}   max {max(gts):.1f}")
    if ttfbs:
        t_sorted = sorted(ttfbs)
        print(f"  time to first byte   median {t_sorted[len(t_sorted) // 2] * 1000:.0f}ms   "
              f"max {max(ttfbs) * 1000:.0f}ms")
    print(f"  tokens       {tot_in} in / {tot_out} out")
    sys.exit(0)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    quiet_polls = False
    upstream = ("127.0.0.1", 11434)

    def log_message(self, *_):
        pass  # we do our own logging

    def _proxy(self):
        path = self.path
        metered = any(path.startswith(p) for p in METERED)

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""

        model = None
        if metered and body:
            try:
                model = json.loads(body).get("model")
            except ValueError:
                pass

        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in HOP_BY_HOP}
        if body:
            headers["Content-Length"] = str(len(body))

        t0 = time.perf_counter()
        conn = http.client.HTTPConnection(*self.upstream, timeout=600)
        try:
            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()

            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in HOP_BY_HOP:
                    self.send_header(k, v)
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            tail = bytearray()
            ttfb = None
            while True:
                chunk = read_some(resp, 65536)
                if not chunk:
                    break
                if ttfb is None:
                    ttfb = time.perf_counter() - t0
                # pass through immediately, never buffer the stream
                self.wfile.write(b"%x\r\n" % len(chunk) + chunk + b"\r\n")
                self.wfile.flush()
                if metered:
                    tail.extend(chunk)
                    if len(tail) > 32768:
                        del tail[:-16384]
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()

            wall = time.perf_counter() - t0
            if metered:
                report(path, model, ttfb, wall, extract_metrics(bytes(tail)),
                       self.quiet_polls)
            elif not self.quiet_polls:
                print(f"{C['dim']}{self.command} {path}  {fmt_ms(wall)}{C['0']}")
        except BrokenPipeError:
            pass  # client hung up mid-stream, normal on cancel
        except Exception as e:
            print(f"{C['r']}proxy error on {path}: {e}{C['0']}")
            try:
                self.send_error(502, str(e))
            except Exception:
                pass
        finally:
            conn.close()

    do_GET = do_POST = do_DELETE = do_PUT = do_HEAD = _proxy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=11435)
    ap.add_argument("--upstream", default="127.0.0.1:11434")
    ap.add_argument("--quiet-polls", action="store_true",
                    help="hide non-inference traffic like /api/tags heartbeats")
    args = ap.parse_args()

    host, _, port = args.upstream.partition(":")
    Handler.upstream = (host, int(port or 11434))
    Handler.quiet_polls = args.quiet_polls

    # Line-buffer stdout so `... | tee` and log redirection show reports live
    # instead of block-buffering them until exit.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except AttributeError:
        pass

    signal.signal(signal.SIGINT, summary)
    signal.signal(signal.SIGTERM, summary)

    print(f"{C['b']}ollama_meter{C['0']} listening on "
          f"{C['c']}http://127.0.0.1:{args.port}{C['0']} -> {args.upstream}")
    print(f"{C['dim']}point soul at it:  OLLAMA_BASE_URL=http://127.0.0.1:{args.port}{C['0']}")
    print(f"{C['dim']}Ctrl-C for a session summary{C['0']}\n")

    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
