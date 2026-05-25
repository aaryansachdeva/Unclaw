// electron-builder afterAllArtifactBuild hook — completes the
// notarization story for DMG containers.
//
// Why this exists:
//   The companion `notarize.js` runs as the `afterSign` hook, which
//   electron-builder fires AFTER the .app is signed but BEFORE any DMG
//   or ZIP is packaged. So `notarize.js` only handles the .app. The
//   DMG container, built later, ships unsigned by default — which means
//   users mounting the downloaded DMG see "Apple cannot verify that
//   this software is free from malware" before they can even drag the
//   .app to Applications.
//
//   This hook runs once at the very end (after all artifacts exist),
//   walks the artifact list, and signs + notarizes + staples every
//   .dmg in place. Same `UNCLAW_NOTARIZE=1` gate as the .app hook so
//   dev builds aren't slowed by Apple round-trips.
//
// The .app inside each DMG is already fully notarized and stapled by
// the afterSign pass — this is strictly about the wrapping container.
//
// Env vars (same conventions as notarize.js):
//   UNCLAW_NOTARIZE             — must be "1" to run
//   UNCLAW_NOTARYTOOL_PROFILE   — keychain profile (default unclaw-notarytool)

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function notarizeDmg(buildResult) {
  if (process.env.UNCLAW_NOTARIZE !== '1') {
    console.log('[notarize-dmg] UNCLAW_NOTARIZE != "1" — skipping DMG notarization.');
    return [];
  }

  // Pick the same signing identity that signed the .app, so the DMG
  // and its enclosed app trace back to the same Developer ID team.
  const pkg = require('../package.json');
  const identity = pkg.build && pkg.build.mac && pkg.build.mac.identity;
  if (!identity) {
    throw new Error(
      '[notarize-dmg] package.json build.mac.identity must be set ' +
      'before this hook can sign the DMG',
    );
  }

  const profile = process.env.UNCLAW_NOTARYTOOL_PROFILE || 'unclaw-notarytool';

  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
  if (dmgs.length === 0) {
    console.log('[notarize-dmg] no .dmg artifacts found — nothing to do');
    return [];
  }

  // Credential resolution — match notarize.js's behavior so the two hooks
  // share the same env-var contract. Env vars win over keychain profile
  // when both are present (they're more explicit / harder to get out of
  // sync). The keychain profile path is preferred when no env vars set,
  // because it never puts the app-specific password on the env.
  const appleId = process.env.UNCLAW_APPLE_ID;
  const appleIdPassword = process.env.UNCLAW_APPLE_PASSWORD;
  const teamId = process.env.UNCLAW_TEAM_ID;
  const useEnvCreds = !!(appleId && appleIdPassword && teamId);

  const notarytoolAuthArgs = useEnvCreds
    ? ['--apple-id', appleId, '--password', appleIdPassword, '--team-id', teamId]
    : ['--keychain-profile', profile];

  console.log(
    `[notarize-dmg] auth=${useEnvCreds ? 'env-vars (UNCLAW_APPLE_*)' : 'keychain profile ' + profile}`,
  );

  for (const dmg of dmgs) {
    const name = path.basename(dmg);
    console.log(`[notarize-dmg] signing ${name}`);
    execFileSync(
      'codesign',
      ['--sign', identity, '--timestamp', '--force', dmg],
      { stdio: 'inherit' },
    );

    console.log(`[notarize-dmg] submitting ${name} to Apple notary (3-15 min)…`);
    execFileSync(
      'xcrun',
      ['notarytool', 'submit', dmg, ...notarytoolAuthArgs, '--wait'],
      { stdio: 'inherit' },
    );

    console.log(`[notarize-dmg] stapling ticket to ${name}`);
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });

    console.log(`[notarize-dmg] ${name} signed + notarized + stapled ✓`);
  }

  // No new artifacts to inject — we mutated existing ones in place.
  return [];
};
