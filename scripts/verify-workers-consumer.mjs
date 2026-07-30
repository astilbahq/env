// @ts-check
/// <reference types="node" />

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertCleanArchiveInstall,
  createConsumer,
  fail,
  installArchive,
  readArtifact,
  removeConsumer,
  run,
  runResult,
} from "./matrix-artifact.mjs";

const COMPATIBILITY_DATE = "2026-07-29";
const PUBLIC_ORIGIN_SOURCE_CANARY =
  "https://astilba-env-workers-source-canary.example";
const WRANGLER_VERSION = "4.115.0";

const environmentDefinition = [
  'import { defineEnvironment, env } from "@astilba/env";',
  "",
  "export default defineEnvironment({",
  '  id: "com.example.workersarchive",',
  "  consumers: {",
  '    buildBoundary: env.server(["buildLabel"]),',
  '    opaqueBoundary: env.server(["opaqueValue"]),',
  '    requestBoundary: env.server(["requestLabel"]),',
  '    worker: env.server(["featureEnabled", "publicOrigin", "workerSecret"]),',
  "  },",
  "  entries: {",
  "    buildLabel: env.public.build.string(),",
  "    featureEnabled: env.public.deployment.boolean(),",
  "    opaqueValue: env.private.deployment.opaque({",
  '      input: { kind: "string" },',
  '      output: { kind: "string" },',
  '      revision: "1",',
  '      semantics: "example/opaque@1",',
  "    }),",
  "    publicOrigin: env.public.deployment.origin(),",
  "    requestLabel: env.public.request.string(),",
  "    workerSecret: env.private.deployment.secret(),",
  "  },",
  "  targets: {",
  '    buildBoundary: env.process("buildBoundary", {',
  '      buildLabel: "BUILD_LABEL",',
  "    }),",
  '    opaqueBoundary: env.process("opaqueBoundary", {',
  '      opaqueValue: "OPAQUE_VALUE",',
  "    }),",
  '    requestBoundary: env.process("requestBoundary", {',
  '      requestLabel: "REQUEST_LABEL",',
  "    }),",
  '    selectedCapabilityDeployment: env.process("worker", {',
  '      featureEnabled: "FEATURE_ENABLED",',
  '      publicOrigin: "SELECTED_KV",',
  '      workerSecret: "WORKER_SECRET",',
  "    }),",
  '    workerDeployment: env.process("worker", {',
  '      featureEnabled: "FEATURE_ENABLED",',
  '      publicOrigin: "PUBLIC_ORIGIN",',
  '      workerSecret: "WORKER_SECRET",',
  "    }),",
  "  },",
  "});",
  "",
].join("\n");

