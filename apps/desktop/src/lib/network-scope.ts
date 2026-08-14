/**
 * What the packaged application is permitted to talk to.
 *
 * The real allowlist lives in `src-tauri/capabilities/default.json` and is
 * enforced by the Rust host — this is a mirror of it, kept here for one reason:
 * so a writer who types an address the packaged build cannot reach is told
 * *that*, before the request, instead of being handed a bare network failure
 * afterwards. The audit found the shipped allowlist permitted exactly one host,
 * which meant a correctly written adapter still failed after packaging
 * (MANU-005).
 *
 * If the two ever drift, the host wins: this file can only be over-cautious,
 * never over-permissive, because it refuses nothing the host would allow
 * without also being wrong in the safe direction.
 */

/** Hosts reachable on any port, because they are this machine. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Ports reachable on *any* host.
 *
 * Deliberately short, and deliberately only ports that belong to a model
 * server. A GPU box on the far side of the house is the normal case for anyone
 * running local models, so restricting local providers to `localhost` would
 * quietly exclude them — but "any port on any host" is a general-purpose
 * outbound channel, and this application has no business asking for one.
 */
export const REMOTE_MODEL_PORTS: readonly number[] = [
  11434, // Ollama
  1234, // LM Studio
];

/** Hosted providers, allowed by name. */
const HOSTED_HOSTS = new Set([
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
]);

/**
 * Why the packaged application will not be able to reach an address, or `null`.
 *
 * Returns `null` for anything malformed too: an unparsable URL is the
 * adapter's problem to report, and duplicating that judgement here would be two
 * places to disagree.
 */
export function outOfScopeReason(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Manu can only connect over http or https, not "${url.protocol.replace(":", "")}".`;
  }

  const host = url.hostname.toLowerCase();
  if (HOSTED_HOSTS.has(host) || LOOPBACK.has(host)) return null;

  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (REMOTE_MODEL_PORTS.includes(port)) return null;

  return (
    `The packaged application is only allowed to reach model servers on this machine, ` +
    `or on port ${REMOTE_MODEL_PORTS.join(" or ")} elsewhere on your network. ` +
    `Port ${String(port)} on ${host} is outside that. This is a deliberate restriction: ` +
    `Manu asks the operating system for the narrowest network access it can work with.`
  );
}
