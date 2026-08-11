import { NotImplementedError } from "@jellytind/shared";
import { parseModelJson, type LanguageModel } from "./model";
import type {
  GenerateRequest,
  GenerateResult,
  StreamEvent,
  StructuredRequest,
  ToolCallRequest,
  ToolCallResult,
} from "./types";

export interface EchoModelOptions {
  /**
   * Fixed text to return. If omitted, the model echoes the content of the last
   * user message — deterministic and dependency-free, ideal for tests and for
   * exercising the router without any network access.
   */
  readonly reply?: string;
  readonly id?: string;
}

/** Rough token estimate (~4 chars/token). For test/telemetry plumbing only. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * A deterministic, offline {@link LanguageModel} test double. It implements the
 * generate / stream / structured paths so the router, agent runtime and
 * structured-output validation can be tested without a provider. Tool calling
 * is intentionally not implemented here.
 */
export class EchoModel implements LanguageModel {
  readonly id: string;
  private readonly reply: string | undefined;

  constructor(options: EchoModelOptions = {}) {
    this.id = options.id ?? "echo:test";
    this.reply = options.reply;
  }

  private resolveText(request: GenerateRequest): string {
    if (this.reply !== undefined) return this.reply;
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return lastUser?.content ?? "";
  }

  generate(request: GenerateRequest): Promise<GenerateResult> {
    const text = this.resolveText(request);
    const inputTokens = estimateTokens(
      (request.system ?? "") + request.messages.map((m) => m.content).join(""),
    );
    return Promise.resolve({
      text,
      usage: { inputTokens, outputTokens: estimateTokens(text) },
      stopReason: "stop",
    });
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    const result = await this.generate(request);
    // Emit in small chunks to exercise streaming consumers.
    for (let i = 0; i < result.text.length; i += 8) {
      yield { type: "text-delta", delta: result.text.slice(i, i + 8) };
    }
    yield { type: "done", usage: result.usage, stopReason: result.stopReason };
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const { text } = await this.generate(request);
    return parseModelJson(request.schema, text);
  }

  generateWithTools(_request: ToolCallRequest): Promise<ToolCallResult> {
    return Promise.reject(new NotImplementedError("EchoModel.generateWithTools"));
  }
}
