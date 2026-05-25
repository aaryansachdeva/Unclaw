// Manifest of artifacts the first-run wizard fetches from Cloudflare R2.
//
// Bumping a release:
//   1. Re-build the artifact (UE shipping, runtime asset bundle, etc.)
//   2. Upload to R2 under a NEW versioned key — never reuse a key, even
//      with the same content. Cloudflare's edge cache treats key-as-URL
//      and a stale 1700-second-cached body can ship a buggy build for a
//      long time after the R2 object updates (we hit this on Windows
//      0.1.0). New versioned key = new edge cache entry, guaranteed
//      fresh.
//   3. Capture the upload's SHA-256 + byte size and update this file.
//   4. Bump UNCLAW_RELEASE_TAG so completed installs from a prior tag
//      will re-run setup for the new artifacts.
//
// The setup coordinator hard-fails if a download SHA doesn't match the
// declared value — never silently install whatever the CDN served.

export interface RemoteAsset {
  /** Public R2 URL the setup wizard fetches over HTTPS. */
  url: string;
  /** Hex-encoded SHA-256 of the entire file. `null` only in dev — the
   *  coordinator refuses to install a TBD-SHA artifact in packaged builds. */
  sha256: string | null;
  /** Total bytes — surfaces ETA + progress percentage in the UI without
   *  having to read Content-Length first (lets us validate that too). */
  sizeBytes: number;
}

export interface SetupManifest {
  /** Bumped whenever ANY artifact changes. Stored alongside
   *  .setup-complete; mismatch triggers a re-install. */
  releaseTag: string;

  /** uv + python-build-standalone target. uv handles the download
   *  + extraction once it's bootstrapped — we just tell it which
   *  CPython to install. 3.11 is what soul targets (matches the
   *  Windows bundle). */
  pythonVersion: string;

  /** Minimum free disk space (bytes) we require before starting,
   *  measured at the userData partition. Sized to cover the worst
   *  case: UE 2.3 GB extracted + 700 MB assets + 3 GB venv + 2 GB
   *  scratch space + 1 GB safety margin. */
  minFreeDiskBytes: number;

  /** Bundle: UE Shipping build (~2.3 GB extracted). The .app inside
   *  must already be re-codesigned with network.client entitlement;
   *  the setup coordinator strips com.apple.quarantine post-extract. */
  unreal: RemoteAsset;

  /** Bundle: lipsync + t2f source + ONNX checkpoints + .mlpackage
   *  directories — everything `run_soul.sh` expects to find under
   *  $REPO/{Audio2Lipsync,ExpressModelv8,LipSyncModelv1,
   *  LipSyncModelv6_small,soul-models}/. Extracted to
   *  runtime/assets/. */
  runtimeAssets: RemoteAsset;
}

export const MANIFEST: SetupManifest = {
  releaseTag: '2026.0525.10-mac-dev',
  pythonVersion: '3.11',
  minFreeDiskBytes: 15 * 1024 * 1024 * 1024, // 15 GB

  unreal: {
    // 2026.0525.09 Dev build — re-spin of 0525.08 with the inner binary rename
    // that 0525.08 missed (carve-out only renamed the .app, not Contents/MacOS/).
    // Soul's unreal_runtime.py expects MacOS/<CFBundleExecutable> to exist; the
    // 0525.08 bundle still had MacOS/AudioTestProject02 and CFBundleExecutable
    // didn't match -> "launch failed: .app missing inner binary" on every spawn.
    //
    // Contents: PixelStreaming2NativeMac plugin (Tier 1) — low-latency H264 with
    // SW-fallback auto-retry (bounded 2 attempts), full input handler
    // (mouse/kbd/touch/UIInteraction), encoder lifecycle crash-proofing.
    //
    // Carve-out (now complete): rename .app, rename inner binary to match
    // CFBundleExecutable, set CFBundleName/DisplayName/IconFile/LSUIElement,
    // replace icon, delete Assets.car, ad-hoc re-sign WITHOUT --options runtime.
    url: 'https://files.fotonlabs.com/mac/unreal/unreal-2026.0525.09-dev-mac.zip',
    sha256: '1bc1f98c04c4d1ea416feb2800b99312f5cd5b9245e44f35ad9801796f6facbd',
    sizeBytes: 1_902_903_676,
  },

  runtimeAssets: {
    url: 'https://files.fotonlabs.com/mac/assets/runtime-2026.0523.01-mac.zip',
    sha256: 'c143b8feadd8d15bc603dbffcbc6812f43b63e7ab26239c12f6d1a9b26bb8524',
    sizeBytes: 1_204_449_785,
  },
};
