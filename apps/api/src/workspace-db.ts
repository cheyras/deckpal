// Netlify bundles relative imports into the function archive. Importing the
// pnpm workspace package by name leaves an absolute development-machine
// symlink in CLI deploys, which cannot resolve inside the Linux runtime.
export * from '../../../packages/db/dist/index.js'
