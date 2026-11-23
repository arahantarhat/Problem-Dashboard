import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const desktop = fileURLToPath(new URL('./', import.meta.url));
const project = resolve(desktop, '..');
const output = resolve(desktop, 'Unified Training.app');
const staging = mkdtempSync(resolve(desktop, '.build-'));
const bundle = resolve(staging, 'Unified Training.app');

function run(tool, args) {
  const result = spawnSync(tool, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(tool + ' failed with status ' + result.status);
}

try {
  mkdirSync(resolve(bundle, 'Contents/MacOS'), { recursive: true });
  mkdirSync(resolve(bundle, 'Contents/Resources'));
  writeFileSync(resolve(bundle, 'Contents/Resources/launcher.json'), JSON.stringify({project, node:process.execPath}));
  writeFileSync(resolve(bundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>UnifiedTraining</string>
  <key>CFBundleIdentifier</key><string>local.unified-training.desktop</string>
  <key>CFBundleName</key><string>Unified Training</string>
  <key>CFBundleDisplayName</key><string>Unified Training</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
`);
  run('/usr/bin/swiftc', ['-O', '-parse-as-library', '-module-cache-path', resolve(project, '.engine/swift-cache'),
    resolve(desktop, 'UnifiedTraining.swift'), '-o', resolve(bundle, 'Contents/MacOS/UnifiedTraining')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  rmSync(output, { recursive: true, force: true });
  renameSync(bundle, output);
  console.log(output);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
