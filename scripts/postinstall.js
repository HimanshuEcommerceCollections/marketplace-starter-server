// Runs automatically after `npm install`.
//
// Render's build command is just `npm install`, which never compiles the
// TypeScript or generates the Prisma client — so `node dist/server.js` had
// nothing to run. This script does that build work, but ONLY on Render
// (gated on the RENDER env var Render sets in all its environments). On a
// developer's machine it exits immediately, so local `npm install` is
// unaffected — no rebuilds, and no shell-chaining that would trip the
// powershell.exe script-shell used locally.
//
// Done in Node (not an npm-script `&&` chain) on purpose: Windows PowerShell
// 5.1 — the local script shell — does not support `&&`.

if (!process.env.RENDER) {
  process.exit(0);
}

const { execSync } = require('node:child_process');

const run = (cmd) => {
  console.log(`[postinstall] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

// Required: client + compiled output must exist for the server to boot.
run('npx prisma generate');
run('npm run build');

// Best-effort: apply pending migrations so the DB schema matches the code.
// migrate deploy is idempotent. If it fails (e.g. DATABASE_URL not present at
// build time) we warn and let the deploy proceed so the server still boots and
// the cause surfaces clearly at runtime instead of failing the whole build.
try {
  run('npx prisma migrate deploy');
} catch (err) {
  console.warn(
    `[postinstall] prisma migrate deploy failed, continuing: ${err.message}`,
  );
}
