// Records the v1.1 registry sources as offline fixtures (PLAN v1.1 layout).
// Usage: npm run record:registries -- <source> [<source> …]
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
//
// Each source lives in scripts/registries/<source>.ts and exports its recorder here.
import { recordFrRepair } from "./registries/fr-repair";

const RECORDERS: Record<string, () => Promise<void>> = {
  "fr-repair": recordFrRepair,
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (wanted.length === 0 || wanted.some((w) => !RECORDERS[w])) {
  console.error(`usage: npm run record:registries -- <${Object.keys(RECORDERS).join("|")}> …`);
  process.exit(1);
}
for (const w of wanted) await RECORDERS[w]();
