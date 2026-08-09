// Vercel serverless entrypoint.
//
// Vercel invokes the default export as a Node request handler, and an Express
// app IS one — so this just builds the app and exports it WITHOUT listening.
// (src/server.ts keeps the `listen()` + SIGTERM path for Render/local; nothing
// here should call it, a serverless function has no port to bind.)
//
// Deliberately plain JavaScript requiring the COMPILED output rather than a
// .ts file importing ../src: tsconfig pins `rootDir: ./src`, so a TypeScript
// entrypoint outside src fails to compile. Requiring ../dist also means Vercel
// and Render run byte-identical code — the same `tsc` output, built by
// scripts/postinstall.js on both platforms.
//
// vercel.json rewrites every path to this function; Express still sees the
// original URL, so the /api/v1/... routes resolve exactly as they do locally.

const { createApp } = require("../dist/app");

module.exports = createApp();
