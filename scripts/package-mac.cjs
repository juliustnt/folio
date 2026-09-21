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
