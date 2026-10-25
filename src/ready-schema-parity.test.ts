import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readyBody } from "./health-contract.js";

// Guards the #311 regression: every /ready body the server can emit must validate
// against the committed schema the portfolio probe uses (additionalProperties:false).
test("every readyBody variant validates against schemas/ready/conduit-ready.schema.json", async () => {
  const modPath = pathToFileURL(join(process.cwd(), "scripts", "ready-shape.mjs")).href;
  const { checkShape } = (await import(modPath)) as { checkShape: (schema: string, body: string) => { ok: boolean; errors?: string[] } };
  const orig = process.env.NODE_ENV;
  try {
    for (const env of ["production", "test"]) {
      process.env.NODE_ENV = env;
      for (const initialized of [true, false]) for (const persistenceOk of [true, false]) for (const persistence of ["postgres", "memory"] as const) {
        const body = readyBody({ initialized, persistenceOk, persistence });
        const res = checkShape("conduit-ready", JSON.stringify(body));
        assert.equal(res.ok, true, `schema rejected ${JSON.stringify(body)}: ${JSON.stringify(res)}`);
      }
    }
  } finally {
    if (orig === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = orig;
  }
});
