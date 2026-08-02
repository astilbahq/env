// @ts-check
/// <reference types="node" />

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const REGISTRY = "https://registry.npmjs.org/@astilba/env/-/env-0.2.2.tgz";
const INTEGRITY =
  "sha512-B6UaBdrKPRPvwNzo5CIhWtBiZjijxxAObj62TIA8Z52HBwVYyy//IjcxVNe2e+TUvmh0cFsg2WzvCBHrOylrng==";
const VERSION = "0.2.2";
const NEXT_PRIVATE_BINDING = "NEXT_SERVICE_TOKEN";
const NEXT_PRIVATE_NAME = "serviceToken";
const NEXT_PRIVATE_VALUE = "next-server-only-value";
const apps = Object.freeze([
  "node-service",
  "cloudflare-worker",
  "next-static-shell",
  "vite",
]);

/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Error(message);
};

/** @param {string} command @param {readonly string[]} arguments_ @param {string} [cwd] @param {NodeJS.ProcessEnv} [environment] */
const run = (command, arguments_, cwd = ROOT, environment = {}) => {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...environment },
  });
  if (result.error || result.status !== 0) {
    fail(
      `${command} ${arguments_.join(" ")} failed: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
};

/** @param {string} command @param {readonly string[]} arguments_ @param {string} cwd @param {NodeJS.ProcessEnv} environment */
const start = (command, arguments_, cwd, environment) => {
  const child = spawn(command, arguments_, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: "ignore",
  });
  return child;
};

/** @param {import("node:child_process").ChildProcess} child */
const stop = async (child) => {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve_) => {
      child.once("close", () => {
        resolve_(undefined);
      });
    }),
    new Promise((resolve_) => {
      setTimeout(resolve_, 5000);
    }),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
};

/** @param {string} url @param {import("node:child_process").ChildProcess} child @returns {Promise<Response>} */
const fetchReady = async (url, child) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`Server stopped before serving ${url}.`);
    }
    try {
      const response = await fetch(url);
      return response;
    } catch {
      await new Promise((resolve_) => {
        setTimeout(resolve_, 125);
      });
    }
  }
  return fail(`Timed out waiting for ${url}.`);
};

/** @param {string} url @param {string} host @returns {Promise<Response>} */
const fetchWithRawHost = async (url, host) =>
  await new Promise((resolve_, reject) => {
    const request = httpRequest(url, { headers: { host } }, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve_(new Response(body, { status: response.statusCode ?? 500 }));
      });
    });
    request.on("error", reject);
    request.end();
  });

/** @param {string} directory */
const digestTree = async (directory) => {
  const hash = createHash("sha256");
  /** @param {string} current */
  const visit = async (current) => {
    const entries = await readdir(current, { withFileTypes: true });
    const ordered = [...entries];
    ordered.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of ordered) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        hash.update(entry.name).update(await readFile(path));
      }
    }
  };
  await visit(directory);
  return hash.digest("hex");
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const verifyRegistryIdentity = async () => {
  const lock = await readFile(resolve(ROOT, "pnpm-lock.yaml"), "utf-8");
  if (!lock.includes(`@astilba/env@${VERSION}`) || !lock.includes(INTEGRITY)) {
    fail("Examples lockfile does not pin the exact public registry package.");
  }
  for (const app of apps) {
    const manifest = await readFile(
      resolve(ROOT, app, "package.json"),
      "utf-8"
    );
    if (
      !new RegExp(`"@astilba/env"\\s*:\\s*"${VERSION}"`, "u").test(manifest) ||
      /(?:workspace:|file:|link:|\.tgz|\.tar\.gz)/u.test(manifest)
    ) {
      fail(`${app} does not declare the exact registry dependency.`);
    }
  }
  for (const app of apps) {
    const installed = JSON.parse(
      await readFile(
        resolve(ROOT, app, "node_modules/@astilba/env/package.json"),
        "utf-8"
      )
    );
    if (
      !isRecord(installed) ||
      installed.name !== "@astilba/env" ||
      installed.version !== VERSION
    ) {
      fail(
        `${app} installed metadata differs from the requested registry release.`
      );
    }
  }
  const metadata = await (
    await fetch(`https://registry.npmjs.org/@astilba/env/${VERSION}`)
  ).json();
  if (
    !isRecord(metadata) ||
    !isRecord(metadata.dist) ||
    metadata.dist.integrity !== INTEGRITY ||
    metadata.dist.tarball !== REGISTRY
  ) {
    fail("Registry metadata differs from the exact Env tarball identity.");
  }
};

