import { defineEnvironment, env } from "@astilba/env";

export default defineEnvironment({
  consumers: {
    browser: env.browser(["appName", "label"]),
    server: env.server(),
  },
  entries: {
    appName: env.public.build.string(),
    label: env.public.deployment.string(),
    serviceToken: env.private.deployment.secret(),
  },
  id: "com.astilba.examples.next-static-shell",
  targets: {
    browserBuild: env.process("browser", { appName: "NEXT_APP_NAME" }),
    browserDeployment: env.process("browser", { label: "NEXT_LABEL" }),
    serverDeployment: env.process("server", {
      label: "NEXT_LABEL",
      serviceToken: "NEXT_SERVICE_TOKEN",
    }),
  },
});
