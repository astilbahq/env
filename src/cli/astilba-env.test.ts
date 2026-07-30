import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineEnvironment, env } from "../authoring/index.ts";
import { getEnvironmentCompilerState } from "../authoring/internal.ts";
import { compileContract } from "../core/index.ts";
import { encodeCliCompilationV1 } from "../product/compilation.ts";
import {
  decodeCliCompilationV1ForTest,
  prepareTypeScriptExecArguments,
  runCli,
} from "./astilba-env.ts";

const execFile = async (
  file: string,
  arguments_: readonly string[]
): Promise<void> => {
  await new Promise<void>((fulfill, reject) => {
    execFileCallback(file, arguments_, (error) => {
      if (error === null) {
        fulfill();
        return;
      }
      reject(
        error instanceof Error
          ? error
          : new Error("The test child-process command failed.")
      );
    });
  });
};
const temporaryRoots: string[] = [];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => {
      await rm(root, { force: true, recursive: true });
    })
  );
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(resolve(tmpdir(), "astilba-env-cli-"));
  temporaryRoots.push(root);
  await writeFile(
    resolve(root, "package.json"),
    '{"private":true,"type":"module"}\n',
    "utf-8"
  );
  return root;
};

const configuration = (maximum = 65_535): string => {
  const authoring = pathToFileURL(
    resolve(process.cwd(), "src/authoring/index.ts")
  ).href;
  return `import { defineEnvironment, env } from ${JSON.stringify(authoring)};

export default defineEnvironment({
  id: "com.astilba.cli",
  entries: {
    authSecret: env.private.deployment.secret(),
    databaseUrl: env.private.deployment.text({ normalise: "trim" }),
    port: env.public.deployment.integer({
      maximum: ${maximum},
      minimum: 0,
    }),
  },
  consumers: {
    server: env.server(),
  },
  targets: {
    server: env.process("server", {
      authSecret: "AUTH_SECRET",
      databaseUrl: "DATABASE_URL",
      port: "PORT",
    }),
  },
});
`;
};

const publicBuildConfiguration = (
  maximumCodePoints = 64,
  source = "RELEASE_SHA"
): string => {
  const authoring = pathToFileURL(
    resolve(process.cwd(), "src/authoring/index.ts")
  ).href;
  return `import { defineEnvironment, env } from ${JSON.stringify(authoring)};

export default defineEnvironment({
  id: "com.astilba.cli-build",
  entries: {
    releaseSha: env.public.build.string({
      maximumCodePoints: ${maximumCodePoints},
    }),
  },
  consumers: {
    web: env.browser(),
  },
  targets: {
    web: env.process("web", {
      releaseSha: ${JSON.stringify(source)},
    }),
  },
});
`;
};

const withProcessEnvironment = async <TValue>(
  name: string,
  value: string,
  operation: () => Promise<TValue>
): Promise<TValue> => {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await operation();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = previous;
    }
  }
};

const capture = () => {
  let stderr = "";
  let stdout = "";
  return {
    io: {
      stderr: {
        write(chunk: string | Uint8Array) {
          stderr += String(chunk);
          return true;
        },
      },
      stdout: {
        write(chunk: string | Uint8Array) {
          stdout += String(chunk);
          return true;
        },
      },
    },
    read: () => ({ stderr, stdout }),
  };
};

const ipcCompilation = async (): Promise<Uint8Array> => {
  const environment = defineEnvironment({
    consumers: {
      server: env.server(),
    },
    entries: {
      token: env.private.deployment.text(),
    },
    id: "com.astilba.cli-ipc",
    targets: {
      server: env.process("server", {
        token: "TOKEN",
      }),
    },
  });
  const state = getEnvironmentCompilerState(environment);
  const compiled = await compileContract(state.contract);
  const targets = Object.keys(state.bindingPlans)
    .toSorted()
    .map((target) => {
      const bindingPlan = state.bindingPlans[target];
      const definition = state.targets[target];
      if (bindingPlan === undefined || definition === undefined) {
        throw new TypeError("Expected a complete IPC compilation target.");
      }
      return { bindingPlan, consumer: definition.consumer };
    });
  return encodeCliCompilationV1({ compiled, targets });
};

const withBom = (bytes: Uint8Array): Uint8Array => {
  const output = new Uint8Array(bytes.byteLength + 3);
  output.set([0xef, 0xbb, 0xbf]);
  output.set(bytes, 3);
  return output;
};