/** @param {Response} response @param {number} status @param {string} code */
const assertResponse = async (response, status, code) => {
  const body = await response.json();
  if (!isRecord(body) || response.status !== status || body.error !== code) {
    fail(
      `Expected ${status} ${code}, received ${response.status} ${JSON.stringify(body)}.`
    );
  }
};

const verifyNode = async () => {
  const cwd = resolve(ROOT, "node-service");
  /** @type {readonly (readonly [string | undefined, string])[]} */
  const invalidSources = [
    [undefined, "ENV_MISSING_VALUE"],
    ["", "ENV_MISSING_VALUE"],
    ["not an origin", "ENV_INVALID_VALUE"],
  ];
  for (const [source, code] of invalidSources) {
    const child = start(
      process.execPath,
      ["--experimental-strip-types", "src/server.ts"],
      cwd,
      {
        PORT: "3101",
        SERVICE_API_ORIGIN:
          source === "not an origin" ? source : "https://service.example",
        ...(source === undefined ? {} : { SERVICE_NAME: source }),
      }
    );
    try {
      await assertResponse(
        await fetchReady("http://localhost:3101", child),
        500,
        code
      );
    } finally {
      await stop(child);
    }
  }
  const child = start(
    process.execPath,
    ["--experimental-strip-types", "src/server.ts"],
    cwd,
    {
      PORT: "3101",
      SERVICE_API_ORIGIN: "https://service.example",
      SERVICE_NAME: "public-service",
    }
  );
  try {
    const response = await fetchReady("http://localhost:3101", child);
    const body = await response.text();
    if (
      !response.ok ||
      body.includes("service.example") ||
      body !== '{"configured":true}'
    ) {
      fail("Node service did not keep its public response value-free.");
    }
  } finally {
    await stop(child);
  }
};

const verifyWorker = async () => {
  const cwd = resolve(ROOT, "cloudflare-worker");
  const child = start(
    process.execPath,
    [
      resolve(cwd, "node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--local",
      "--port",
      "8787",
    ],
    cwd,
    {}
  );
  try {
    const response = await fetchReady("http://localhost:8787", child);
    if (!response.ok || (await response.text()) !== '{"configured":true}') {
      fail("Local workerd request did not use the generated Worker target.");
    }
  } finally {
    await stop(child);
  }
};

const verifyNext = async () => {
  const cwd = resolve(ROOT, "next-static-shell");
  await rm(resolve(cwd, ".next"), { force: true, recursive: true });
  run(
    process.execPath,
    [resolve(cwd, "node_modules/next/dist/bin/next"), "build", "--webpack"],
    cwd,
    { NEXT_APP_NAME: "Env-static-shell" }
  );
  const staticRoot = resolve(cwd, ".next/static");
  const initial = await digestTree(staticRoot);
  const manifest = await readFile(
    resolve(cwd, ".next/prerender-manifest.json"),
    "utf-8"
  );
  const prerender = JSON.parse(manifest);
  if (
    !isRecord(prerender) ||
    !isRecord(prerender.routes) ||
    !("/" in prerender.routes)
  ) {
    fail("Next page is not statically rendered.");
  }
  const privateMarkers = [
    NEXT_PRIVATE_BINDING,
    NEXT_PRIVATE_NAME,
    NEXT_PRIVATE_VALUE,
  ];
  await scan(staticRoot, privateMarkers);
  /** @param {string} label */
  const readProfile = async (label) => {
    const child = start(
      process.execPath,
      [
        resolve(cwd, "node_modules/next/dist/bin/next"),
        "start",
        "--port",
        "3103",
      ],
      cwd,
      { NEXT_LABEL: label, NEXT_SERVICE_TOKEN: NEXT_PRIVATE_VALUE }
    );
    try {
      const response = await fetchReady("http://localhost:3103/api/env", child);
      const body = await response.text();
      if (
        !response.ok ||
        body.includes("NEXT_LABEL") ||
        privateMarkers.some((marker) => body.includes(marker))
      ) {
        fail("Next bootstrap response contains non-public material.");
      }
      return body;
    } finally {
      await stop(child);
    }
  };
  const alpha = await readProfile("alpha");
  const beta = await readProfile("beta");
  if (alpha === beta || initial !== (await digestTree(staticRoot))) {
    fail("One Next build was not reused unchanged across deployment profiles.");
  }
};

/** @param {string} directory @param {readonly string[]} markers */
const scan = async (directory, markers) => {
  let sourceMapCount = 0;
  /** @param {string} current */
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && /\.(?:html|js|map)$/u.test(entry.name)) {
        const source = await readFile(path, "utf-8");
        if (markers.some((marker) => source.includes(marker))) {
          fail(
            `Browser artifact leaked ${markers.find((marker) => source.includes(marker))}.`
          );
        }
        if (entry.name.endsWith(".map")) {
          sourceMapCount += 1;
        }
      }
    }
  };
  await visit(directory);
  return sourceMapCount;
};

