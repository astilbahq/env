export type Lifecycle = "build" | "deployment" | "request";
// oxlint-disable-next-line sonarjs/redundant-type-aliases -- The frozen public declarations name contract identifiers explicitly.
type ContractId = string;
// oxlint-disable-next-line sonarjs/redundant-type-aliases -- The frozen public declarations name local identifiers explicitly.
export type LocalId = string;
// oxlint-disable-next-line sonarjs/redundant-type-aliases -- The frozen public declarations distinguish raw source names from local identifiers.
export type RawSourceName = string;

export type EntryIdentity = readonly [fragmentId: string, localEntryId: string];

export type PortableShape =
  | Readonly<{ kind: "boolean" }>
  | Readonly<{ kind: "null" }>
  | Readonly<{
      kind: "safe-integer";
      maximum: number;
      minimum: number;
    }>
  | Readonly<{ kind: "string" }>
  | Readonly<{
      items: PortableShape;
      kind: "array";
      maximumItems: number;
      minimumItems: number;
    }>
  | Readonly<{
      kind: "object";
      properties: readonly Readonly<{
        name: string;
        required: boolean;
        shape: PortableShape;
      }>[];
    }>;

export type OpaqueShape =
  | PortableShape
  | Readonly<{ kind: "optional"; value: PortableShape }>;

export type OpaqueInputShape =
  | Readonly<{ kind: "string" }>
  | Readonly<{
      kind: "optional";
      value: Readonly<{ kind: "string" }>;
    }>;

export type CodecDescriptor =
  | Readonly<{
      abi: "astilba.env.string-code-point/v1";
      kind: "string";
      maxCodePoints: number;
      minCodePoints: number;
    }>
  | Readonly<{
      abi: "astilba.env.origin-ascii/v1";
      kind: "origin";
    }>
  | Readonly<{
      abi: "astilba.env.enum/v1";
      kind: "enum";
      values: readonly string[];
    }>
  | Readonly<{
      abi: "astilba.env.boolean-exact/v1";
      blank: "invalid" | "missing";
      falseInput: string;
      kind: "boolean";
      trueInput: string;
    }>
  | Readonly<{
      abi: "astilba.env.safe-integer-decimal/v1";
      blank: "invalid" | "missing";
      kind: "safe-integer";
      maximum: number;
      minimum: number;
    }>
  | Readonly<{
      abi: "astilba.env.string-list-comma/v1";
      emptyItems: "drop" | "invalid";
      kind: "string-list";
      maximumItemCodePoints: number;
      maximumItems: number;
      minimumItemCodePoints: number;
      minimumItems: number;
      separator: ",";
    }>
  | Readonly<{
      abi: "astilba.env.json-exact/v1";
      blank: "invalid" | "missing";
      kind: "json";
      shape: PortableShape;
    }>
  | Readonly<{
      abi: "astilba.env.text/v1";
      blank: "invalid" | "missing";
      kind: "text";
      maxCodePoints: number;
      minCodePoints: number;
      normalise: "preserve" | "trim";
    }>
  | Readonly<{
      abi: "astilba.env.integer/v1";
      blank: "invalid" | "missing";
      default: null;
      kind: "integer";
      maximum: number;
      minimum: number;
    }>
  | Readonly<{
      abi: "astilba.env.opaque/v1";
      input: OpaqueInputShape;
      kind: "opaque";
      output: OpaqueShape;
      revision: string;
      semantics: string;
    }>;

type BrowserPortableCodecDescriptor = Exclude<
  CodecDescriptor,
  | Readonly<{ kind: "integer" }>
  | Readonly<{ kind: "opaque" }>
  | Readonly<{ kind: "text" }>
>;

export type PresentTogetherRule = Readonly<{
  abi: "astilba.env.present-together/v1";
  entries: readonly EntryIdentity[];
  id: LocalId;
  kind: "present-together";
}>;

export type PublicProjectionEntry = Readonly<{
  codec: BrowserPortableCodecDescriptor;
  identity: EntryIdentity;
  lifecycle: Lifecycle;
  name: LocalId;
  required: boolean;
}>;

export type ServerProjectionEntry = Readonly<{
  codec: CodecDescriptor;
  identity: EntryIdentity;
  lifecycle: Lifecycle;
  name: LocalId;
  required: boolean;
  visibility: "private" | "public";
}>;

type ProjectionBase = Readonly<{
  canonicalisation: "astilba.jcs/v1";
  codecAbi: "astilba.env.codec/v1";
  consumer: LocalId;
  contract: ContractId;
  format: "astilba.env.projection";
  projectionAbi: "astilba.env.projection/v1";
}>;

type PublicProjectionV1 = ProjectionBase &
  Readonly<{
    entries: readonly PublicProjectionEntry[];
    formatVersion: 1;
    kind: "public";
  }>;

type ServerProjectionV1 = ProjectionBase &
  Readonly<{
    entries: readonly ServerProjectionEntry[];
    formatVersion: 1;
    kind: "server";
  }>;

type ServerProjectionV2 = ProjectionBase &
  Readonly<{
    entries: readonly ServerProjectionEntry[];
    formatVersion: 2;
    kind: "server";
    rules: readonly PresentTogetherRule[];
  }>;

export type ProcessProjection =
  | PublicProjectionV1
  | ServerProjectionV1
  | ServerProjectionV2;

export type CoreDiagnostic =
  | Readonly<{
      code: "ENV_CONTRACT_INVALID" | "ENV_FORMAT_UNSUPPORTED";
    }>
  | Readonly<{
      code: "ENV_SOURCE_INVALID";
      consumer: LocalId;
    }>
  | Readonly<{
      code: "ENV_INVALID_VALUE" | "ENV_MISSING_VALUE";
      codec: CodecDescriptor["abi"];
      consumer: LocalId;
      entry: LocalId;
      lifecycle: Lifecycle;
    }>
  | Readonly<{
      code: "ENV_OPAQUE_UNSUPPORTED" | "ENV_VALIDATOR_ASYNC_UNSUPPORTED";
      codec: "astilba.env.opaque/v1";
      consumer: LocalId;
      entry: LocalId;
      lifecycle: "deployment" | "request";
    }>
  | Readonly<{
      code: "ENV_RULE_VIOLATION";
      consumer: LocalId;
      entries: readonly LocalId[];
      lifecycle: Lifecycle;
      rule: LocalId;
    }>;

export type CoreDiagnostics = readonly [CoreDiagnostic, ...CoreDiagnostic[]];

export type AggregateFailure = Readonly<{
  diagnostics: CoreDiagnostics;
  ok: false;
}>;

export type Success<TValue> = Readonly<{
  ok: true;
  value: TValue;
}>;

export type AggregateResult<TValue> = AggregateFailure | Success<TValue>;

export type OwnedConfiguration = Readonly<Record<string, unknown>>;

export type NormalizedTarget = Readonly<{
  bindings: readonly Readonly<{
    entry: LocalId;
    source: RawSourceName;
  }>[];
  generated: "astilba.env.generated-module/v1";
  lifecycle: Lifecycle;
  projection: ProcessProjection;
  selected: readonly (PublicProjectionEntry | ServerProjectionEntry)[];
}>;
