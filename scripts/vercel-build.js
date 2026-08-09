// Vercel's build step (`npm run vercel-build`, wired via vercel.json).
//
// This work canNOT live in postinstall on Vercel: Vercel caches node_modules
// between deploys, and on a cache hit npm skips install lifecycle scripts
// entirely. That would leave a STALE Prisma client and — worse — no dist/ at
// all, which api/index.js requires at cold start. The build command always
// runs, so it is the only safe home for it. (Render still uses postinstall,
// because its build command is a bare `npm install`.)
//
// Written in Node rather than an npm `&&` chain to match scripts/postinstall.js
// — the local script shell is Windows PowerShell 5.1, which has no `&&`.

const { execSync } = require('node:child_process');

const run = (cmd) => {
  console.log(`[vercel-build] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

console.log(`[vercel-build] VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}`);

// Both are required for the function to boot: the generated client, and the
// compiled output that api/index.js requires. A failure here must fail the
// build — shipping without them yields a function that 500s on every request.
run('npx prisma generate');
run('npm run build');

// Apply pending migrations so the DB schema matches the code. `migrate deploy`
// is idempotent.
//
// Production only: every environment currently points at the SAME Supabase
// database, so migrating from a preview build would reshape the production
// schema from an unreviewed branch.
if (process.env.VERCEL_ENV !== 'production') {
  console.log(
    '[vercel-build] skipping prisma migrate deploy (production builds only)',
  );
} else {
  // Best-effort, matching the long-standing Render behavior: a deploy that
  // cannot reach the DB at build time should still boot and surface the cause
  // at runtime rather than blocking the release. NOTE: this means code can ship
  // ahead of the schema — the warning below is the only signal, so read it.
  try {
    run('npx prisma migrate deploy');
  } catch (err) {
    console.warn(
      `[vercel-build] !!! prisma migrate deploy FAILED, continuing: ${err.message}`,
    );
  }
}
