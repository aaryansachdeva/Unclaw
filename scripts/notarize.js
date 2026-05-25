// electron-builder afterSign hook for Mac notarization.
//
// Notarization requires three things:
//   1. The app is hardened-runtime + signed with a Developer ID Application
//      cert (configured in package.json build.mac).
//   2. Apple credentials available to notarytool. We use the keychain
//      profile pattern so the password never lives on disk:
//          xcrun notarytool store-credentials "unclaw-notarytool" \
//            --apple-id "<your-apple-id>" \
//            --team-id "<your-team-id>" \
//            --password "<app-specific-password>"
//   3. Network access to apple.com.
//
// Opt in by setting UNCLAW_NOTARIZE=1 in the environment before
// `npm run dist:mac`. When unset (or no Developer ID cert is found),
// the hook silently skips so unsigned dev builds still produce a DMG.
//
// Env vars:
//   UNCLAW_NOTARIZE             — must be "1" to run notarization
//   UNCLAW_NOTARYTOOL_PROFILE   — keychain profile name (default: unclaw-notarytool)
//   UNCLAW_APPLE_ID             — fallback: Apple ID for live submit (no profile)
//   UNCLAW_APPLE_PASSWORD       — fallback: app-specific password
//   UNCLAW_TEAM_ID              — fallback: Apple Developer Team ID

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  if (process.env.UNCLAW_NOTARIZE !== '1') {
    console.log(
      '[notarize] UNCLAW_NOTARIZE != "1" — skipping notarization. ' +
      'Set UNCLAW_NOTARIZE=1 to enable.',
    );
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const appBundleId = packager.appInfo.id;

  const profile = process.env.UNCLAW_NOTARYTOOL_PROFILE || 'unclaw-notarytool';
  const appleId = process.env.UNCLAW_APPLE_ID;
  const appleIdPassword = process.env.UNCLAW_APPLE_PASSWORD;
  const teamId = process.env.UNCLAW_TEAM_ID;

  console.log(`[notarize] submitting ${appPath} to Apple…`);

  if (appleId && appleIdPassword && teamId) {
    // Live credentials path — Apple ID + app-specific password + team ID
    // passed inline. notarytool stores them in the user's login keychain
    // for the duration of the run.
    await notarize({
      tool: 'notarytool',
      appPath,
      appBundleId,
      appleId,
      appleIdPassword,
      teamId,
    });
  } else {
    // Keychain-profile path — credentials were previously stored via
    // `xcrun notarytool store-credentials`. Most secure: no password
    // ever touches the build env.
    await notarize({
      tool: 'notarytool',
      appPath,
      appBundleId,
      keychainProfile: profile,
    });
  }

  console.log('[notarize] notarized + stapled successfully.');
};
