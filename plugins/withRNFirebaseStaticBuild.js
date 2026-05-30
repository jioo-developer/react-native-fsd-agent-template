/**
 * Expo config plugin: make @react-native-firebase work with
 * React Native 0.81 + New Architecture + static frameworks on iOS.
 *
 * Without these patches, the iOS build chain fails with three different
 * symptoms (in this order):
 *
 *  1. `-Wnon-modular-include-in-framework-module`
 *     RNFirebase headers (e.g. `RCTConvert+FIRApp.h`) import React-Core
 *     headers (`<React/RCTConvert.h>`) in a non-modular way. With
 *     `useFrameworks: 'static'` Clang rejects it.
 *
 *  2. `RCT_EXPORT_METHOD ... type specifier missing, defaults to 'int'`
 *     React-Core ships as a *prebuilt binary* under new arch
 *     (`RCT_USE_PREBUILT_RNCORE=1`). Prebuilt modules don't re-export
 *     preprocessor macros, so `RCT_EXPORT_METHOD` never expands when used
 *     inside any RNFirebase ObjC source file (`RNFBAnalyticsModule.m`,
 *     `RNFBCrashlyticsModule.m`, ...).
 *
 *  3. `fmt::basic_format_string ... call to consteval function is not a
 *     constant expression`
 *     fmt 11 (pulled in by React-Core source build) enables `consteval`
 *     whenever `__cpp_consteval` or Clang >= 11 is detected. Apple Clang 16
 *     evaluates fmt's own format strings more strictly and rejects them.
 *
 * Patches applied:
 *
 *  - Force React-Core source build via `RCT_USE_PREBUILT_RNCORE=0` at the
 *    very top of the Podfile (fixes #2).
 *  - Inject `use_modular_headers!` into the iOS target block (fixes #1).
 *  - In `post_install`, flip
 *    `CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES = YES` on every
 *    pod target (safety net for #1).
 *  - In `post_install`, rewrite every `#  define FMT_USE_CONSTEVAL 1` in
 *    `Pods/fmt/include/fmt/base.h` to `0` (fixes #3).
 *
 * Idempotent: every patch is keyed on a unique marker and is skipped on a
 * second run if already present. Safe to leave enabled even if the project
 * does not yet depend on Firebase — the Podfile changes are no-ops without
 * the corresponding pods, and the fmt rewrite only runs when fmt is actually
 * vendored (which happens once you enable React-Core source build).
 *
 * Usage: add `'./plugins/withRNFirebaseStaticBuild'` to `plugins` in
 * `app.config.ts`, then `npx expo prebuild --clean`.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULAR_HEADERS_LINE = 'use_modular_headers!';
const POST_INSTALL_MARKER = '# rnfb-static-frameworks:non-modular-allow';
const RNCORE_SOURCE_MARKER = '# rnfb-static-frameworks:rncore-source-build';

const RNCORE_SOURCE_SNIPPET = `${RNCORE_SOURCE_MARKER}
ENV['RCT_USE_PREBUILT_RNCORE'] = '0'
`;

const POST_INSTALL_SNIPPET = `
    ${POST_INSTALL_MARKER}
    installer.pods_project.targets.each do |rnfb_target|
      rnfb_target.build_configurations.each do |rnfb_config|
        rnfb_config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
      end
    end

    # Patch fmt/base.h: force every "define FMT_USE_CONSTEVAL 1" to 0.
    # fmt 11 enables consteval on Apple Clang via either __cpp_consteval or
    # FMT_CLANG_VERSION >= 1101 branches, but Apple Clang 16's stricter
    # consteval evaluation rejects fmt's own format strings.
    rnfb_fmt_base_path = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(rnfb_fmt_base_path)
      rnfb_fmt_marker = '// rnfb-static-frameworks:fmt-consteval-disabled'
      rnfb_fmt_contents = File.read(rnfb_fmt_base_path)
      unless rnfb_fmt_contents.include?(rnfb_fmt_marker)
        rnfb_fmt_contents = rnfb_fmt_contents.gsub(/^#  define FMT_USE_CONSTEVAL 1$/, "#  define FMT_USE_CONSTEVAL 0  #{rnfb_fmt_marker}")
        File.write(rnfb_fmt_base_path, rnfb_fmt_contents)
      end
    end
`;

function ensureRncoreSourceBuild(contents) {
  if (contents.includes(RNCORE_SOURCE_MARKER)) return contents;
  return RNCORE_SOURCE_SNIPPET + '\n' + contents;
}

function ensureUseModularHeaders(contents) {
  if (contents.includes(MODULAR_HEADERS_LINE)) return contents;
  return contents.replace(
    /(use_expo_modules!\s*\n)/,
    `$1  ${MODULAR_HEADERS_LINE}\n`,
  );
}

function ensurePostInstallPatch(contents) {
  if (contents.includes(POST_INSTALL_MARKER)) return contents;
  return contents.replace(
    /(react_native_post_install\([\s\S]*?\)\s*\n)/,
    `$1${POST_INSTALL_SNIPPET}`,
  );
}

module.exports = function withRNFirebaseStaticBuild(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile',
      );
      if (!fs.existsSync(podfilePath)) return config;

      let contents = fs.readFileSync(podfilePath, 'utf-8');
      contents = ensureRncoreSourceBuild(contents);
      contents = ensureUseModularHeaders(contents);
      contents = ensurePostInstallPatch(contents);
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};
