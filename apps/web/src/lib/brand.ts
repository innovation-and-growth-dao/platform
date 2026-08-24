/**
 * Per-deployment branding. The platform runs as two autonomous deployments off the same
 * code base — the DRep DAO and the Innovation & Growth DAO — so the name, tab icon and
 * tagline come from one env var rather than being hard-coded.
 *
 * Set NEXT_PUBLIC_APP_NAME in the deployment's .env (it is inlined at build time):
 *   NEXT_PUBLIC_APP_NAME="Innovation & Growth DAO"
 * Anything unrecognised still works — it shows the given name with the default mark.
 */
export interface Brand {
  name: string;
  /** Tab icon served from /public. */
  icon: string;
  /** <meta name="description"> for the deployment. */
  description: string;
  /** Which public landing to show: a funding DAO (rounds/treasury) or a pure governance DAO. */
  kind: 'funding' | 'governance';
}

// Alternatives for each brand are previewed at /icons — swap the path here and rebuild.
const INNOVATION_GROWTH: Brand = {
  name: 'Innovation & Growth DAO',
  icon: '/icons/ig-sprout.svg', // green sprouting seed
  description: 'Cardano innovation & growth funding DAO',
  kind: 'funding',
};

const DREP_DAO: Brand = {
  // The council, not the acronym alone. "DRep" on its own names the role a
  // person holds in Cardano governance, not this organisation.
  name: 'DRep Council',
  icon: '/icons/drep-globe.svg', // globe
  description: 'Cardano governance DAO platform',
  kind: 'governance',
};

/** Resolved once at build time (NEXT_PUBLIC_ vars are inlined, so this is safe on the client). */
export const brand: Brand = (() => {
  const configured = process.env.NEXT_PUBLIC_APP_NAME?.trim();
  if (!configured) return INNOVATION_GROWTH; // default: this is the Innovation & Growth DAO edition
  const normalized = configured.toLowerCase();
  if (normalized.includes('innovation')) return { ...INNOVATION_GROWTH, name: configured };
  if (normalized.includes('drep')) return { ...DREP_DAO, name: configured };
  // Unknown brand: honour the name, fall back to the Innovation & Growth mark.
  return { ...INNOVATION_GROWTH, name: configured };
})();