const workerSource = [
  'import type { StandardSchemaV1 } from "@astilba/env/runtime";',
  'import { check as checkBuildBoundary } from "../.astilba/env/buildBoundary.server";',
  'import { check as checkOpaqueBoundary } from "../.astilba/env/opaqueBoundary.server";',
  'import { check as checkRequestBoundary } from "../.astilba/env/requestBoundary.server";',
  'import { check as checkSelectedCapability } from "../.astilba/env/selectedCapabilityDeployment.server";',
  'import { load } from "../.astilba/env/workerDeployment.server";',
  "",
  "type RefusalResult =",
  "  | Readonly<{ ok: true }>",
  "  | Readonly<{",
  "      diagnostics: readonly Readonly<{ code: string }>[];",
  "      ok: false;",
  "    }>;",
  "",
  "const unreadableSource = () => {",
  "  let bindingReads = 0;",
  "  return {",
  "    bindingReads: () => bindingReads,",
  "    source: new Proxy(",
  "      {},",
  "      {",
  "        getOwnPropertyDescriptor() {",
  "          bindingReads += 1;",
  '          throw new Error("A refused target read its source.");',
  "        },",
  "      }",
  "    ),",
  "  };",
  "};",
  "",
  "const refusalResponse = (",
  "  result: RefusalResult,",
  "  bindingReads: number,",
  "  validatorCalls = 0",
  "): Response =>",
  "  Response.json({",
  "    bindingReads,",
  "    codes: result.ok ? [] : result.diagnostics.map((item) => item.code),",
  "    ok: result.ok,",
  "    validatorCalls,",
  "  });",
  "",
  "export default {",
  "  async fetch(request: Request, env: Env): Promise<Response> {",
  "    const pathname = new URL(request.url).pathname;",
  '    if (pathname === "/build-boundary") {',
  "      const unreadable = unreadableSource();",
  "      const result = checkBuildBoundary(unreadable.source);",
  "      return refusalResponse(result, unreadable.bindingReads());",
  "    }",
  '    if (pathname === "/request-boundary") {',
  "      const unreadable = unreadableSource();",
  "      const result = checkRequestBoundary(unreadable.source);",
  "      return refusalResponse(result, unreadable.bindingReads());",
  "    }",
  '    if (pathname === "/opaque-boundary") {',
  "      const unreadable = unreadableSource();",
  "      let validatorCalls = 0;",
  "      const opaqueValue: StandardSchemaV1<string, string> = {",
  '        "~standard": {',
  "          validate(value: unknown) {",
  "            validatorCalls += 1;",
  '            return typeof value === "string"',
  "              ? { value }",
  "              : { issues: [] };",
  "          },",
  '          vendor: "fixture",',
  "          version: 1,",
  "        },",
  "      };",
  "      const result = await checkOpaqueBoundary(unreadable.source, {",
  "        opaqueValue,",
  "      });",
  "      return refusalResponse(",
  "        result,",
  "        unreadable.bindingReads(),",
  "        validatorCalls",
  "      );",
  "    }",
  '    if (pathname === "/selected-capability") {',
  "      const result = checkSelectedCapability(env);",
  "      return Response.json({",
  "        codes: result.ok",
  "          ? []",
  "          : result.diagnostics.map((item) => item.code),",
  "        ok: result.ok,",
  "      });",
  "    }",
  "    const configuration = load(env);",
  "    return Response.json({",
  "      featureEnabled: configuration.featureEnabled,",
  "      publicOrigin: configuration.publicOrigin,",
  "      secretConfigured: configuration.workerSecret.length > 0,",
  "    });",
  "  },",
  "} satisfies ExportedHandler<Env>;",
  "",
].join("\n");

const harnessSource = [
  'import { createHash } from "node:crypto";',
  'import { readFile } from "node:fs/promises";',
  'import { createTestHarness } from "wrangler";',
  "",
  'const artifactPath = new URL("./worker-artifact/index.js", import.meta.url);',
  "const artifactDigest = async () =>",
  '  createHash("sha256").update(await readFile(artifactPath)).digest("hex");',
  "const initialArtifact = await artifactDigest();",
  "",
  "const runBindingSet = async (bindingSet) => {",
  "  const server = createTestHarness({",
  "    root: process.cwd(),",
  "    workers: [",
  "      {",
  '        configPath: "./wrangler.harness.jsonc",',
  "        secrets: { WORKER_SECRET: bindingSet.secret },",
  "        vars: {",
  "          FEATURE_ENABLED: bindingSet.featureEnabled,",
  "          PUBLIC_ORIGIN: bindingSet.publicOrigin,",
  "        },",
  "      },",
  "    ],",
  "  });",
  "  try {",
  "    await server.listen();",
  "    const worker = server.getWorker();",
  "    const env = await worker.getEnv();",
  '    await env.UNRELATED_KV.put("admission-canary", bindingSet.canary);',
  "",
  '    const response = await server.fetch("https://worker.example/");',
  "    const responseText = await response.text();",
  "    if (!response.ok || responseText.includes(bindingSet.secret)) {",
  '      throw new Error("Worker response failed or disclosed a test-only secret.");',
  "    }",
  "    const body = JSON.parse(responseText);",
  "    if (",
  '      body.featureEnabled !== (bindingSet.featureEnabled === "true") ||',
  "      body.publicOrigin !== bindingSet.publicOrigin ||",
  "      body.secretConfigured !== true",
  "    ) {",
  '      throw new Error("Worker did not resolve the supplied deployment binding set.");',
  "    }",
  "",
  "    const capabilityResponse = await server.fetch(",
  '      "https://worker.example/selected-capability"',
  "    );",
  "    const capabilityBody = await capabilityResponse.json();",
  "    if (",
  "      !capabilityResponse.ok ||",
  "      capabilityBody.ok !== false ||",
  "      JSON.stringify(capabilityBody.codes) !==",
  '        JSON.stringify(["ENV_SOURCE_INVALID"])',
  "    ) {",
  '      throw new Error("A selected non-string capability binding was accepted.");',
  "    }",
  "",
  "    for (const [path, expectedCode] of [",
  '      ["/build-boundary", "ENV_CONTRACT_INVALID"],',
  '      ["/request-boundary", "ENV_CONTRACT_INVALID"],',
  '      ["/opaque-boundary", "ENV_OPAQUE_UNSUPPORTED"],',
  "    ]) {",
  "      const refusalResponse = await server.fetch(",
  '        "https://worker.example" + path',
  "      );",
  "      const refusal = await refusalResponse.json();",
  "      if (",
  "        !refusalResponse.ok ||",
  "        refusal.ok !== false ||",
  "        refusal.bindingReads !== 0 ||",
  "        refusal.validatorCalls !== 0 ||",
  "        JSON.stringify(refusal.codes) !== JSON.stringify([expectedCode])",
  "      ) {",
  '        throw new Error("A workerd runtime boundary executed a refused target.");',
  "      }",
  "    }",
  "",
  "    if (",
  '      (await env.UNRELATED_KV.get("admission-canary")) !== bindingSet.canary',
  "    ) {",
  '      throw new Error("The unselected KV binding was mutated by the Worker.");',
  "    }",
  "    if ((await artifactDigest()) !== initialArtifact) {",
  '      throw new Error("The Worker artifact changed between binding sets.");',
  "    }",
  "  } finally {",
  "    await server.close();",
  "  }",
  "};",
  "",
  "await runBindingSet({",
  '  canary: "untouched-a",',
  '  featureEnabled: "true",',
  '  publicOrigin: "https://deployment-a.example",',
  '  secret: "test-only-placeholder-a",',
  "});",
  "await runBindingSet({",
  '  canary: "untouched-b",',
  '  featureEnabled: "false",',
  '  publicOrigin: "https://deployment-b.example",',
  '  secret: "test-only-placeholder-b",',
  "});",
  "",
  "process.stdout.write(",
  '  JSON.stringify({ artifact: initialArtifact, bindingSets: 2, passed: true }) + "\\n"',
  ");",
  "",
].join("\n");

