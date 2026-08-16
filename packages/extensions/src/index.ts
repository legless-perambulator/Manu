export { ECOSYSTEM_VERSION, EXTENSION_CATEGORIES, ExtensionError } from "./types";
export type {
  CatalogueEntry,
  CataloguePort,
  EcosystemMetadata,
  ExtensionCategory,
  ExtensionContributions,
  ExtensionDependency,
  ExtensionDetails,
  ExtensionErrorCode,
  ExtensionManifest,
  ExtensionPackage,
  FileStorePort,
  InstalledExtension,
  PackageIntegrity,
  ProjectExtensionNeeds,
  TemplateContribution,
  TrustLevel,
} from "./types";
export {
  FIRST_PARTY_KEY_ID,
  manifestDigest,
  sha256Hex,
  signDigest,
  verifyIntegrity,
} from "./integrity";
export type { TrustedKey } from "./integrity";
export { ExtensionManager, EXTENSIONS_DIR, compareVersions } from "./manager";
export type { ManagerOptions } from "./manager";
export {
  FIRST_PARTY_PACKS,
  buildPackage,
  noirWritingPackManifest,
  publishExtension,
  staticCatalogue,
} from "./packs";
