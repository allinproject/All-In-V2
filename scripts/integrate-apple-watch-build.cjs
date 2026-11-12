'use strict';
// ALL-243: Expo/EAS lifecycle adapter, no native build or paid CI by default.
// EAS iOS post-install runs *after* Expo prebuild and CocoaPods installation.
// Explicit opt-in and verified iOS store bundle ID required.
const {spawnSync} = require('node:child_process');
const path = require('node:path');

function main(env=process.env,platform=process.platform,spawn=spawnSync) {
  const enabled = env.ALLIN_V2_WATCH_NATIVE_ENABLED === 'true';
  const buildPlatform = env.EAS_BUILD_PLATFORM ?? 'ios';
  if (!enabled || buildPlatform !== 'ios') {
    process.stdout.write('ALL-243 watch target disabled for this build.\n');
    return 0;
  }
  if (platform !== 'darwin') {
    process.stderr.write('ALL-243 watch target requires macOS + Xcode; refusing to claim build success.\n');
    return 1;
  }
  const bundle = (env.ALLIN_V2_IOS_BUNDLE_ID || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(bundle)) {
    process.stderr.write('ALL-243 requires a verified ALLIN_V2_IOS_BUNDLE_ID.\n');
    return 1;
  }
  const script = path.join(__dirname, 'integrate-apple-watch-target.rb');
  const result = spawn('ruby', [script], {stdio:'inherit', env});
  return result.error ? 1 : (result.status ?? 1);
}
if (require.main === module) process.exitCode = main();
module.exports = {main};