const rejectedImports = Object.freeze({
  browser: Object.freeze({
    importedName: "loadBrowserBootstrap",
    specifier: "@astilba/env/browser",
  }),
  root: Object.freeze({
    importedName: "defineEnvironment",
    specifier: "@astilba/env",
  }),
  vite: Object.freeze({
    importedName: "astilbaEnvBrowserBoundary",
    specifier: "@astilba/env/vite",
  }),
});

/**
 * @param {unknown} value
 * @returns {value is { artifact: string, bindingSets: 2, passed: true }}
 */
const isHarnessResult = (value) =>
  typeof value === "object" &&
  value !== null &&
  "artifact" in value &&
  typeof value.artifact === "string" &&
  "bindingSets" in value &&
  value.bindingSets === 2 &&
  "passed" in value &&
  value.passed === true;

/**
 * @param {string} source
 * @returns {{ artifact: string, bindingSets: 2, passed: true }}
 */
const parseHarnessResult = (source) => {
  /** @type {unknown} */
  const value = JSON.parse(source);
  return isHarnessResult(value)
    ? value
    : fail("The workerd harness did not return exact evidence.");
};

/** @param {string} path */
const portablePath = (path) => path.split(sep).join("/");

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
const collectFiles = async (directory) => {
  /** @type {string[]} */
  const files = [];
  /** @param {string} current */
  const visit = async (current) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        fail("Wrangler output contains an unsupported filesystem node.");
      }
    }
  };
  await visit(directory);
  // oxlint-disable-next-line unicorn/no-array-sort -- The local accumulator has no aliases and is returned immediately.
  return files.sort();
};

/**
 * @param {string} main
 * @param {boolean} noBundle
 */
