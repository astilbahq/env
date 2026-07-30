import type { AggregateResult } from "./model.ts";
import type { ProcessTargetSchemas as CommonProcessTargetSchemas } from "./process-standard-schema.ts";
import {
  checkProcessTarget as checkCommonProcessTarget,
  createEnvironmentConfigurationError,
} from "./process.ts";
import type {
  ProcessSource as CommonProcessSource,
  ProcessTargetDefinition as CommonProcessTargetDefinition,
} from "./process.ts";
import { aggregateFailure, diagnostic } from "./results.ts";

export { EnvironmentConfigurationError } from "./process.ts";
export type { ProcessTargetSchemas } from "./process-standard-schema.ts";
export type { ProcessSource, ProcessTargetDefinition } from "./process.ts";
export type {
  StandardSchemaResult,
  StandardSchemaV1,
} from "./standard-schema.ts";

const unsupportedLifecycle = (): AggregateResult<never> =>
  aggregateFailure([diagnostic({ code: "ENV_CONTRACT_INVALID" })]);

export const checkProcessTarget = <const TConfiguration extends object>(
  definition: CommonProcessTargetDefinition,
  source: CommonProcessSource
): AggregateResult<TConfiguration> =>
  definition.lifecycle === "deployment"
    ? checkCommonProcessTarget<TConfiguration>(definition, source)
    : unsupportedLifecycle();

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Generated modules supply their frozen configuration type to this boundary.
export const loadProcessTarget = <const TConfiguration extends object>(
  definition: CommonProcessTargetDefinition,
  source: CommonProcessSource
): TConfiguration => {
  const result = checkProcessTarget<TConfiguration>(definition, source);
  if (!result.ok) {
    throw createEnvironmentConfigurationError(result.diagnostics);
  }
  return result.value;
};

// oxlint-disable-next-line eslint/require-await -- The common generated-module API returns a Promise for schema-backed checks.
export const checkProcessTargetWithSchemas = async <
  const TConfiguration extends object,
>(
  definition: CommonProcessTargetDefinition,
  source: CommonProcessSource,
  schemas: CommonProcessTargetSchemas
): Promise<AggregateResult<TConfiguration>> => {
  void schemas;
  return checkProcessTarget<TConfiguration>(definition, source);
};

export const loadProcessTargetWithSchemas = async <
  const TConfiguration extends object,
>(
  definition: CommonProcessTargetDefinition,
  source: CommonProcessSource,
  schemas: CommonProcessTargetSchemas
): Promise<TConfiguration> => {
  const result = await checkProcessTargetWithSchemas<TConfiguration>(
    definition,
    source,
    schemas
  );
  if (!result.ok) {
    throw createEnvironmentConfigurationError(result.diagnostics);
  }
  return result.value;
};
