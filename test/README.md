# EffectStreamer Tests

## Introduction

This directory contains the automated tests for EffectStreamer – covering the shared helpers, native core, server and participant-facing GUI.

Tests and their fixtures are grouped by component under `common/`, `est-core/`, `est-server/` and `est-gui/`. Vitest and Playwright configurations are kept alongside the GUI tests. The application directories contain no automated test suites or npm commands and dependencies used only by tests.

## Preparation

From the repository root, install the application dependencies and the separate test package:

```bash
npm --prefix est-server ci
npm --prefix est-gui ci
npm --prefix test ci
```

The documented release toolchain is Node 22.22.3/npm 10.9.8. Development verification also uses Node 24.21.0/npm 11.19.0. Tests that exercise Vite or Electron builds use the GUI's installed build tools rather than an independent copy in the test package.

### Native builds

Core tests, server media-worker tests and real browser media tests require a source-built core, the integration-only WebRTC peer and a matching GStreamer runtime including `estnetsim`. Build both native executables using the test builder instead of the application-only build script:

```bash
SDK=/absolute/path/to/gst-sdk/build/dist/linux_x86_64 TARGET_OS=linux npm --prefix test run build:core
SDK=/absolute/path/to/gst-sdk/build/dist/mingw_x86_64 TARGET_OS=win npm --prefix test run build:core
```

These Bash commands share the application build's SDK/compiler setup and output lock. They compile fixtures from `test/est-core/fixtures/`, writing `est-core[.exe]` and `webrtc-peer[.exe]` as siblings under the managed temporary build directory. They do not modify tracked distribution binaries. `EST_BUILD_TEST_PEER` is no longer used by the application build script.

Tests default to the managed Linux build. `EST_CORE_EXECUTABLE` selects another compatible core; place its matching `webrtc-peer` beside it. Configure matching GStreamer library/plugin paths as described in the [deployment instructions](../deployment/README.md). Native ALSA integration also needs a working `null` device. Some GUI integration cases additionally require `EST_NATIVE_INTEGRATION=1`.

## Usage

Run from the repository root:

```bash
npm --prefix test run test:layout
npm --prefix test run test:common
npm --prefix test run test:est-core
npm --prefix test run test:est-server
npm --prefix test run test:est-gui -- --run
npm --prefix test test
```

The combined command runs layout/launcher checks and the four suites sequentially, with GUI run mode. It requires the native prerequisites; missing executables cause integration failures rather than silently dropping coverage. GUI unit mode without `--run` retains Vitest's interactive/watch behaviour.

### Test filters

Filters are forwarded without changing output locations:

```bash
npm --prefix test run test:common -- --test-name-pattern 'shared helpers'
npm --prefix test run test:est-gui -- --run -t 'browser'
npm --prefix test run test:e2e -- --list
npm --prefix test run test:audio-browser -- --list
```

### Browser tests

Install Playwright's browsers and required host libraries using its normal platform setup, then run the browser suites explicitly:

```bash
npm --prefix test exec -- playwright install chromium firefox webkit
npm --prefix est-gui run build:web
npm --prefix test run test:e2e -- --project chromium
npm --prefix test run test:audio-browser -- --project firefox
```

E2E covers Chromium and Firefox; audio-browser additionally includes WebKit. Discovery with `--list` does not run browser/media acceptance. Synthetic audio coverage does not establish physical-device, real Safari or Edge acceptance. See the [deployment verification checklist](../deployment/README.md#verification).

### Packaged tests

Optional packaged checks use `EST_PACKAGED_SERVER` for a packaged server, `EST_PACKAGED_GUI_DIR` for an unpacked GUI and `EST_ACCEPTANCE_CORE` for browser production acceptance.

## Temporary files

Launchers work independently of the caller's working directory and preserve child exit codes. Reports, coverage, browser profiles, compiler scratch and fixtures use the managed `/tmp/effectstreamer/<user>/<checkout>/...` tree on Linux and the system temporary directory's equivalent subtree on native Windows. Installed dependencies and npm lockfiles remain in the test directory. Explicit report, configuration and output overrides that escape managed paths are rejected. Clearing temporary storage requires rebuilding native/web prerequisites.
