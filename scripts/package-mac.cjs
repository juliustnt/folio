const fs = require("node:fs");
const path = require("node:path");
// This local build records the tested runtime. Distributable builds should provide
// an installer for their own Python runtime rather than copying a virtualenv.
fs.writeFileSync(
  path.join(__dirname, "..", "electron", "runtime.json"),
  JSON.stringify({
    python: path.join(__dirname, "..", ".venv", "bin", "python"),
  }),
);

// Ship a native helper so changing the PDF default does not require Xcode at runtime.
const { execFileSync } = require("node:child_process");
const nativeOutput = path.join(__dirname, "..", "artifacts", "native");
fs.mkdirSync(nativeOutput, { recursive: true });
execFileSync("/usr/bin/xcrun", [
  "swiftc", path.join(__dirname, "..", "electron", "native", "pdf-default.swift"),
  "-O", "-module-cache-path", path.join(nativeOutput, "module-cache"),
  "-o", path.join(nativeOutput, "pdf-default"),
], { stdio: "inherit" });
