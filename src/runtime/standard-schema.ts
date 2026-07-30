import { copyOpaqueShapeValue } from "../core/shapes.ts";
import type { JsonValue } from "../core/types.ts";
import type { CodecDescriptor, OpaqueShape } from "./model.ts";

export type StandardSchemaResult<TOutput> =
  | Readonly<{
      issues: readonly unknown[];
      value?: never;
    }>
  | Readonly<{
      issues?: undefined;
      value: TOutput;
    }>;

export interface StandardSchemaV1<TInput = unknown, TOutput = TInput> {
  readonly "~standard": Readonly<{
    types?:
      | Readonly<{
          input: TInput;
          output: TOutput;
        }>
      | undefined;
    validate(
      value: unknown
    ): Promise<StandardSchemaResult<TOutput>> | StandardSchemaResult<TOutput>;
    vendor: string;
    version: 1;
  }>;
}

type OpaqueCodec = Extract<CodecDescriptor, { kind: "opaque" }>;

type StandardSchemaResolution =
  | Readonly<{
      code:
        | "ENV_INVALID_VALUE"
        | "ENV_MISSING_VALUE"
        | "ENV_VALIDATOR_ASYNC_UNSUPPORTED";
      ok: false;
    }>
  | Readonly<{
      ok: true;
      present: false;
    }>
  | Readonly<{
      ok: true;
      present: true;
      value: JsonValue;
    }>;

type StandardSchemaRuntimeOptions = Readonly<{
  codec: OpaqueCodec;
  input: string | undefined;
  required: boolean;
  schema: unknown;
}>;

const failure = (
  code:
    | "ENV_INVALID_VALUE"
    | "ENV_MISSING_VALUE"
    | "ENV_VALIDATOR_ASYNC_UNSUPPORTED"
): StandardSchemaResolution =>
  Object.freeze({
    code,
    ok: false as const,
  });

const missing = (): StandardSchemaResolution =>
  Object.freeze({
    ok: true as const,
    present: false as const,
  });

const success = (value: JsonValue): StandardSchemaResolution =>
  Object.freeze({
    ok: true as const,
    present: true as const,
    value,
  });

const ignorePromiseSettlement = (): undefined => undefined;

const observeThen = (
  candidate: object | ((...values: never[]) => unknown)
):
  | Readonly<{ invalid: true }>
  | Readonly<{ asynchronous: boolean; invalid: false }> => {
  let intrinsicPromise = false;
  try {
    // oxlint-disable-next-line promise/spec-only -- The frozen handshake requires the intrinsic Promise brand check before one ordinary then read.
    void Promise.prototype.then.call(
      candidate,
      ignorePromiseSettlement,
      ignorePromiseSettlement
    );
    intrinsicPromise = true;
  } catch {
    intrinsicPromise = false;
  }

  let then: unknown;
  try {
    then = Reflect.get(candidate, "then");
  } catch {
    return Object.freeze({ invalid: true as const });
  }
  return Object.freeze({
    asynchronous: intrinsicPromise || typeof then === "function",
    invalid: false as const,
  });
};

const copyOutput = (
  shape: OpaqueShape,
  value: unknown
): JsonValue | undefined => copyOpaqueShapeValue(shape, value);

export const resolveStandardSchemaRuntime = (
  options: StandardSchemaRuntimeOptions
): StandardSchemaResolution => {
  const optionalInput = options.codec.input.kind === "optional";
  if (options.input === undefined && !optionalInput) {
    return options.required ? failure("ENV_MISSING_VALUE") : missing();
  }
  if (options.input !== undefined && typeof options.input !== "string") {
    return failure("ENV_INVALID_VALUE");
  }

  try {
    if (
      (typeof options.schema !== "object" || options.schema === null) &&
      typeof options.schema !== "function"
    ) {
      return failure("ENV_INVALID_VALUE");
    }
    const standard: unknown = Reflect.get(options.schema, "~standard");
    if (typeof standard !== "object" || standard === null) {
      return failure("ENV_INVALID_VALUE");
    }
    const version: unknown = Reflect.get(standard, "version");
    const validate: unknown = Reflect.get(standard, "validate");
    if (version !== 1 || typeof validate !== "function") {
      return failure("ENV_INVALID_VALUE");
    }

    const candidate: unknown = Reflect.apply(validate, standard, [
      options.input,
    ]);
    if (
      (typeof candidate === "object" && candidate !== null) ||
      typeof candidate === "function"
    ) {
      const thenObservation = observeThen(candidate);
      if (thenObservation.invalid) {
        return failure("ENV_INVALID_VALUE");
      }
      if (thenObservation.asynchronous) {
        return failure("ENV_VALIDATOR_ASYNC_UNSUPPORTED");
      }
    }
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return failure("ENV_INVALID_VALUE");
    }
    const prototype: unknown = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) {
      return failure("ENV_INVALID_VALUE");
    }
    const issues = Object.getOwnPropertyDescriptor(candidate, "issues");
    const value = Object.getOwnPropertyDescriptor(candidate, "value");
    if (
      (issues !== undefined && !("value" in issues)) ||
      (value !== undefined && !("value" in value))
    ) {
      return failure("ENV_INVALID_VALUE");
    }
    if (
      (issues !== undefined && issues.value !== undefined) ||
      value === undefined
    ) {
      return failure("ENV_INVALID_VALUE");
    }
    const output = copyOutput(options.codec.output, value.value);
    if (output === undefined) {
      return options.required ? failure("ENV_MISSING_VALUE") : missing();
    }
    return success(output);
  } catch {
    return failure("ENV_INVALID_VALUE");
  }
};
