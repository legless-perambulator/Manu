import { manifestDigest, signDigest, sha256Hex, type TrustedKey } from "@jellytind/extensions";

/**
 * Application updates (Phase 46 §16–§17).
 *
 * The client half of a safe update pipeline: fetch a channel manifest,
 * verify its signature against the keys this build trusts, compare
 * versions, and *tell the writer* — download and installation go through
 * the platform's own signed artifact (AppImage/installer), never a silent
 * in-place patch. Three channels exist — stable, beta, alpha — and stable
 * is the default: nobody is forced onto development builds.
 *
 * Everything here is pure and offline-tolerant. A failed check is "could
 * not check", never an error dialog in the writer's face, and never a
 * blocked launch (§16 of the extensions phase holds here too).
 */

export const UPDATE_CHANNELS = ["stable", "beta", "alpha"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

const CHANNEL_KEY = "manu.update-channel";

export function loadUpdateChannel(): UpdateChannel {
  const held = window.localStorage.getItem(CHANNEL_KEY);
  return held === "beta" || held === "alpha" ? held : "stable";
}

export function saveUpdateChannel(channel: UpdateChannel): void {
  window.localStorage.setItem(CHANNEL_KEY, channel);
}

export interface ChannelRelease {
  readonly version: string;
  readonly notes: string;
  /** Where the platform artifact lives. Opened, not silently executed. */
  readonly url: string;
  /** SHA-256 of the artifact, printed for manual verification. */
  readonly artifactSha256: string;
}

export interface UpdateManifest {
  readonly kind: "manu-updates";
  readonly channels: Partial<Record<UpdateChannel, ChannelRelease>>;
  readonly signature?: { readonly keyId: string; readonly value: string };
}

export type UpdateVerdict =
  | { readonly state: "current"; readonly version: string }
  | {
      readonly state: "available";
      readonly release: ChannelRelease;
      readonly trusted: boolean;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export function compareAppVersions(a: string, b: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/**
 * Judge a fetched update manifest. Pure: no network, no side effects. The
 * signature covers the digest of the channels object, so a tampered notes
 * field or swapped URL fails verification; an unsigned manifest still
 * *reports* but is marked untrusted and the interface says so.
 */
export function evaluateUpdateManifest(
  raw: string,
  options: {
    readonly currentVersion: string;
    readonly channel: UpdateChannel;
    readonly trustedKeys: readonly TrustedKey[];
  },
): UpdateVerdict {
  let manifest: UpdateManifest;
  try {
    manifest = JSON.parse(raw) as UpdateManifest;
  } catch {
    return { state: "unavailable", reason: "The update feed could not be read." };
  }
  if (manifest.kind !== "manu-updates" || typeof manifest.channels !== "object") {
    return { state: "unavailable", reason: "The update feed is not a Manu update manifest." };
  }
  const release = manifest.channels[options.channel];
  if (release === undefined) {
    return { state: "unavailable", reason: `No ${options.channel} release is published.` };
  }
  if (!/^\d+(?:\.\d+){0,2}$/.test(release.version) || !release.url.startsWith("https://")) {
    return { state: "unavailable", reason: "The published release is malformed." };
  }

  let trusted = false;
  if (manifest.signature !== undefined) {
    const digest = manifestDigest(manifest.channels as never);
    const key = options.trustedKeys.find((held) => held.keyId === manifest.signature?.keyId);
    if (key !== undefined) {
      const expected = signDigest(digest, key);
      if (expected?.value !== manifest.signature.value) {
        return { state: "unavailable", reason: "The update feed's signature does not verify." };
      }
      trusted = true;
    }
  }

  if (compareAppVersions(release.version, options.currentVersion) <= 0) {
    return { state: "current", version: options.currentVersion };
  }
  return { state: "available", release, trusted };
}

/** Build a signed update manifest — the release pipeline's half, tested here. */
export function buildUpdateManifest(
  channels: UpdateManifest["channels"],
  sign?: TrustedKey,
): string {
  const manifest: UpdateManifest = {
    kind: "manu-updates",
    channels,
    ...(sign !== undefined
      ? { signature: signDigest(manifestDigest(channels as never), sign) }
      : {}),
  };
  return JSON.stringify(manifest, null, 2);
}

/** The artifact-hash line release notes print, for manual verification. */
export function artifactHashLine(name: string, bytes: Uint8Array): string {
  return `${sha256Hex(new TextDecoder("latin1").decode(bytes))}  ${name}`;
}
