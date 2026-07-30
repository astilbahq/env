import type {
  AggregateResult,
  CoreDiagnostic,
  CoreDiagnostics,
  LocalId,
  ProcessProjection,
  RawSourceName,
} from "./model.ts";
import { opaqueRefusalDiagnostics, resolveTarget } from "./resolution.ts";
import { aggregateFailure, cloneDiagnostics, diagnostic } from "./results.ts";
import { validateProcessTarget } from "./validation.ts";

export type ProcessSource = Readonly<Record<string, unknown>>;

export type ProcessTargetDefinition = Readonly<{
  bindings: readonly Readonly<{
    entry: LocalId;
    source: RawSourceName;
  }>[];
  generated: "astilba.env.generated-module/v1";
  lifecycle: "build" | "deployment" | "request";
  projection: ProcessProjection;
}>;

const CONSTRUCTION_TOKEN = Object.freeze({});
const ERROR_NAME = "EnvironmentConfigurationError";
const ERROR_MESSAGE = "Astilba Env configuration is invalid.";
const DIRECT_CONSTRUCTION_MESSAGE =
  "EnvironmentConfigurationError cannot be constructed directly.";

export class EnvironmentConfigurationError extends Error {
  declare readonly diagnostics: CoreDiagnostics;

  private constructor();
  private constructor(
    diagnostics?: readonly CoreDiagnostic[],
    token?: unknown
  ) {
    if (token !== CONSTRUCTION_TOKEN) {
      throw new TypeError(DIRECT_CONSTRUCTION_MESSAGE);
    }
    super(ERROR_MESSAGE);
    const owned = cloneDiagnostics(diagnostics ?? []);
    Object.defineProperties(this, {
      diagnostics: {
        configurable: false,
        enumerable: false,
        value: owned,
        writable: false,
      },
      message: {
        configurable: false,
        enumerable: false,
        value: ERROR_MESSAGE,
        writable: false,
      },
      name: {
        configurable: false,
        enumerable: false,
        value: ERROR_NAME,
        writable: false,
      },
    });
  }
}

export const createEnvironmentConfigurationError = (
  diagnostics: readonly CoreDiagnostic[]
): EnvironmentConfigurationError =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Reflect.construct is the private-constructor bridge; the construction token enforces the runtime invariant.
  Reflect.construct(EnvironmentConfigurationError, [
    diagnostics,
    CONSTRUCTION_TOKEN,
  ]) as EnvironmentConfigurationError;

export const checkProcessTarget = <const TConfiguration extends object>(
  definition: ProcessTargetDefinition,
  source: ProcessSource
): AggregateResult<TConfiguration> => {
  const validated = validateProcessTarget(definition);
  if (!validated.ok) {
    return aggregateFailure([diagnostic({ code: validated.code })]);
  }
  const opaque = opaqueRefusalDiagnostics(validated.target);
  if (opaque.length > 0) {
    return aggregateFailure(opaque);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The generated target's frozen type projection supplies TConfiguration after runtime validation.
  return resolveTarget(
    validated.target,
    source
  ) as AggregateResult<TConfiguration>;
};

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The generated module supplies the frozen configuration type at each load call.
export const loadProcessTarget = <const TConfiguration extends object>(
  definition: ProcessTargetDefinition,
  source: ProcessSource
): TConfiguration => {
  const result = checkProcessTarget<TConfiguration>(definition, source);
  if (!result.ok) {
    throw createEnvironmentConfigurationError(result.diagnostics);
  }
  return result.value;
};
