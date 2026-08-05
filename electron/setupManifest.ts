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
  /** Date-tag version (e.g. '2026.0607.03'). Optional on RemoteAsset in
   *  general, but set on the unreal + runtimeAssets bundles so the setup
   *  coordinator can SEED the updater's .installed-versions.json ledger
   *  with what it just provisioned. Without this seed the first post-setup
   *  updater pass sees an empty ledger and redundantly re-downloads the
   *  multi-GB UE + assets the wizard already fetched. Must match the
   *  corresponding category version in the remote latest.json. */
  version?: string;
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

  /** Windows variants of the two base bundles — a separate UE target (Win64
   *  Shipping, not a .app) and a CUDA/ONNX-flavored asset tree. Selected by
   *  unrealAsset() / runtimeAssetsAsset() on win32; Mac/Linux ignore them. */
  unrealWindows: RemoteAsset;
  runtimeAssetsWindows: RemoteAsset;

  /** Linux variants. Optional because they are not published yet — the
   *  selectors in unrealAsset() / runtimeAssetsAsset() throw a clear error on
   *  Linux until these exist, which is deliberately louder than silently
   *  handing Linux the macOS `.app` + Core ML bundles. Populate them the same
   *  way as the Windows pair once a Linux UE build is cooked. */
  unrealLinux?: RemoteAsset;
  runtimeAssetsLinux?: RemoteAsset;

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

/** The verifiable bytes of one character pak on one platform. Mac and Windows
 *  paks are cooked separately (different UE target) so each has its own hash. */
export interface CharacterPakPlatformAsset {
  sha256: string;
  sizeBytes: number;
}

export interface CharacterPakAsset {
  characterId: string;
  version: string;
  /** Doc-only reference; the live presigned download URL comes from the store
   *  Worker (entitlement-gated). The Worker serves the platform-matched key
   *  characters/<id>/<platform>/current.zip. */
  url: string;
  /** Per-platform pak bytes. The client picks by process.platform and
   *  SHA-verifies the download against the matching entry. `linux` is optional
   *  until Linux paks are cooked; characterPakForPlatform() throws a clear
   *  error there rather than verifying Linux bytes against a Mac hash. */
  mac: CharacterPakPlatformAsset;
  windows: CharacterPakPlatformAsset;
  linux?: CharacterPakPlatformAsset;
}

/** The three platforms we publish artifacts for. Kept explicit (rather than
 *  a win32/else split) so a new platform can never silently inherit another
 *  platform's binaries — a Linux build downloading the Mac UE `.app` would
 *  "succeed" at every step and then fail to launch with no useful error. */
export type ArtifactPlatform = 'windows' | 'mac' | 'linux';

