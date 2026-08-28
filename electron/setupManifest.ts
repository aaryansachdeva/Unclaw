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
   *  SHA-verifies the download against the matching entry. */
  mac: CharacterPakPlatformAsset;
  windows: CharacterPakPlatformAsset;
}

/** Pick the pak bytes for the running platform (Windows → windows, else mac). */
export function characterPakForPlatform(
  entry: CharacterPakAsset,
): CharacterPakPlatformAsset {
  return process.platform === 'win32' ? entry.windows : entry.mac;
}

/** Query-string platform token the client appends to the store Worker's
 *  /download endpoint so it presigns the matching platform key. */
export function storePlatformParam(): 'windows' | 'mac' {
  return process.platform === 'win32' ? 'windows' : 'mac';
}

export const MANIFEST: SetupManifest = {
  releaseTag: '2026.0819.01-mac',
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

  // Paid character paks. Cooked as per-character chunks (chunk1=ava ..
  // chunk4=joi), each zipped (<id>.pak inside) and uploaded to the PRIVATE R2
  // bucket unclaw-paks-private. `url` is documentation only, the real,
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
  // windows hashes: Windows build 2026.0805.03, each re-zipped store-0 as
  // <id>.pak -> characters/<id>/windows/{current,<id>-<version>}.zip.
  // (Verified against the live bucket 2026-08-19: all four Mac paks present in
  // both key forms, sizes byte-exact against the entries below.)
  characterPaks: {
    ava: {
      characterId: 'ava',
      version: '2026.0823.02',
      url: 'https://store.unclaw.io/store/characters/ava/download',
      mac: {
        sha256: '949ba8ab7d0a1193bee9a8cc2ca016346ce143d36227e0c17423967e9b7e4a39',
        sizeBytes: 167_088_287,
      },
      windows: {
        sha256: '77fbfdb846dff62dd9a1be8c6de44f5a1740fe1941e6a640bfcd6da78f638e33',
        sizeBytes: 177_344_968,
      },
    },
    goblin: {
      characterId: 'goblin',
      version: '2026.0823.02',
      url: 'https://store.unclaw.io/store/characters/goblin/download',
      mac: {
        sha256: '69a838e24e4aa81fa6a0e65d29ab8d7f768281dff0472e527cea5b96801e629a',
        sizeBytes: 126_354_548,
      },
      windows: {
        sha256: '1676aa23eb3408a74032c892ac86926c67de92c90d8e49989a4a051ea3b0d868',
        sizeBytes: 87_279_140,
      },
    },
    chris: {
      characterId: 'chris',
      version: '2026.0823.02',
      url: 'https://store.unclaw.io/store/characters/chris/download',
      mac: {
        sha256: '6e7f9aabd3cbc4f0b343de286cd45c910d59a7c0af8b1e9dd742fcdd212f3556',
        sizeBytes: 164_216_981,
      },
      windows: {
        sha256: '011078b17d5a345e6ddc4eb220b0a3da7524702b2c3d01563507c02f1ee8e0df',
        sizeBytes: 129_136_215,
      },
    },
    joi: {
      characterId: 'joi',
      version: '2026.0823.02',
      url: 'https://store.unclaw.io/store/characters/joi/download',
      mac: {
        sha256: 'a8eb5c89e207ebdee48b0a531536073a5e80919db26e204b12ba1b64173d4213',
        sizeBytes: 174_802_419,
      },
      windows: {
        sha256: '10af1338b4543205dad983384d7e007a26020ede0925d0dd610d003b2d90fb50',
        sizeBytes: 135_684_090,
      },
    },
  },
};
