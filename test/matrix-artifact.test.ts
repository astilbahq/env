import { describe, expect, it } from "vitest";

type InstalledModeVerifier = (options: {
  expectedMode: number;
  installedMode: number;
  manager: "bun" | "npm" | "pnpm";
  path: string;
  platform: NodeJS.Platform;
}) => boolean;

type RunFailureFormatter = (
  command: string,
  arguments_: readonly string[],
  result: {
    signal: NodeJS.Signals | null;
    status: number | null;
    stderr: string | Buffer;
    stdout: string | Buffer;
  }
) => string;

const isInstalledModeVerifier = (
  value: unknown
): value is InstalledModeVerifier => typeof value === "function";

const isRunFailureFormatter = (value: unknown): value is RunFailureFormatter =>
  typeof value === "function";

const matrixArtifactModule: unknown =
  // @ts-expect-error -- The verifier is a checked JSDoc module without declarations.
  await import("../scripts/matrix-artifact.mjs");
if (
  typeof matrixArtifactModule !== "object" ||
  matrixArtifactModule === null ||
  !("isAcceptedInstalledMode" in matrixArtifactModule) ||
  !isInstalledModeVerifier(matrixArtifactModule.isAcceptedInstalledMode) ||
  !("formatRunFailure" in matrixArtifactModule) ||
  !isRunFailureFormatter(matrixArtifactModule.formatRunFailure)
) {
  throw new TypeError("Matrix artifact exports are unavailable.");
}
const { formatRunFailure, isAcceptedInstalledMode } = matrixArtifactModule;

describe("installed archive mode verification", () => {
  it("accepts Bun's manager-owned CLI mode normalization only", () => {
    const executable = {
      expectedMode: 0o755,
      installedMode: 0o777,
      path: "dist/cli/astilba-env.js",
      platform: "darwin",
    } as const;

    expect(isAcceptedInstalledMode({ ...executable, manager: "bun" })).toBe(
      true
    );
    expect(isAcceptedInstalledMode({ ...executable, manager: "npm" })).toBe(
      false
    );
    expect(isAcceptedInstalledMode({ ...executable, manager: "pnpm" })).toBe(
      false
    );
    expect(
      isAcceptedInstalledMode({
        ...executable,
        manager: "bun",
        path: "dist/index.js",
      })
    ).toBe(false);
    expect(
      isAcceptedInstalledMode({
        ...executable,
        expectedMode: 0o644,
        manager: "bun",
      })
    ).toBe(false);
  });

  it("keeps exact installed modes valid for every manager", () => {
    for (const manager of ["bun", "npm", "pnpm"] as const) {
      expect(
        isAcceptedInstalledMode({
          expectedMode: 0o644,
          installedMode: 0o644,
          manager,
          path: "dist/index.js",
          platform: "linux",
        })
      ).toBe(true);
    }
  });

  it("reports both command output streams without serializing its environment", () => {
    expect(
      formatRunFailure("npm", ["install"], {
        signal: null,
        status: 1,
        stderr: "install failed",
        stdout: "resolving dependencies",
      })
    ).toBe(
      "npm install failed (status 1).\nstdout:\nresolving dependencies\nstderr:\ninstall failed"
    );
  });

  it("reports both Buffer output streams when a command ends by signal", () => {
    expect(
      formatRunFailure("npm", ["install"], {
        signal: "SIGTERM",
        status: null,
        stderr: Buffer.from("install terminated"),
        stdout: Buffer.from("resolving dependencies"),
      })
    ).toBe(
      "npm install failed (signal SIGTERM).\nstdout:\nresolving dependencies\nstderr:\ninstall terminated"
    );
  });
});
