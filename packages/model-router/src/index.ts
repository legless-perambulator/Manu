export type {
  MessageRole,
  ModelMessage,
  ModelCapabilities,
  RequestOptions,
  GenerateRequest,
  GenerateResult,
  StopReason,
  TokenUsage,
  StreamEvent,
  OutputSchema,
  StructuredRequest,
  ToolDefinition,
  ToolCallRequest,
  ToolCall,
  ToolCallResult,
} from "./types";

export type { LanguageModel } from "./model";
export { parseModelJson } from "./model";

export { ModelError, unsupportedCapability } from "./errors";
export type { ModelErrorCode } from "./errors";

export { ModelRegistry, describeModel, capabilityState, capabilityRefusal } from "./registry";
export type { ModelDescriptor, CostMetadata, CapabilityState } from "./registry";

export { ProviderRegistry, AUTH_METHODS } from "./provider";
export type {
  ModelProvider,
  ProviderCredentials,
  ProviderDescriptor,
  ConnectionTestResult,
  AuthMethod,
} from "./provider";

export { InMemorySecretStore, secretKeyForProvider } from "./secrets";
export type { SecretStore } from "./secrets";

export { ModelRouter, ModelRoutingError } from "./router";
export type { ModelTask, ModelRouterOptions } from "./router";

export { MockLanguageModel } from "./mock-model";
export type { MockBehavior } from "./mock-model";
