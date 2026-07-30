import type { AggregateResult, LocalId } from "./model.ts";
import type { ProcessSource, ProcessTargetDefinition } from "./process.ts";
import { createEnvironmentConfigurationError } from "./process.ts";
import { resolveTarget } from "./resolution.ts";
import { aggregateFailure, diagnostic } from "./results.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";
import { validateProcessTarget, validateSchemaMap } from "./validation.ts";

export type ProcessTargetSchemas = Readonly<
  Record<LocalId, StandardSchemaV1<unknown, unknown>>
>;

const contractFailure = (): AggregateResult<never> =>
  aggregateFailure([diagnostic({ code: "ENV_CONTRACT_INVALID" })]);

const checkProcessTargetWithSchemasSync = <const TConfiguration extends object>(
  definition: ProcessTargetDefinition,
  source: ProcessSource,
  schemas: ProcessTargetSchemas
): AggregateResult<TConfiguration> => {
  const validated = validateProcessTarget(definition);
  if (!validated.ok) {
    return aggregateFailure([diagnostic({ code: validated.code })]);
  }
  const expectedNames = validated.target.selected
    .filter((entry) => entry.codec.kind === "opaque")
    .map((entry) => entry.name);
  const validatedSchemas = validateSchemaMap(schemas, expectedNames);
  if (!validatedSchemas.ok) {
    return contractFailure();
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The generated target's frozen type projection supplies TConfiguration after runtime validation.
  return resolveTarget(
    validated.target,
    source,
    validatedSchemas.schemas
  ) as AggregateResult<TConfiguration>;
};

// oxlint-disable-next-line eslint/require-await -- Async is the frozen API guarantee that every outcome, including an unexpected throw, settles through a Promise.
export const checkProcessTargetWithSchemas = async <
  const TConfiguration extends object,
>(
  definition: ProcessTargetDefinition,
  source: ProcessSource,
  schemas: ProcessTargetSchemas
): Promise<AggregateResult<TConfiguration>> =>
  checkProcessTargetWithSchemasSync<TConfiguration>(
    definition,
    source,
    schemas
  );

export const loadProcessTargetWithSchemas = async <
  const TConfiguration extends object,
>(
  definition: ProcessTargetDefinition,
  source: ProcessSource,
  schemas: ProcessTargetSchemas
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
