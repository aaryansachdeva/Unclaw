// Manifest of artifacts the first-run wizard fetches from Cloudflare R2.
//
// Bumping a release:
//   1. Re-build the artifact (UE shipping, runtime asset bundle, etc.)
//   2. Upload to R2 under a NEW versioned key, never reuse a key, even
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
// declared value, never silently install whatever the CDN served.

export interface RemoteAsset {
  /** Public R2 URL the setup wizard fetches over HTTPS. */
  url: string;
  /** Hex-encoded SHA-256 of the entire file. `null` only in dev, the
   *  coordinator refuses to install a TBD-SHA artifact in packaged builds. */
  sha256: string | null;
  /** Total bytes, surfaces ETA + progress percentage in the UI without
   *  having to read Content-Length first (lets us validate that too). */
  sizeBytes: number;
}

export interface SetupManifest {
  /** Bumped whenever ANY artifact changes. Stored alongside
   *  .setup-complete; mismatch triggers a re-install. */
  releaseTag: string;

  /** uv + python-build-standalone target. uv handles the download
   *  + extraction once it's bootstrapped, we just tell it which
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
   *  directories, everything `run_soul.sh` expects to find under
   *  $REPO/{Audio2Lipsync,ExpressModelv8,LipSyncModelv1,
   *  LipSyncModelv6_small,soul-models}/. Extracted to
   *  runtime/assets/. */
  runtimeAssets: RemoteAsset;

  /** Paid character paks, keyed by stable character id (ava/goblin/chris/joi).
   *  These are NOT downloaded at setup time; they are fetched on demand after
   *  purchase (entitlement checked by the store Worker, which hands back a
   *  short-lived presigned URL to a PRIVATE R2 bucket). The `url` here is only
   *  a fallback / reference; the live download URL comes from the store Worker.
   *  `sha256` + `sizeBytes` are used by the coordinator to verify the bytes
   *  exactly as for the base bundles. `version` is passed to the Worker as ?v=
   *  so a re-published pak invalidates cleanly. */
  characterPaks?: Record<string, CharacterPakAsset>;
}

export interface CharacterPakAsset extends RemoteAsset {
  characterId: string;
  version: string;
}

export const MANIFEST: SetupManifest = {
  releaseTag: '2026.0527.02-mac',
  pythonVersion: '3.11',
  minFreeDiskBytes: 15 * 1024 * 1024 * 1024, // 15 GB

  unreal: {
    // 2026.0527.01 Mac build, ships the LiveLinkFaceStreamComponent
    // cmdline-port override (reads -SoulPort=NNNN at BeginPlay so the
    // dynamic-ports flow reaches UE), plus the PixelStreaming2NativeMac
    // Tier 1 plugin from prior cycle.
    //
    // Carve-out applied: rename .app + inner binary to "Unclaw Character",
    // CFBundleName/DisplayName/IconFile set, LSUIElement true (hides Dock
    // entry), custom AppIcon.icns, Assets.car deleted, ad-hoc re-signed
    // WITHOUT --options runtime (libtbb team-ID mismatch crash-loops if
    // hardened runtime is on, see Mac - Known Issues and Gotchas).
    url: 'https://files.fotonlabs.com/mac/unreal/unreal-2026.0527.01-mac.zip',
    sha256: 'b1fc3c951f4cc5a98ca0cf31ee90904a2c423e143c9535cf4e50088b128ec0b4',
    sizeBytes: 1_902_906_141,
  },

  runtimeAssets: {
    url: 'https://files.fotonlabs.com/mac/assets/runtime-2026.0523.01-mac.zip',
    sha256: 'c143b8feadd8d15bc603dbffcbc6812f43b63e7ab26239c12f6d1a9b26bb8524',
    sizeBytes: 1_204_449_785,
  },

  // Paid character paks. Cooked from AudioTestProject02 build 2026.0604.01 as
  // per-character chunks (chunk1=ava .. chunk4=joi), each zipped (<id>.pak
  // inside) and uploaded to the PRIVATE R2 bucket unclaw-paks-private at
  // characters/<id>/current.zip. `url` is documentation only — the real,
  // short-lived presigned download URL is handed back by the store Worker after
  // it verifies the account's entitlement; sha256 + sizeBytes here verify the
  // exact bytes (same discipline as the base bundles). grace + mark are free and
  // ship in the base app (chunk0/chunk5), so they have no entry here.
  characterPaks: {
    ava: {
      characterId: 'ava',
      version: '2026.0605.01',
      url: 'https://store.unclaw.io/store/characters/ava/download',
      sha256: '695113270e37c364568eec20123b9ba630bd9fbf87c2e8b214be9e8c692994dc',
      sizeBytes: 176_562_508,
    },
    goblin: {
      characterId: 'goblin',
      version: '2026.0605.01',
      url: 'https://store.unclaw.io/store/characters/goblin/download',
      sha256: '6c194de44fb3216347b628ee0962f1355b0cc5393885cf26865ccb90d760bfb3',
      sizeBytes: 88_141_685,
    },
    chris: {
      characterId: 'chris',
      version: '2026.0605.01',
      url: 'https://store.unclaw.io/store/characters/chris/download',
      sha256: '870dc7645d63e1809813b02de0513ce78858e76d114b25d60d77681fffe5c484',
      sizeBytes: 129_965_497,
    },
    joi: {
      characterId: 'joi',
      version: '2026.0605.01',
      url: 'https://store.unclaw.io/store/characters/joi/download',
      sha256: 'd6bb50361f6c051ed454852a37688a8939f9d4eefa38cedc617f49d75e3e5a19',
      sizeBytes: 136_502_842,
    },
  },
};
