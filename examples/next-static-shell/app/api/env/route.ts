import { NextResponse } from "next/server";

import { projection } from "../../../.astilba/env/browser/browser.deployment.ts";
import { check } from "../../../.astilba/env/serverDeployment.server.ts";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const checked = check(process.env);
  if (!checked.ok) {
    return NextResponse.json(
      { error: checked.diagnostics[0]?.code },
      { status: 500 }
    );
  }
  const label = checked.value.label;
  return NextResponse.json(
    {
      audience: { origin: new URL(request.url).origin },
      consumer: projection.consumer,
      contract: projection.contract,
      lifecycle: projection.lifecycle,
      projection: projection.digest,
      protocol: "astilba.env.bootstrap/v1",
      values: { label },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
