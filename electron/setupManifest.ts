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
  // Bumped whenever ANY bundle below changes, so existing installs re-run the
  // wizard for the new artifacts. Shared by all three platforms (each bundle
  // carries its own per-platform version), so no platform suffix here.
  releaseTag: '2026.0912.01',
  pythonVersion: '3.11',
  minFreeDiskBytes: 15 * 1024 * 1024 * 1024, // 15 GB

  unreal: {
    // 2026.0816.01 Mac build (UE 5.8), Shipping config. Carries the IOSurface
    // publisher (the direct zero-copy display path), fixed-step 24 fps via the
    // bundle UserEngine.ini, and the URO revert (animation update-rate
    // optimization was visibly laggy and was turned back off).
    //
    // Lineage: multi-character customization, Grace collapsed to grace_custom
    // + kevin_custom (custom builds), legacy mark/ava/goblin/chris/joi;
    // per-region customization camera, wardrobe default indices. Ships the base chunks
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
    // 2026.0823.02: the 0823 Shipping cook, hand-split back into chunks
    // (the UE 5.8 Mac stage bug still collapses them; split per the vault
    // runbook, verified: paid DAs only in their own chunks, base = 0+5+6).
    // Carries the encoder env knobs the 1.2.0 stream fix depends on
    // (UNCLAW_PS_KEYFRAME_S / UNCLAW_PS_PLAYOUT_MAX_MS): the 0816 binary
    // hard-coded 60-frame keyframes, the periodic hitch shipped users see.
    url: 'https://files.fotonlabs.com/mac/unreal/unreal-2026.0823.02-mac.zip',
    sha256: '7aca032f7b6bcbae34137282fa5f8313091dbfd9481d3eeaf1573c7d17a59387',
    sizeBytes: 3_536_910_059,
    // Seeds the updater ledger so a fresh install doesn't re-download this
    // ~3.5 GB bundle. MUST equal the `unreal` version in remote latest.json.
    version: '2026.0823.02',
  },

  runtimeAssets: {
    // 2026.0805.01: adds soul-models/emotions.json (mood/expression library).
    // It shipped nowhere despite the code path landing 2026-07-06 — the
    // bundle predated it and expression.py fails SILENT when the file is
    // absent, so every packaged install ran mood-less for a month. Lesson:
    // any new data blob soul reads must be added HERE (and to remote
    // latest.json `assets`) the same day its loader lands.
    // 2026.0805.02: t2f RETIRED — ExpressModelv8/ and the t2f_v8 weights are
    // gone (405MB smaller); the captured engine (emotions.json) is the only
    // expression generator and soul's run_text2face wrapper serves it for
    // every caller including /express. Pairs with the soul commit
    // "expression: retire the t2f neural model".
    // 2026.0820.01: adds soul-models/pocket/ — the MLX Pocket-TTS weights
    // (~229 MB, converted from the UNGATED kyutai checkpoint) plus the FREE
    // characters' voice embeddings (grace/kevin/mark, ~1.1 MB each). Paid
    // characters' embeddings are NOT here; they are entitlement-gated next to
    // their paks and installed post-purchase. Verified: with HF_HUB_OFFLINE=1
    // and an empty data dir, soul loads these weights and speaks in Grace's
    // cloned voice, so a packaged install never needs the network to talk.
    url: 'https://files.fotonlabs.com/mac/assets/runtime-2026.0820.01-mac.zip',
    sha256: '5cec1cf3989019a9bec140a00dfe483dd3514d4bd3a118a3a6e60e6ee318b6b2',
    sizeBytes: 997_529_686,
    // Seeds the updater ledger (see unreal above). MUST equal the `assets`
    // version in remote latest.json.
    version: '2026.0820.01',
  },

  // --- WINDOWS base bundles ---------------------------------------------
  // unrealWindows: 2026.0910.02, Win64 Shipping, UE 5.8. FIRST BUILD WITH NO
  // DLSS OF ANY KIND — the DLSS/NIS/Streamline plugins are all disabled in the
  // .uproject, so none of their runtimes are staged. Zip root holds
  // AudioTestProject02.exe (extracts flat to <runtime>/unreal/).
  //
  // Carved: paid chunks 1-4 (ava/goblin/chris/joi) removed. Ships chunk0
  // (base+grace) + chunk5 (Mark, MALE base body) + chunk6 (Syd, FEMALE base
  // body). All three are load-bearing: grace_custom is CustomF and her base
  // mesh exists ONLY in chunk6, kevin_custom is CustomM and needs chunk5. Ship
  // 0 alone, or 0+5, and grace_custom spawns with no body. The previous comment
  // here said "pakchunk0 + pakchunk5 only" — that predates Syd and was wrong.
  unrealWindows: {
    url: 'https://files.fotonlabs.com/unreal/2026.0910.02.zip',
    sha256: 'e4fa42dcf4702d6ab614d949b52e51009d890ba0fb6264f3a987c037d3ae12bd',
    sizeBytes: 3_397_257_380,
    version: '2026.0910.02',
  },

  // runtimeAssetsWindows 2026.0912.01: adds soul-models/pocket/ — the Kyutai
  // Pocket-TTS weights and our seven torch-format voice embeddings, so Pocket
  // (the DEFAULT tts_provider) speaks in each character's own voice offline
  // from first launch instead of pulling ~327 MB from HuggingFace mid-sentence.
  //
  // Only the UNGATED `pocket-tts-without-voice-cloning` repo ships. The gated
  // kyutai/pocket-tts weights were needed to CREATE the embeddings; tier-1
  // playback loads a <voice>.safetensors in ~15 ms without them, verified
  // offline against a cache holding only the ungated repo. Do not ship the
  // gated weights — the licence does not allow redistributing them.
  //
  // runtimeAssetsWindows: the lipsync/T2F/express ONNX model + source tree the
  // Windows soul expects, extracted to <runtime>/assets/ so run_soul.ps1's
  // $Repo/Audio2Lipsync/python/src, $Repo/ExpressModelv8/checkpoints/... etc.
  // resolve. Freshly built 2026-06-13 to match the CURRENT run_soul.ps1 layout
  // (the old May bundle used a different _runtime/{lipsync,express} layout).
  // Carved: only the 2 ONNX checkpoints run_soul references (v6_wavlm + v6mini)
  // out of the 5 GB checkpoints_onnx dir, plus t2f_fp16.onnx + best_v4.pt +
  // stats + the lipsync/express .py source. Mac-only .mlpackage excluded.
  runtimeAssetsWindows: {
    url: 'https://files.fotonlabs.com/assets/runtime-2026.0912.01-win.zip',
    sha256: 'dc1e2e4b3b7d61533d71200233240bb474b8d39d87bd97bfe3532beb8d3d42aa',
    sizeBytes: 1_005_425_636,
    version: '2026.0912.01',
  },

  // Linux (first release, UE 5.8). Same carve as Windows: chunk0 + chunk5 +
  // chunk6, paid 1-4 removed. Zip root holds AudioTestProject02.sh. Also the
  // first Linux build since the direct-path plugin landed — see the port
  // manifest for the three cross-compile fixes it needed.
  //
  // The assets bundle is byte-identical to the Windows one (pure ONNX + python,
  // no platform bits) — same sha, two keys. That duplication is deliberate.
  unrealLinux: {
    url: 'https://files.fotonlabs.com/linux/unreal/unreal-2026.0910.02-linux.zip',
    sha256: 'b6e81bb69ba5d009121c67da2ae503ad52fa8d99a8c3effde22b3c1c46014c21',
    sizeBytes: 3_332_850_121,
    version: '2026.0910.02',
  },

  runtimeAssetsLinux: {
    url: 'https://files.fotonlabs.com/linux/assets/runtime-2026.0912.01-linux.zip',
    sha256: 'dc1e2e4b3b7d61533d71200233240bb474b8d39d87bd97bfe3532beb8d3d42aa',
    sizeBytes: 1_005_425_636,
    version: '2026.0912.01',
  },

  // Paid character paks. Cooked from AudioTestProject02 build 2026.0607.03 as
  // per-character chunks (chunk1=ava .. chunk4=joi), each zipped (<id>.pak
  // inside) and uploaded to the PRIVATE R2 bucket unclaw-paks-private at
  // characters/<id>/current.zip. `url` is documentation only, the real,
  // short-lived presigned download URL is handed back by the store Worker after
  // it verifies the account's entitlement; sha256 + sizeBytes here verify the
  // exact bytes (same discipline as the base bundles). grace + mark are free and
  // ship in the base app (chunk0/chunk5), so they have no entry here.
  //
  // BOTH key forms are uploaded for every character: the Worker maps
  // `?v=<version>` -> characters/<id>/<id>-<version>.zip and no-v ->
  // characters/<id>/current.zip. NOTE: the live client (services/store.ts
  // fetchDownloadUrl) sends only ?platform=, so `current.zip` is what actually
  // gets served today; `version` below is the SIDECAR drift stamp, not the
  // download key. The versioned key is still uploaded so a pinned client or a
  // rollback has something to point at.
  //
  // CROSS-PLATFORM: `version` is shared by the mac + windows entries. Bumping
  // it for a Mac-only ship makes Windows installs see one spurious "stale"
  // re-download when this branch merges; it self-heals because the bytes it
  // re-fetches (windows current.zip) still match the windows sha256 below.
  //
  // mac hashes: Mac build 2026.0805.02 (from the manual UnrealPak split of the
  // monolithic Mac cook — see Mac - UE 5.8 Chunked Pak Bug and Manual Split).
  // MUST match the base app's UE build, which is why these move in lockstep
  // with manifest.unreal above.
  // windows + linux hashes: builds 2026.0910.02, carved chunk1-4 re-zipped
  // store-0 as <id>.pak -> characters/<id>/<platform>/{current,<id>-<version>}.zip.
  // Deflate buys nothing on an already-compressed .pak, so these are STORE-0.
  // (Verified against the live bucket 2026-08-19: all four Mac paks present in
  // both key forms, sizes byte-exact against the entries below.)
  characterPaks: {
    ava: {
      characterId: 'ava',
      version: '2026.0910.02',
      url: 'https://store.unclaw.io/store/characters/ava/download',
      mac: {
        sha256: '949ba8ab7d0a1193bee9a8cc2ca016346ce143d36227e0c17423967e9b7e4a39',
        sizeBytes: 167_088_287,
      },
      windows: {
        sha256: '66b19d15b662c0a757267754d42eeb9a346f07597d06abe6190daeb63c833689',
        sizeBytes: 163_903_556,
      },
      linux: {
        sha256: '3e98404b3fe87dc21cb9aacd630a4756c1560dfaf4aa43affad927b5cc3bcbf0',
        sizeBytes: 162_186_610,
      },
    },
    goblin: {
      characterId: 'goblin',
      version: '2026.0910.02',
      url: 'https://store.unclaw.io/store/characters/goblin/download',
      mac: {
        sha256: '69a838e24e4aa81fa6a0e65d29ab8d7f768281dff0472e527cea5b96801e629a',
        sizeBytes: 126_354_548,
      },
      windows: {
        sha256: '42a1f4478db5f6175e3e1f70f0cb0f0bbe7a4533eea26d6cabf248623957459a',
        sizeBytes: 123_177_517,
      },
      linux: {
        sha256: 'f767ed1322c85f888b6549eb9e871e5e75ff867c30e213859ad23f41c4a0fdf2',
        sizeBytes: 121_491_685,
      },
    },
    chris: {
      characterId: 'chris',
      version: '2026.0910.02',
      url: 'https://store.unclaw.io/store/characters/chris/download',
      mac: {
        sha256: '6e7f9aabd3cbc4f0b343de286cd45c910d59a7c0af8b1e9dd742fcdd212f3556',
        sizeBytes: 164_216_981,
      },
      windows: {
        sha256: '762f5ed9b08f0bd8e560b1fc1f5edc999f6dd615fb6d162f255cefa895af4316',
        sizeBytes: 161_153_296,
      },
      linux: {
        sha256: 'd8da19671a019a98da1ef85426f483139673da867581a0be401d0d5381e5a553',
        sizeBytes: 159_602_067,
      },
    },
    joi: {
      characterId: 'joi',
      version: '2026.0910.02',
      url: 'https://store.unclaw.io/store/characters/joi/download',
      mac: {
        sha256: 'a8eb5c89e207ebdee48b0a531536073a5e80919db26e204b12ba1b64173d4213',
        sizeBytes: 174_802_419,
      },
      windows: {
        sha256: '3a62bfdc0229ec6eb942b994371d3017e69dfabfc619fcdd35172de2ba4206f3',
        sizeBytes: 171_620_977,
      },
      linux: {
        sha256: '309e3020311d3354829d6b7a11352c0d04f4c9887c83e6a9240efddaa0c7492a',
        sizeBytes: 169_922_150,
      },
    },
  },
};
