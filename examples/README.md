# Astilba Env public examples

These are four self-contained applications that consume exact registry `@astilba/env@0.2.3`. They deliberately do not use the source checkout, workspace links, archives, or a shared application layer.

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm verify:all
```

Each application is meant to be read and copied on its own. Run its `pnpm env:check` before starting it; after changing a declaration, use `pnpm env:generate` and commit the refreshed generated output.

- `node-service`: `pnpm dev` uses safe sample values. For a caller-owned production run, provide `SERVICE_API_ORIGIN` and `SERVICE_NAME` in the process environment before running `pnpm start`.
- `cloudflare-worker`: `pnpm dev` starts stock local workerd with the public sample `WORKER_ENABLED=true` in `wrangler.jsonc`.
- `next-static-shell`: `pnpm dev` uses safe local values. To exercise the production server locally, run `pnpm exec cross-env NEXT_APP_NAME=Env-static-shell pnpm build`, then `pnpm start:example`. For a caller-owned production run, provide `NEXT_APP_NAME` at build time and `NEXT_LABEL` plus `NEXT_SERVICE_TOKEN` at deployment time. This maintained independent-pnpm example uses Next's webpack builder: default Turbopack cannot resolve the exact-registry package from this layout.
- `vite`: run `pnpm exec cross-env VITE_APP_NAME=Env-Vite-shell pnpm build`, then `pnpm start:example` and open the server as exactly `localhost` or `127.0.0.1`. Those two local host forms may omit `VITE_PUBLIC_ORIGIN`; the application-owned server derives the HTTP origin from the raw `Host` header and rejects other forms. For a caller-owned production run, provide canonical HTTPS `VITE_PUBLIC_ORIGIN`, plus `VITE_LABEL` and `VITE_SERVICE_TOKEN`, in the process environment before running `pnpm start`. The server, rather than Vite dev, owns `/env.json` and never inspects forwarded host headers.

Generated `.astilba/env` output is committed on purpose. After changing an `astilba.env.ts` declaration, run `pnpm env:generate`, review the generated files, and commit them. CI runs `generate --check` before it starts an app.
