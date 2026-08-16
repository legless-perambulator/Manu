import type { ExtensionManifest, PackageIntegrity, TrustLevel } from "./types";

/**
 * Package integrity (§3).
 *
 * The digest is SHA-256 over the *canonicalised* manifest — keys sorted at
 * every level — so formatting differences never break verification and a
 * tampered manifest always does. Signing is a foundation, not a ceremony:
 * first-party packages carry an HMAC-SHA256 signature over the digest under
 * a key named in the trusted registry; everything else is honestly labelled
 * **unsigned** — intact if the digest holds, but of unverified authorship.
 * No stronger claim is made for community packages than the mathematics
 * supports.
 */

// ── SHA-256, dependency-free ─────────────────────────────────────────────────

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const withPadding = new Uint8Array((((length + 8) >> 6) << 6) + 64);
  withPadding.set(bytes);
  withPadding[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength >>> 0, false);
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000), false);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    const sums = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i += 1) h[i] = ((h[i] as number) + (sums[i] as number)) | 0;
  }
  return h.map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

// ── Canonicalisation and digests ─────────────────────────────────────────────

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, held]) => held !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function manifestDigest(manifest: ExtensionManifest): string {
  return sha256Hex(canonical(manifest));
}

// ── Signing foundation ───────────────────────────────────────────────────────

/**
 * The trusted-key registry. First-party packages are signed with keys listed
 * here; a signature under an unknown key is treated as unsigned, and a
 * wrong signature under a known key is invalid — loudly.
 */
export interface TrustedKey {
  readonly keyId: string;
  readonly secret: string;
}

export const FIRST_PARTY_KEY_ID = "manu-first-party-2026";

function hmacSha256(secret: string, message: string): string {
  // HMAC per RFC 2104 over the block-sized key, built on the hash above.
  const blockHex = (pad: number) => {
    const keyBytes = new TextEncoder().encode(secret);
    const block = new Uint8Array(64);
    if (keyBytes.length > 64) {
      const digest = sha256Hex(secret);
      for (let i = 0; i < 32; i += 1)
        block[i] = Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16);
    } else {
      block.set(keyBytes);
    }
    return [...block].map((byte) => String.fromCharCode(byte ^ pad)).join("");
  };
  return sha256Hex(blockHex(0x5c) + sha256Hex(blockHex(0x36) + message));
}

export function signDigest(digest: string, key: TrustedKey): PackageIntegrity["signature"] {
  return { keyId: key.keyId, value: hmacSha256(key.secret, digest) };
}

export function verifyIntegrity(
  manifest: ExtensionManifest,
  integrity: PackageIntegrity,
  trustedKeys: readonly TrustedKey[],
): { readonly trust: TrustLevel; readonly reason?: string } {
  if (integrity.algorithm !== "sha256") {
    return { trust: "invalid", reason: "Unknown integrity algorithm." };
  }
  const digest = manifestDigest(manifest);
  if (digest !== integrity.digest) {
    return { trust: "invalid", reason: "The package content does not match its digest." };
  }
  if (integrity.signature === undefined) {
    return {
      trust: "unsigned",
      reason: "Community package: content intact, authorship unverified.",
    };
  }
  const key = trustedKeys.find((held) => held.keyId === integrity.signature?.keyId);
  if (key === undefined) {
    return { trust: "unsigned", reason: "Signed under a key Manu does not trust." };
  }
  if (hmacSha256(key.secret, digest) !== integrity.signature.value) {
    return { trust: "invalid", reason: "The signature does not verify under its named key." };
  }
  return { trust: "trusted" };
}
