// Records the v1.1 registry sources as offline fixtures (PLAN v1.1 layout).
// Usage: npm run record:registries -- <source> [<source> …]
// Behind a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to the proxy CA bundle.
//
// Each source lives in scripts/registries/<source>.ts and exports its recorder here.
import { recordFrRepair } from "./registries/fr-repair";
import { recordSbti } from "./registries/sbti";

const RECORDERS: Record<string, () => Promise<void>> = {
  sbti: recordSbti,
  "fr-repair": recordFrRepair,
  // Phase 13: scripts/record-sabin.ts records on import (top-level await); `npm run record:sabin` is an alias.
  sabin: async () => {
    await import("./record-sabin");
  },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (wanted.length === 0 || wanted.some((w) => !RECORDERS[w])) {
  console.error(`usage: npm run record:registries -- <${Object.keys(RECORDERS).join("|")}> …`);
  process.exit(1);
}
for (const w of wanted) await RECORDERS[w]();
