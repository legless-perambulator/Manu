import type { Inflate } from "./zip";

/**
 * Node's inflate, kept out of the main entry so browser bundles never see a
 * `node:` import. Tests and any Node-side tooling use this; the desktop app
 * uses `streamInflate` (DecompressionStream) from the main entry.
 */
export const nodeInflate: Inflate = async (data) => {
  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.inflateRawSync(data));
};
