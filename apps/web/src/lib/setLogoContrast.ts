// GENERATED FILE — do not edit by hand.
// Regenerate with: scripts/set-logo-contrast.sh
//
// Set logos whose ink largely disappears against our dark surfaces (issue #16).
// These are logos inked for white packaging: black wordmarks and outlines with
// no light stroke. The UI puts a light plate behind them (see <SetLogo>) so the
// whole mark reads; every other logo renders bare, as before.
//
// Metric: fraction of the logo's ink that is both far in colour from the surface
// backdrop and not adjacent to any ink that is legible on it. See the script for
// the full rationale. Measured against #282d38 at a normalised 64px height;
// flagged at >= 0.25. 20 of 157 measured logos are flagged.

const LIGHT_PLATE_SET_IDS: ReadonlySet<string> = new Set([
  'base4',
  'basep',
  'bwp',
  'dpp',
  'ex8',
  'gym2',
  'hgssp',
  'np',
  'pop1',
  'pop2',
  'pop3',
  'pop4',
  'pop5',
  'pop6',
  'pop7',
  'pop8',
  'pop9',
  'smp',
  'swshp',
  'xyp',
])

/** True when this set's logo needs a light plate behind it to stay legible. */
export function setLogoNeedsLightPlate(setId: string | null | undefined): boolean {
  return !!setId && LIGHT_PLATE_SET_IDS.has(setId)
}
