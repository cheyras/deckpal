/** The self-host SPA's Helmet policy, shared with the real HEIC browser check. */
export const selfHostContentSecurityPolicy = {
  useDefaults: true,
  // HEIC decoding uses a blob worker; private photo previews use blob URLs.
  // Neither requires relaxing script-src or allowing cross-origin resources.
  directives: {
    upgradeInsecureRequests: null,
    workerSrc: ["'self'", 'blob:'],
    imgSrc: ["'self'", 'data:', 'blob:'],
  },
} as const;