export function artifactPlatform(): ArtifactPlatform {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

/** Pick the pak bytes for the running platform. */
export function characterPakForPlatform(
  entry: CharacterPakAsset,
): CharacterPakPlatformAsset {
  const p = artifactPlatform();
  if (p === 'windows') return entry.windows;
  if (p === 'mac') return entry.mac;
  if (!entry.linux) {
    throw new Error(
      `character pak '${entry.characterId}' has no linux build published yet`);
  }
  return entry.linux;
}

/** Query-string platform token the client appends to the store Worker's
 *  /download endpoint so it presigns the matching platform key. */
export function storePlatformParam(): ArtifactPlatform {
  return artifactPlatform();
}

/** The UE bundle for the running platform. */
export function unrealAsset(): RemoteAsset {
  const p = artifactPlatform();
  if (p === 'windows') return MANIFEST.unrealWindows;
  if (p === 'mac') return MANIFEST.unreal;
  if (!MANIFEST.unrealLinux) {
    throw new Error('no Linux UE bundle published yet (MANIFEST.unrealLinux)');
  }
  return MANIFEST.unrealLinux;
}

/** The runtime-assets bundle for the running platform. */
export function runtimeAssetsAsset(): RemoteAsset {
  const p = artifactPlatform();
  if (p === 'windows') return MANIFEST.runtimeAssetsWindows;
  if (p === 'mac') return MANIFEST.runtimeAssets;
  if (!MANIFEST.runtimeAssetsLinux) {
    throw new Error(
      'no Linux runtime-assets bundle published yet (MANIFEST.runtimeAssetsLinux)');
  }
  return MANIFEST.runtimeAssetsLinux;
}

export const MANIFEST: SetupManifest = {
  releaseTag: '2026.0720.01-mac',
  pythonVersion: '3.11',
  minFreeDiskBytes: 15 * 1024 * 1024 * 1024, // 15 GB

  unreal: {
    // 2026.0720.09 Mac build (UE 5.8). Multi-character customization: Grace
    // collapsed to grace_custom + kevin_custom (custom builds), legacy
    // mark/ava/goblin/chris/joi; heavier grain, effect cleanup, per-region
    // customization camera, wardrobe default indices. Ships the base chunks
    // chunk0 (base + grace_custom/kevin_custom + shared wardrobe) + chunk5
    // (Mark, MALE base body) + chunk6 (Syd, FEMALE base body) so both custom
    // characters spawn with a body. Paid chunks (ava/goblin/chris/joi =
    // chunk1-4) are carved OUT (download on purchase from the private store
    // bucket). Chunks produced by the manual UnrealPak split workaround for
    // the UE 5.8 Mac chunked-pak staging bug (see Mac - UE 5.8 Chunked Pak
    // Bug and Manual Split).
    //
    // Carve-out applied: rename .app + inner binary to "Unclaw Character",
    // CFBundleName/DisplayName/IconFile set, LSUIElement true (hides Dock
    // entry), custom AppIcon.icns, Assets.car deleted, ad-hoc re-signed
    // WITHOUT --options runtime (libtbb team-ID mismatch crash-loops if
    // hardened runtime is on, see Mac - Known Issues and Gotchas).
    url: 'https://files.fotonlabs.com/mac/unreal/unreal-2026.0720.09-mac.zip',
    sha256: 'c807b1d3230e3b000855557a788c3bf87b369aa90395953adb37ba9c3f1d5ee7',
    sizeBytes: 3_254_313_571,
    // Seeds the updater ledger so a fresh install doesn't re-download this
    // ~3 GB bundle. MUST equal the `unreal` version in remote latest.json.
    version: '2026.0720.09',
  },

  runtimeAssets: {
    url: 'https://files.fotonlabs.com/mac/assets/runtime-2026.0523.01-mac.zip',
    sha256: 'c143b8feadd8d15bc603dbffcbc6812f43b63e7ab26239c12f6d1a9b26bb8524',
    sizeBytes: 1_204_449_785,
    // Seeds the updater ledger (see unreal above). MUST equal the `assets`
    // version in remote latest.json.
    version: '2026.0523.01',
  },

  // --- WINDOWS base bundles ---------------------------------------------
  // unrealWindows: the 2026.0612.01 Win64 Shipping build (stock PixelStreaming2
  // / NVENC). Carved like Mac — paid paks (goblin/joi) + Saved/ excluded; ships
  // pakchunk0 (base+grace) + pakchunk5 (mark) only. Zip root holds
  // AudioTestProject02.exe (extracts flat to <runtime>/unreal/). Includes the
  // bShareMaterialShaderCode=False shader fix (grey-eyes resolved).
  unrealWindows: {
    url: 'https://files.fotonlabs.com/unreal/2026.0612.01.zip',
    sha256: '48c028cced8c3f825c7c0865dc008ea0689702cf8436c61922d0055a401cabae',
    sizeBytes: 2_523_558_279,
    version: '2026.0612.01',
  },

  // runtimeAssetsWindows: the lipsync/T2F/express ONNX model + source tree the
  // Windows soul expects, extracted to <runtime>/assets/ so run_soul.ps1's
  // $Repo/Audio2Lipsync/python/src, $Repo/ExpressModelv8/checkpoints/... etc.
  // resolve. Freshly built 2026-06-13 to match the CURRENT run_soul.ps1 layout
  // (the old May bundle used a different _runtime/{lipsync,express} layout).
  // Carved: only the 2 ONNX checkpoints run_soul references (v6_wavlm + v6mini)
  // out of the 5 GB checkpoints_onnx dir, plus t2f_fp16.onnx + best_v4.pt +
  // stats + the lipsync/express .py source. Mac-only .mlpackage excluded.
  runtimeAssetsWindows: {
    url: 'https://files.fotonlabs.com/assets/runtime-2026.0613.01-win.zip',
    sha256: 'c8befe532e7d61396a2b33d08b38d4f5089f4d5560c135bdae36a2aba6ab624a',
    sizeBytes: 729_968_549,
    version: '2026.0613.01',
  },

  // Paid character paks. Cooked from AudioTestProject02 build 2026.0607.03 as
  // per-character chunks (chunk1=ava .. chunk4=joi), each zipped (<id>.pak
  // inside) and uploaded to the PRIVATE R2 bucket unclaw-paks-private at
  // characters/<id>/current.zip. `url` is documentation only, the real,
  // short-lived presigned download URL is handed back by the store Worker after
  // it verifies the account's entitlement; sha256 + sizeBytes here verify the
  // exact bytes (same discipline as the base bundles). grace + mark are free and
  // ship in the base app (chunk0/chunk5), so they have no entry here.
  // mac hashes: Mac build 2026.0720.09 (chunk1=ava..chunk4=joi, from the
  // manual UnrealPak split of the monolithic Mac cook — see Mac - UE 5.8
  // Chunked Pak Bug and Manual Split). MUST match the base app's UE build.
  // windows hashes: Windows build 2026.0611.01 (pakchunk1-4-Windows.pak), each
  // re-zipped store-0 as <id>.pak → uploaded to characters/<id>/windows/current.zip.
  characterPaks: {
    ava: {
      characterId: 'ava',
      version: '2026.0720.09',
      url: 'https://store.unclaw.io/store/characters/ava/download',
      mac: {
        sha256: '70cedb0d1c83607c92b821c904497d50add4490f7d0f51a83a99bb2bbe1d58b5',
        sizeBytes: 155_299_587,
      },
      windows: {
        sha256: '77fbfdb846dff62dd9a1be8c6de44f5a1740fe1941e6a640bfcd6da78f638e33',
        sizeBytes: 177_344_968,
      },
    },
    goblin: {
      characterId: 'goblin',
      version: '2026.0720.09',
      url: 'https://store.unclaw.io/store/characters/goblin/download',
      mac: {
        sha256: 'd1f621e9e6ea689a9cb6f5e7db654616d930f47a45f794b0a4a5ea34d6c3a37e',
        sizeBytes: 114_602_929,
      },
      windows: {
        sha256: '1676aa23eb3408a74032c892ac86926c67de92c90d8e49989a4a051ea3b0d868',
        sizeBytes: 87_279_140,
      },
    },
    chris: {
      characterId: 'chris',
      version: '2026.0720.09',
      url: 'https://store.unclaw.io/store/characters/chris/download',
      mac: {
        sha256: '6f7807dc863f1547fa960b80a1c7ec5a7325c748ad639cf7a6b66942144bb23a',
        sizeBytes: 152_690_993,
      },
      windows: {
        sha256: '011078b17d5a345e6ddc4eb220b0a3da7524702b2c3d01563507c02f1ee8e0df',
        sizeBytes: 129_136_215,
      },
    },
    joi: {
      characterId: 'joi',
      version: '2026.0720.09',
      url: 'https://store.unclaw.io/store/characters/joi/download',
      mac: {
        sha256: '028e3c691d81762abf8110847a09cb1f33c3edfd58b75b5caf9dc93b3a284f4c',
        sizeBytes: 163_035_405,
      },
      windows: {
        sha256: '10af1338b4543205dad983384d7e007a26020ede0925d0dd610d003b2d90fb50',
        sizeBytes: 135_684_090,
      },
    },
  },
};