const wranglerConfiguration = (main, noBundle) => ({
  $schema: "./node_modules/wrangler/config-schema.json",
  compatibility_date: COMPATIBILITY_DATE,
  compatibility_flags: [],
  ...(noBundle ? { no_bundle: true } : {}),
  kv_namespaces: [
    {
      binding: "SELECTED_KV",
      id: "11111111111111111111111111111111",
    },
    {
      binding: "UNRELATED_KV",
      id: "22222222222222222222222222222222",
    },
  ],
  main,
  name: "astilba-env-workers-admission",
  secrets: { required: ["WORKER_SECRET"] },
  vars: {
    FEATURE_ENABLED: "true",
    PUBLIC_ORIGIN: PUBLIC_ORIGIN_SOURCE_CANARY,
  },
});

/**
 * @param {string} directory
 * @param {string} name
 * @param {{ importedName: string, specifier: string }} rejected
 * @param {string} wrangler
 */
const assertRejectedBuild = async (directory, name, rejected, wrangler) => {
  const sourcePath = resolve(directory, "rejected", `${name}.ts`);
  const outputDirectory = resolve(directory, "rejected-output", name);
  await writeFile(
    sourcePath,
    [
      `import { ${rejected.importedName} } from ${JSON.stringify(rejected.specifier)};`,
      "",
      "export default {",
      "  fetch(): Response {",
      `    return new Response(typeof ${rejected.importedName});`,
      "  },",
      "};",
      "",
    ].join("\n")
  );
  const result = runResult(
    process.execPath,
    [wrangler, "deploy", sourcePath, "--dry-run", "--outdir", outputDirectory],
    directory
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (
    result.error !== undefined ||
    result.signal !== null ||
    result.status === null ||
    result.status === 0 ||
    !output.includes("@astilba/env")
  ) {
    fail(`Wrangler did not reject the ${name} package surface under workerd.`);
  }
  const emitted = (await collectFiles(outputDirectory)).filter((path) =>
    path.endsWith(".js")
  );
  if (emitted.length > 0) {
    fail(`Wrangler emitted the rejected ${name} package surface.`);
  }
};

/**
 * @param {string} directory
 * @param {string} archive
 */
const writeConsumerManifest = async (directory, archive) => {
  await writeFile(
    resolve(directory, "package.json"),
    `${JSON.stringify(
      {
        dependencies: {
          "@astilba/env": pathToFileURL(archive).href,
        },
        devDependencies: {
          typescript: "6.0.3",
          wrangler: WRANGLER_VERSION,
        },
        name: "astilba-env-workers-consumer",
        private: true,
        type: "module",
      },
      undefined,
      2
    )}\n`
  );
};

/**
 * @param {readonly string[]} arguments_
 */
const runWorkersConsumer = async (arguments_) => {
  if (arguments_.length > 0) {
    return fail("Cloudflare Workers consumer accepts no arguments.");
  }
  const { archive, sha256 } = await readArtifact();
  const consumer = await createConsumer();
  try {
    await writeConsumerManifest(consumer, archive);
    installArchive("npm", consumer, ["--package-lock=false"]);
    await assertCleanArchiveInstall(consumer, {
      allowManagerMetadata: false,
      manager: "npm",
    });

    const wrangler = resolve(
      consumer,
      "node_modules",
      "wrangler",
      "bin",
      "wrangler.js"
    );
    if (
      run(process.execPath, [wrangler, "--version"], consumer).trim() !==
      WRANGLER_VERSION
    ) {
      fail("Wrangler differs from the Cloudflare Workers admission pin.");
    }
    await mkdir(resolve(consumer, "src"));
    await mkdir(resolve(consumer, "rejected"));
    await writeFile(
      resolve(consumer, "wrangler.jsonc"),
      `// Cloudflare Workers admission fixture; no compatibility shim or secret value.\n${JSON.stringify(
        wranglerConfiguration("src/index.ts", false),
        undefined,
        2
      )}\n`
    );
    await writeFile(resolve(consumer, "astilba.env.ts"), environmentDefinition);
    const cli = resolve(
      consumer,
      "node_modules",
      "@astilba",
      "env",
      "dist",
      "cli",
      "astilba-env.js"
    );
    run(process.execPath, [cli, "generate"], consumer, {
      ...process.env,
      BUILD_LABEL: "build-boundary",
    });
    run(process.execPath, [wrangler, "types"], consumer);
    run(process.execPath, [wrangler, "types", "--check"], consumer);

    const generatedTypes = await readFile(
      resolve(consumer, "worker-configuration.d.ts"),
      "utf-8"
    );
    for (const marker of [
      "interface Env",
      "FEATURE_ENABLED",
      "PUBLIC_ORIGIN",
      "SELECTED_KV",
      "UNRELATED_KV",
      "WORKER_SECRET",
      "KVNamespace",
    ]) {
      if (!generatedTypes.includes(marker)) {
        fail(`Wrangler did not generate the expected Env marker: ${marker}`);
      }
    }
    if (generatedTypes.includes("test-only-placeholder")) {
      fail("Wrangler-generated types contain a test-only secret value.");
    }

    await writeFile(resolve(consumer, "src", "index.ts"), workerSource);
    await writeFile(
      resolve(consumer, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            lib: ["ES2024"],
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            noUncheckedIndexedAccess: true,
            strict: true,
            target: "ES2024",
            verbatimModuleSyntax: true,
          },
          include: [
            ".astilba/env/**/*.ts",
            "src/**/*.ts",
            "worker-configuration.d.ts",
          ],
        },
        undefined,
        2
      )}\n`
    );
    run(
      process.execPath,
      [
        resolve(consumer, "node_modules", "typescript", "bin", "tsc"),
        "--project",
        "tsconfig.json",
      ],
      consumer
    );

    const artifactDirectory = resolve(consumer, "worker-artifact");
    run(
      process.execPath,
      [wrangler, "deploy", "--dry-run", "--outdir", artifactDirectory],
      consumer
    );
    const artifactFiles = await collectFiles(artifactDirectory);
    const artifactModules = artifactFiles.filter((path) =>
      path.endsWith(".js")
    );
    if (artifactModules.length !== 1) {
      fail("Wrangler did not emit exactly one Worker JavaScript artifact.");
    }
    const artifactModule =
      artifactModules[0] ?? fail("Wrangler Worker artifact is missing.");
    const artifactBytes = await readFile(artifactModule);
    const artifactSource = artifactBytes.toString("utf-8");
    if (
      artifactSource.includes("nodejs_compat") ||
      artifactSource.includes("node:") ||
      artifactSource.includes("UNRELATED_KV")
    ) {
      fail(
        "Worker artifact contains a Node marker or an undeclared binding read."
      );
    }
    if (
      artifactBytes.includes(Buffer.from(PUBLIC_ORIGIN_SOURCE_CANARY, "utf-8"))
    ) {
      fail("Worker artifact contains the embedded source canary.");
    }
    const configurationSource = await readFile(
      resolve(consumer, "wrangler.jsonc"),
      "utf-8"
    );
    if (
      configurationSource.includes("nodejs_compat") ||
      !configurationSource.includes('"compatibility_flags": []')
    ) {
      fail("Workers admission configuration enables an unexpected flag.");
    }

    const harnessMain = portablePath(relative(consumer, artifactModule));
    await writeFile(
      resolve(consumer, "wrangler.harness.jsonc"),
      `// Executes the exact dry-run artifact without rebundling it.\n${JSON.stringify(
        wranglerConfiguration(harnessMain, true),
        undefined,
        2
      )}\n`
    );
    await writeFile(resolve(consumer, "harness.mjs"), harnessSource);
    const harnessResult = run(
      process.execPath,
      ["harness.mjs"],
      consumer
    ).trim();
    const parsedHarnessResult = parseHarnessResult(harnessResult);
    const harnessArtifact = parsedHarnessResult.artifact;
    if (
      harnessArtifact !==
      createHash("sha256").update(artifactBytes).digest("hex")
    ) {
      fail("The workerd harness did not prove the exact Worker artifact.");
    }

    for (const [name, rejected] of Object.entries(rejectedImports)) {
      await assertRejectedBuild(consumer, name, rejected, wrangler);
    }

    process.stdout.write(
      `${JSON.stringify({
        archive: sha256,
        artifact: harnessArtifact,
        compatibilityDate: COMPATIBILITY_DATE,
        deploymentBindingSets: 2,
        firstPartyCodecs: true,
        nodejsCompat: false,
        passed: true,
        rejectedSurfaces: Object.keys(rejectedImports).length,
        runtime: "workerd",
        wrangler: WRANGLER_VERSION,
      })}\n`
    );
  } finally {
    await removeConsumer(consumer);
  }
};

if (process.argv[1] === import.meta.filename) {
  await runWorkersConsumer(process.argv.slice(2));
}
