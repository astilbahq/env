// @ts-check
/// <reference types="node" />

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertCleanArchiveInstall,
  createConsumer,
  installArchive,
  readArtifact,
  removeConsumer,
  run,
  writeConsumerManifest,
  runResult,
} from "./matrix-artifact.mjs";

const { archive, sha256 } = await readArtifact();
/** @type {readonly ("bun" | "npm" | "pnpm")[]} */
const managers = ["npm", "pnpm", "bun"];
const selected = process.argv.slice(2);
const requested = selected.length === 0 ? [...managers] : selected;
/** @param {string} value @returns {value is "bun" | "npm" | "pnpm"} */
const isManager = (value) =>
  value === "bun" || value === "npm" || value === "pnpm";

if (requested.length === 0 || !requested.every(isManager)) {
  throw new Error("Usage: node scripts/verify-consumer.mjs [npm|pnpm|bun ...]");
}

for (const manager of requested) {
  let expectedVersion;
  if (manager === "bun") {
    expectedVersion = "1.3.14";
  } else if (manager === "pnpm") {
    expectedVersion = "11.10.0";
  } else {
    expectedVersion =
      process.versions.node === "22.14.0" ? "10.9.2" : "11.16.0";
  }
  if (run(manager, ["--version"], process.cwd()).trim() !== expectedVersion) {
    throw new Error(
      `${manager} archive-consumer runtime differs from its matrix pin.`
    );
  }
  const consumer = await createConsumer();
  try {
    await writeConsumerManifest(consumer, archive);
    installArchive(manager, consumer);
    await assertCleanArchiveInstall(consumer, {
      allowManagerMetadata: manager === "pnpm",
      manager,
    });
    await writeFile(
      resolve(consumer, "smoke.mjs"),
      'import { defineEnvironment, env } from "@astilba/env";\nconst definition = defineEnvironment({ id: "com.example.consumer", entries: { value: env.public.build.string() }, consumers: { web: env.browser(["value"]) }, targets: { build: env.process("web", { value: "VALUE" }) } });\nprocess.stdout.write(definition.id + "\\n");\n'
    );
    run(process.execPath, ["smoke.mjs"], consumer);
    const browserResolution = runResult(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'await import("@astilba/env/browser");',
      ],
      consumer
    );
    if (
      browserResolution.error !== undefined ||
      browserResolution.signal !== null ||
      browserResolution.status === 0 ||
      browserResolution.stdout !== "" ||
      !browserResolution.stderr.includes("ERR_PACKAGE_PATH_NOT_EXPORTED")
    ) {
      throw new Error(
        "Node unexpectedly resolved the browser-only package export."
      );
    }
  } finally {
    await removeConsumer(consumer);
  }
}

process.stdout.write(
  `${JSON.stringify({ archive: sha256, managers: requested, passed: true })}\n`
);