const verifyVite = async () => {
  const cwd = resolve(ROOT, "vite");
  await rm(resolve(cwd, "dist"), { force: true, recursive: true });
  run(
    process.execPath,
    [resolve(cwd, "node_modules/vite/bin/vite.js"), "build"],
    cwd,
    { VITE_APP_NAME: "Env-Vite-shell" }
  );
  const sourceMapCount = await scan(resolve(cwd, "dist"), [
    "VITE_SERVICE_TOKEN",
    "serviceToken",
    "serverDeployment.server",
  ]);
  if (sourceMapCount === 0) {
    fail("Vite did not emit a privacy-scanned browser source map.");
  }
  const initial = await digestTree(resolve(cwd, "dist"));
  const assetServer = start(
    process.execPath,
    ["--experimental-strip-types", "server.ts"],
    cwd,
    {
      PORT: "4173",
      VITE_PUBLIC_ORIGIN: undefined,
      VITE_LABEL: "asset-check",
      VITE_SERVICE_TOKEN: "server-only",
    }
  );
  try {
    const page = await fetchReady("http://localhost:4173", assetServer);
    const html = await page.text();
    if (!page.headers.get("content-type")?.startsWith("text/html")) {
      fail("Vite static server did not serve the application shell as HTML.");
    }
    const asset = /src="(?<asset>[^"?]+\.js)"/u.exec(html)?.groups?.asset;
    if (typeof asset === "string") {
      const module = await fetch(new URL(asset, "http://localhost:4173"));
      if (!module.headers.get("content-type")?.includes("javascript")) {
        fail(
          "Vite static server did not serve the browser module as JavaScript."
        );
      }
    } else {
      fail("Vite application shell did not name an emitted JavaScript module.");
    }
  } finally {
    await stop(assetServer);
  }
  const rejected = spawnSync(
    process.execPath,
    [
      resolve(cwd, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "vite.private.config.ts",
    ],
    { cwd, encoding: "utf-8" }
  );
  if (
    rejected.status === 0 ||
    !`${rejected.stdout}${rejected.stderr}`.includes(
      "ENV_BROWSER_PRIVATE_IMPORT"
    )
  ) {
    fail("Vite did not refuse a generated private server import.");
  }
  /** @param {string} label @param {string} hostname @param {string} [configuredOrigin] @param {string} [expectedOrigin] */
  const readProfile = async (
    label,
    hostname,
    configuredOrigin,
    expectedOrigin
  ) => {
    const requestOrigin = `http://${hostname}:4173`;
    const audienceOrigin = expectedOrigin ?? requestOrigin;
    const child = start(
      process.execPath,
      ["--experimental-strip-types", "server.ts"],
      cwd,
      {
        PORT: "4173",
        VITE_LABEL: label,
        VITE_PUBLIC_ORIGIN: configuredOrigin,
        VITE_SERVICE_TOKEN: "kept-on-server",
      }
    );
    try {
      const response = await fetchReady(`${requestOrigin}/env.json`, child);
      const body = await response.text();
      if (
        !response.ok ||
        body.includes("kept-on-server") ||
        body.includes("serviceToken")
      ) {
        fail("Vite bootstrap response contains private material.");
      }
      run(
        process.execPath,
        [
          "--experimental-strip-types",
          "--input-type=module",
          "--eval",
          'import { parseBrowserBootstrap } from "@astilba/env/browser"; import { projection } from "./.astilba/env/browser/browser.deployment.ts"; const parsed = parseBrowserBootstrap({ expectedAudience: { origin: process.env.ASTILBA_EXAMPLE_EXPECTED_ORIGIN }, projection, source: process.env.ASTILBA_EXAMPLE_ENVELOPE }); if (parsed.values.label !== process.env.ASTILBA_EXAMPLE_EXPECTED_LABEL) throw new Error("Vite bootstrap value mismatch.");',
        ],
        cwd,
        {
          ASTILBA_EXAMPLE_ENVELOPE: body,
          ASTILBA_EXAMPLE_EXPECTED_LABEL: label,
          ASTILBA_EXAMPLE_EXPECTED_ORIGIN: audienceOrigin,
        }
      );
      return body;
    } finally {
      await stop(child);
    }
  };
  const alpha = await readProfile("alpha", "127.0.0.1");
  const beta = await readProfile("beta", "localhost");
  await readProfile(
    "configured",
    "127.0.0.1",
    "https://vite.example.com:443/",
    "https://vite.example.com"
  );
  const hostileHostChild = start(
    process.execPath,
    ["--experimental-strip-types", "server.ts"],
    cwd,
    {
      PORT: "4173",
      VITE_LABEL: "hostile-host",
      VITE_PUBLIC_ORIGIN: undefined,
      VITE_SERVICE_TOKEN: "kept-on-server",
    }
  );
  try {
    await fetchReady("http://127.0.0.1:4173", hostileHostChild);
    for (const host of [
      "example.test",
      "LOCALHOST:4173",
      "localhost:04173",
      "127.1:4173",
      "localhost:4173,example.test",
    ]) {
      await assertResponse(
        await fetchWithRawHost("http://127.0.0.1:4173/env.json", host),
        500,
        "ENV_INVALID_VALUE"
      );
    }
  } finally {
    await stop(hostileHostChild);
  }
  const invalidOriginChild = start(
    process.execPath,
    ["--experimental-strip-types", "server.ts"],
    cwd,
    {
      PORT: "4173",
      VITE_LABEL: "invalid-origin",
      VITE_PUBLIC_ORIGIN: "http://localhost:4173",
      VITE_SERVICE_TOKEN: "kept-on-server",
    }
  );
  try {
    await assertResponse(
      await fetchReady("http://127.0.0.1:4173/env.json", invalidOriginChild),
      500,
      "ENV_INVALID_VALUE"
    );
  } finally {
    await stop(invalidOriginChild);
  }
  if (alpha === beta || initial !== (await digestTree(resolve(cwd, "dist")))) {
    fail("One Vite build was not reused unchanged across deployment profiles.");
  }
};

const command = process.argv[2] ?? "all";
if (!new Set(["all", "next", "node", "vite", "windows"]).has(command)) {
  fail("Usage: verify-adoption.mjs <all|next|node|vite|windows>");
}
await verifyRegistryIdentity();
run("pnpm", ["env:check"]);
if (command === "all" || command === "node" || command === "windows") {
  await verifyNode();
}
if (command === "all") {
  await verifyWorker();
}
if (command === "all" || command === "next") {
  await verifyNext();
}
if (command === "all" || command === "vite" || command === "windows") {
  await verifyVite();
}
process.stdout.write(`${JSON.stringify({ command, passed: true })}\n`);