describe("Astilba Env CLI", () => {
  it("preserves parent Node policy while replacing type-stripping flags", () => {
    expect(
      prepareTypeScriptExecArguments([
        "--no-warnings",
        "--conditions=astilba",
        "--import",
        "./policy-hook.mjs",
        "--no-experimental-strip-types",
        "--strip-types=false",
      ])
    ).toStrictEqual([
      "--no-warnings",
      "--conditions=astilba",
      "--import",
      "./policy-hook.mjs",
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
    ]);
  });

  it("generates, checks freshness without writes, and aggregates safe diagnostics", async () => {
    const root = await temporaryRoot();
    await writeFile(resolve(root, "astilba.env.ts"), configuration(), "utf-8");

    const generated = capture();
    await expect(
      runCli(["generate", "--json"], {
        cwd: root,
        ...generated.io,
      })
    ).resolves.toBe(0);
    expect(JSON.parse(generated.read().stdout)).toMatchObject({
      command: "generate",
      format: "astilba.env.cli.generate/v1",
      mode: "written",
      ok: true,
    });

    const modulePath = resolve(root, ".astilba/env/server.server.ts");
    const before = await readFile(modulePath, "utf-8");
    const checked = capture();
    await expect(
      runCli(["generate", "--check"], {
        cwd: root,
        ...checked.io,
      })
    ).resolves.toBe(0);
    await expect(readFile(modulePath, "utf-8")).resolves.toBe(before);

    const diagnostics = capture();
    const sensitiveValue = "sensitive-test-value";
    await expect(
      runCli(["check", "--target", "server", "--json"], {
        cwd: root,
        environment: {
          AUTH_SECRET: sensitiveValue,
          PORT: "invalid",
        },
        ...diagnostics.io,
      })
    ).resolves.toBe(1);
    const output = diagnostics.read();
    expect(output.stderr).toBe("");
    expect(output.stdout).not.toContain(sensitiveValue);
    expect(JSON.parse(output.stdout)).toMatchObject({
      command: "check",
      diagnostics: [
        { code: "ENV_MISSING_VALUE", entry: "databaseUrl" },
        { code: "ENV_INVALID_VALUE", entry: "port" },
      ],
      format: "astilba.env.cli.check/v1",
      ok: false,
      target: "server",
    });
  });

  it("materializes the native process environment for public build generation and checks", async () => {
    const root = await temporaryRoot();
    const source = "ASTILBA_ENV_CLI_NATIVE_RELEASE_SHA";
    await writeFile(
      resolve(root, "astilba.env.ts"),
      publicBuildConfiguration(64, source),
      "utf-8"
    );

    await withProcessEnvironment(source, "", async () => {
      const generated = capture();
      await expect(
        runCli(["generate", "--json"], { cwd: root, ...generated.io })
      ).resolves.toBe(0);
      expect(JSON.parse(generated.read().stdout)).toMatchObject({
        command: "generate",
        mode: "written",
        ok: true,
      });
      await expect(
        readFile(resolve(root, ".astilba/env/browser/web.build.ts"), "utf-8")
      ).resolves.toContain('value: ""');

      const checkedTarget = capture();
      await expect(
        runCli(["check", "--target", "web", "--json"], {
          cwd: root,
          ...checkedTarget.io,
        })
      ).resolves.toBe(0);
      expect(JSON.parse(checkedTarget.read().stdout)).toStrictEqual({
        command: "check",
        format: "astilba.env.cli.check/v1",
        ok: true,
        target: "web",
      });

      const checked = capture();
      await expect(
        runCli(["generate", "--check", "--json"], {
          cwd: root,
          ...checked.io,
        })
      ).resolves.toBe(0);
      expect(JSON.parse(checked.read().stdout)).toMatchObject({
        command: "generate",
        mode: "checked",
        ok: true,
      });
    });
  });

  it("preserves explicit strict source rejection without exposing private values", async () => {
    const root = await temporaryRoot();
    await writeFile(
      resolve(root, "astilba.env.ts"),
      publicBuildConfiguration(),
      "utf-8"
    );
    const sensitiveValue = "explicit-private-source-value";
    const nonPlain: Record<string, unknown> = {};
    Object.setPrototypeOf(nonPlain, { inherited: true });
    Object.defineProperty(nonPlain, "RELEASE_SHA", {
      enumerable: true,
      value: sensitiveValue,
    });
    const accessor: Record<string, unknown> = {};
    Object.setPrototypeOf(accessor, null);
    let accessorReads = 0;
    Object.defineProperty(accessor, "RELEASE_SHA", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error(sensitiveValue);
      },
    });

    for (const environment of [nonPlain, accessor]) {
      const output = capture();
      await expect(
        runCli(["generate", "--json"], {
          cwd: root,
          environment,
          ...output.io,
        })
      ).resolves.toBe(1);
      expect(output.read().stdout).toBe("");
      expect(output.read().stderr).not.toContain(sensitiveValue);
      expect(JSON.parse(output.read().stderr)).toStrictEqual({
        command: "generate",
        error: {
          code: "ENV_COMMAND_FAILED",
          message: "Astilba Env command failed safely.",
        },
        format: "astilba.env.cli.error/v1",
        ok: false,
      });
    }
    expect(accessorReads).toBe(0);
  });

  it("plans from committed JSON without executing the committed configuration", async () => {
    const root = await temporaryRoot();
    const configPath = resolve(root, "astilba.env.ts");
    await writeFile(configPath, publicBuildConfiguration(), "utf-8");
    await expect(
      runCli(["generate"], {
        cwd: root,
        environment: { RELEASE_SHA: "baseline" },
        ...capture().io,
      })
    ).resolves.toBe(0);

    await execFile("git", ["init", root]);
    await execFile("git", [
      "-C",
      root,
      "config",
      "user.email",
      "env-candidate@astilba.test",
    ]);
    await execFile("git", [
      "-C",
      root,
      "config",
      "user.name",
      "Astilba Env Candidate",
    ]);
    const marker = resolve(root, "historical-config-executed");
    await writeFile(
      configPath,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "executed");
throw new Error("historical configuration must not run");
`,
      "utf-8"
    );
    await execFile("git", [
      "-C",
      root,
      "add",
      ".astilba/env/snapshot.json",
      "astilba.env.ts",
    ]);
    await execFile("git", ["-C", root, "commit", "-m", "baseline snapshot"]);

    await writeFile(configPath, publicBuildConfiguration(63), "utf-8");
    let sourceReads = 0;
    const source = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          sourceReads += 1;
          throw new Error("Plan must not materialize build source values.");
        },
      }
    );
    const planned = capture();
    const status = await runCli(["plan", "--base", "HEAD", "--json"], {
      cwd: root,
      environment: source,
      ...planned.io,
    });
    expect(status, JSON.stringify(planned.read())).toBe(0);
    expect(planned.read().stderr).toBe("");
    const output: unknown = JSON.parse(planned.read().stdout);
    if (
      !isRecord(output) ||
      output.ok !== true ||
      output.format !== "astilba.env.cli.plan/v1" ||
      !isRecord(output.plan) ||
      !Array.isArray(output.plan.actions)
    ) {
      throw new TypeError("The CLI plan output is invalid.");
    }
    expect(output.ok).toBe(true);
    expect(output.format).toBe("astilba.env.cli.plan/v1");
    expect(output.plan.actions.length).toBeGreaterThan(0);
    expect(sourceReads).toBe(0);
    await expect(readFile(marker, "utf-8")).rejects.toThrow();
  });

  it("makes every later usage failure machine-readable when --json is present", async () => {
    const root = await temporaryRoot();
    const output = capture();

    await expect(
      runCli(["unknown", "--json", "--flag=value"], {
        cwd: root,
        ...output.io,
      })
    ).resolves.toBe(2);
    expect(output.read().stdout).toBe("");
    expect(JSON.parse(output.read().stderr)).toStrictEqual({
      command: null,
      error: {
        code: "ENV_USAGE",
        message: "Invalid Astilba Env command arguments.",
      },
      format: "astilba.env.cli.error/v1",
      ok: false,
    });
  });

  it("rejects unsupported configuration extensions before filesystem access", async () => {
    const root = await temporaryRoot();
    const output = capture();

    await expect(
      runCli(["generate", "--config", "missing.js", "--json"], {
        cwd: root,
        ...output.io,
      })
    ).resolves.toBe(2);
    expect(JSON.parse(output.read().stderr)).toMatchObject({
      command: "generate",
      error: { code: "ENV_USAGE" },
      format: "astilba.env.cli.error/v1",
    });
  });

  it("refuses a final-component configuration symlink", async () => {
    const root = await temporaryRoot();
    await writeFile(resolve(root, "real.mts"), configuration(), "utf-8");
    await symlink("real.mts", resolve(root, "linked.mts"));
    const output = capture();

    await expect(
      runCli(["generate", "--config", "linked.mts", "--json"], {
        cwd: root,
        ...output.io,
      })
    ).resolves.toBe(1);
    expect(JSON.parse(output.read().stderr)).toMatchObject({
      error: { code: "ENV_COMMAND_FAILED" },
    });
  });

  it("preflights an unowned generated directory before evaluating configuration", async () => {
    const root = await temporaryRoot();
    const marker = resolve(root, "configuration-evaluated");
    await writeFile(
      resolve(root, "astilba.env.ts"),
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "executed");
throw new Error("must not run");
`,
      "utf-8"
    );
    await mkdir(resolve(root, ".astilba/env"), { recursive: true });
    await writeFile(
      resolve(root, ".astilba/env/unowned.txt"),
      "preserve",
      "utf-8"
    );
    const output = capture();

    await expect(
      runCli(["generate", "--json"], {
        cwd: root,
        ...output.io,
      })
    ).resolves.toBe(1);
    expect(JSON.parse(output.read().stderr)).toMatchObject({
      error: { code: "ENV_GENERATED_INVALID" },
    });
    await expect(readFile(marker, "utf-8")).rejects.toThrow();
  });

  it("refuses forged CliCompilationV1 child output without executing configuration", async () => {
    const root = await temporaryRoot();
    const marker = resolve(root, "configuration-executed");
    const sensitiveValue = "forged-private-child-value";
    const configurationPath = resolve(root, "astilba.env.ts");
    await writeFile(
      configurationPath,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(sensitiveValue)});
throw new Error(${JSON.stringify(sensitiveValue)});
`,
      "utf-8"
    );

    const valid = await ipcCompilation();
    const source = new TextDecoder().decode(valid);
    const canonical = (replacement: string): Uint8Array =>
      new TextEncoder().encode(replacement);
    const replace = (from: string, to: string): Uint8Array => {
      const output = source.replace(from, to);
      if (output === source) {
        throw new TypeError("Expected the IPC fixture discriminator.");
      }
      return canonical(output);
    };
    const tooLarge = new Uint8Array(8_388_609).fill(0x20);
    const cases: readonly (readonly [string, Uint8Array])[] = [
      ["oversized output", tooLarge],
      ["UTF-8 BOM", withBom(valid)],
      ["invalid UTF-8", new Uint8Array([0xff])],
      [
        "recognized newer format",
        replace(
          "astilba.env.cli-compilation/v1",
          "astilba.env.cli-compilation/v2"
        ),
      ],
      [
        "malformed discriminator",
        replace(
          "astilba.env.cli-compilation/v1",
          `astilba.env.cli-compilation/v1\\u0000${sensitiveValue}`
        ),
      ],
      ["trailing bytes", canonical(`${source} `)],
      [
        "unknown nested field",
        replace(
          '"target":"server"',
          `"forged":"${sensitiveValue}","target":"server"`
        ),
      ],
      [
        "unsupported embedded ABI",
        replace(
          "astilba.env.adapter.process-record/v1",
          "astilba.env.adapter.process-record/v2"
        ),
      ],
    ];

    for (const [name, bytes] of cases) {
      const output = capture();
      const compile = vi.fn(
        async () => await decodeCliCompilationV1ForTest(bytes)
      );
      await expect(
        runCli(
          ["check", "--target", "server", "--json"],
          { cwd: root, ...output.io },
          { compileConfiguration: compile }
        )
      ).resolves.toBe(1);
      expect(compile, name).toHaveBeenCalledWith(
        await realpath(configurationPath)
      );
      expect(output.read().stdout, name).toBe("");
      expect(output.read().stderr, name).not.toContain(sensitiveValue);
      expect(JSON.parse(output.read().stderr), name).toStrictEqual({
        command: "check",
        error: {
          code: "ENV_COMMAND_FAILED",
          message: "Astilba Env command failed safely.",
        },
        format: "astilba.env.cli.error/v1",
        ok: false,
      });
    }
    await expect(readFile(marker, "utf-8")).rejects.toThrow();
  });
});
