const { readdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Check newly extracted modules as well as the Electron entry points.
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(filename);
    else if (entry.name.endsWith('.cjs')) {
      execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
    }
  }
}

checkDirectory(path.join(__dirname, '..', 'electron'));
