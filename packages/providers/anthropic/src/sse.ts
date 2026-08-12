/**
 * Server-Sent Events parsing for Anthropic's streaming Messages API. Pure and
 * dependency-free so it can be unit-tested against canned SSE text with no
 * network. Private to the adapter — SSE frames never cross the boundary.
 */

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

/**
 * Turn a stream of decoded text chunks into complete SSE events. Handles frames
 * split across chunk boundaries by buffering until a blank line terminates each
 * event.
 */
export async function* parseSseStream(chunks: AsyncIterable<string>): AsyncIterable<SseEvent> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseFrame(frame);
      if (event !== null) yield event;
      boundary = buffer.indexOf("\n\n");
    }
  }
  const tail = parseFrame(buffer);
  if (tail !== null) yield tail;
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/** Read a `ReadableStream` or async-iterable of bytes as decoded text chunks. */
export async function* decodeByteStream(
  body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  if (Symbol.asyncIterator in body) {
    for await (const bytes of body as AsyncIterable<Uint8Array>) {
      yield decoder.decode(bytes, { stream: true });
    }
  } else {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) yield decoder.decode(value, { stream: true });
    }
  }
  const flushed = decoder.decode();
  if (flushed !== "") yield flushed;
}
