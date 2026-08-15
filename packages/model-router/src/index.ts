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

export { instrumentModel } from "./instrument";

export { MockLanguageModel } from "./mock-model";
export type { MockBehavior } from "./mock-model";

export {
  QUALITY_TIERS,
  SPEED_TIERS,
  PRIVACY_CLASSES,
  AVAILABILITY_STATES,
  AVAILABLE,
  profileKey,
  profileFromDescriptor,
} from "./profile";
export type {
  QualityTier,
  SpeedTier,
  PrivacyClass,
  AvailabilityState,
  ModelAvailability,
  ModelPricing,
  ModelProfile,
} from "./profile";

export {
  WORK_PURPOSES,
  ROUTED_OPERATIONS,
  OPERATION_REQUIREMENTS,
  requirementsFor,
} from "./requirements";
export type {
  WorkPurpose,
  RoutedOperation,
  RequirementLevel,
  OperationRequirements,
} from "./requirements";

export { ROUTING_POLICY_IDS, FALLBACK_BEHAVIOURS, ROUTING_POLICIES, routingPolicy } from "./policy";
export type { RoutingPolicyId, FallbackBehaviour, FallbackPolicy, RoutingPolicy } from "./policy";

export { CONTENT_CLASSES, ALLOW_CLOUD, privacyRefusal } from "./privacy";
export type { ContentClass, PrivacyRule, PrivacyPolicy } from "./privacy";

export { checkBudget, needsApproval } from "./budget";
export type { BudgetLimit, BudgetLimits, BudgetSpend, BudgetVerdict } from "./budget";

export { routeOperation, planRoutes, defaultContentClass } from "./engine";
export type { RouteContext, RouteInputs, RouteExclusion, RouteDecision, RoutePlan } from "./engine";

export {
  costOfUsage,
  usageRecordFor,
  summariseUsage,
  usageSince,
  monthlySpend,
  formatApiCost,
  formatCostSummary,
  estimateOperationCost,
  formatCostRange,
} from "./usage";
export type { CostAmount, UsageRecord, UsageSummary, CostRange } from "./usage";
