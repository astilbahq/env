/* oxlint-disable typescript/no-unsafe-type-assertion -- The frozen browser API requires this exact guarded error class and private construction path. */

export type BootstrapFailureCode =
  | "BOOTSTRAP_AUDIENCE_MISMATCH"
  | "BOOTSTRAP_BODY_READ_FAILED"
  | "BOOTSTRAP_BODY_TOO_LARGE"
  | "BOOTSTRAP_CONTRACT_MISMATCH"
  | "BOOTSTRAP_DUPLICATE_KEY"
  | "BOOTSTRAP_FETCH_FAILED"
  | "BOOTSTRAP_FIELD_INVALID"
  | "BOOTSTRAP_FIELD_MISSING"
  | "BOOTSTRAP_FINAL_ORIGIN_MISMATCH"
  | "BOOTSTRAP_GENERATED_FORMAT_UNSUPPORTED"
  | "BOOTSTRAP_HTTP_STATUS_INVALID"
  | "BOOTSTRAP_INVALID_JSON"
  | "BOOTSTRAP_INVALID_MIME"
  | "BOOTSTRAP_INVALID_UTF8"
  | "BOOTSTRAP_JSON_TOO_DEEP"
  | "BOOTSTRAP_JSON_TOO_MANY_KEYS"
  | "BOOTSTRAP_LIFECYCLE_MISMATCH"
  | "BOOTSTRAP_NON_PORTABLE_JSON"
  | "BOOTSTRAP_PROJECTION_INVALID"
  | "BOOTSTRAP_PROJECTION_MISMATCH"
  | "BOOTSTRAP_PROTOCOL_UNSUPPORTED"
  | "BOOTSTRAP_REDIRECTED"
  | "BOOTSTRAP_REQUEST_ORIGIN_MISMATCH"
  | "BOOTSTRAP_UNKNOWN_FIELD"
  | "BOOTSTRAP_VALUE_INVALID"
  | "BOOTSTRAP_VALUE_MISSING";

const CONSTRUCTION_TOKEN = Object.freeze({});
const DIRECT_CONSTRUCTION_MESSAGE =
  "BootstrapFailure cannot be constructed directly.";

export class BootstrapFailure extends Error {
  declare readonly code: BootstrapFailureCode;

  private constructor();
  private constructor(token?: unknown, code?: BootstrapFailureCode) {
    super(code);
    if (token !== CONSTRUCTION_TOKEN || code === undefined) {
      throw new TypeError(DIRECT_CONSTRUCTION_MESSAGE);
    }
    Object.defineProperties(this, {
      code: {
        configurable: false,
        enumerable: true,
        value: code,
        writable: false,
      },
      message: {
        configurable: false,
        enumerable: false,
        value: code,
        writable: false,
      },
      name: {
        configurable: false,
        enumerable: false,
        value: "BootstrapFailure",
        writable: false,
      },
    });
  }
}

type BootstrapFailureConstructor = new (
  token: unknown,
  code: BootstrapFailureCode
) => BootstrapFailure;

export const bootstrapFailure = (
  code: BootstrapFailureCode
): BootstrapFailure =>
  Reflect.construct(
    BootstrapFailure as unknown as BootstrapFailureConstructor,
    [CONSTRUCTION_TOKEN, code]
  );
