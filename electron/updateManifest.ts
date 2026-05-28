// Runtime auto-updater types + remote manifest contract.
//
// Where the setup wizard (setupCoordinator.ts) provisions a baseline runtime
// on first launch from a manifest BAKED INTO THE BINARY (setupManifest.ts),
// the updater fetches a SEPARATE manifest HOSTED ON R2 on every launch and
// applies whichever categories have drifted from the installed versions.
//
// This lets us ship small soul / asset / UE bumps without forcing every user
// to re-download a new DMG. Only the Electron shell itself (the `app`
// category) requires a DMG-side update, that path is handled separately by
// electron-updater (Squirrel.Mac).
//
// ----------------------------------------------------------------------
// Where the remote manifest lives
// ----------------------------------------------------------------------
//
//   https://files.fotonlabs.com/mac/updates/latest.json
//
// We never PUT to /mac/updates/latest.json with the same body (Cloudflare R2
// edge cache TTL is ~1700s and we'd serve a stale manifest for half an hour
// after a release). The publish flow is:
//
//   1. Build the new artifact + upload to a NEW versioned key (e.g.
//      /mac/soul/soul-2026.0526.01.tar.gz)
//   2. Write a fresh latest.json with the new entry's URL/SHA/size/version
//      AND a top-level `manifestVersion` bump (cache-bust signal)
//   3. PUT that latest.json to R2, Cloudflare's cache invalidates because
//      we also rotate the query-string `?v=<manifestVersion>` that the
//      updater appends on fetch (belt-and-suspenders to defeat any edge
//      caching that ignored our cache-control headers)
//
// ----------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------
//
//   app   , Electron shell (frontend + main process bundle). Updated via
//            electron-updater / Squirrel.Mac. Listed here for completeness
//            but the updater code path treats it as informational only , 
//            actual install is Squirrel's job.
//   soul  , Python source (~25 MB compressed). Drops into
//            <userData>/runtime/soul/ as an OVERLAY; soulSupervisor.ts
//            prefers this over the DMG-bundled baseline when present.
//            Requires soul process restart to take effect.
//   unreal, UE Shipping .app (~2 GB compressed). Replaces
//            <userData>/runtime/unreal/Unclaw Character.app/. Requires
//            killing + respawning UE (~30 s blackout for the user).
//   assets, Models + lipsync source + checkpoints (~700 MB compressed).
//            Drops into <userData>/runtime/assets/. Requires soul restart
//            because models are loaded once at soul startup.
//
// ----------------------------------------------------------------------

import { RemoteAsset } from './setupManifest';

export type UpdateCategoryId = 'app' | 'soul' | 'unreal' | 'assets';

export interface CategoryEntry extends RemoteAsset {
  /** Human-readable version. Compared as opaque string against the
   *  installed-versions ledger; any mismatch = update available. We use
   *  date-tag strings like '2026.0526.01' so version order is monotonic
   *  and a `<` comparison in the UI can show "new" vs "downgrade". */
  version: string;
  /** Whether installing this category requires restarting Unclaw (kills
   *  the renderer + main process + all children). For `app` this is
   *  always true (Squirrel's choice anyway); for content categories we
   *  always restart the dependent process (soul/UE) but can keep the
   *  Electron shell alive, set false to skip the global restart prompt. */
  globalRestartRequired: boolean;
  /** One-line human description shown in the update overlay. */
  changelog?: string;
}

export interface UpdateManifest {
  /** Bumped on every publish even if only a SHA changes, used as the
   *  query-string cache-buster on fetch. */
  manifestVersion: number;
  /** ISO8601, informational only. */
  generatedAt: string;
  /** Per-category latest. Categories not in this map are not advertised
   *  (forward-compatible: a future ship can introduce a new category
   *  without an older client crashing on unknown entries). */
  categories: Partial<Record<UpdateCategoryId, CategoryEntry>>;
}

/** Local ledger at <userData>/runtime/.installed-versions.json. Tracks
 *  what's actually on disk vs what the manifest advertises. */
export interface InstalledVersions {
  /** App shell version (electron app.getVersion()). Set on every successful
   *  launch so a Squirrel-installed bump is reflected without round-tripping
   *  the user. */
  app?: string;
  soul?: string;
  unreal?: string;
  assets?: string;
  /** SHA-256 of the requirements-mac.txt that was last pip-installed into
   *  the venv. Compared against the SHA of the just-installed soul overlay's
   *  requirements file, mismatch triggers a `uv pip install -r` against
   *  the existing venv (see `syncSoulVenv` in setupCoordinator.ts). Lets a
   *  soul update that adds/removes pip deps actually land them, without
   *  forcing a full setup-wizard re-run. */
  soul_requirements_sha?: string;
}

// ----------------------------------------------------------------------
// Fallback / bootstrap manifest
// ----------------------------------------------------------------------
//
// If the remote fetch fails (no network on first launch, R2 outage, malformed
// JSON), we fall back to BAKED VALUES so the user can still launch with the
// versions that shipped with their DMG. These are kept in sync with the
// shipped setupManifest values via the release script.

export const FALLBACK_MANIFEST: UpdateManifest = {
  manifestVersion: 0,
  generatedAt: '2026-05-25T00:00:00Z',
  categories: {
    // Intentionally empty, the bootstrap path is "no updates available,
    // use whatever the DMG shipped with." Real manifest is fetched at
    // runtime and overrides this entirely.
  },
};

export const REMOTE_MANIFEST_URL =
  'https://files.fotonlabs.com/mac/updates/latest.json';
