import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("planner command schema action enum matches PlannerCommandAction", async () => {
  const [schemaRaw, typesSource] = await Promise.all([
    readFile(new URL("../schemas/planner-command.schema.json", import.meta.url), "utf8"),
    readFile(new URL("../server/planner/types.ts", import.meta.url), "utf8"),
  ]);
  const schema = JSON.parse(schemaRaw);
  const schemaActions = schema.properties.action.enum;
  const typeActions = extractStringUnion(typesSource, "PlannerCommandAction");

  assert.deepEqual([...schemaActions].sort(), [...typeActions].sort());
});

function extractStringUnion(source, typeName) {
  const match = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`, "u"));
  assert.ok(match, `Expected to find exported type ${typeName}.`);
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((literal) => literal[1]);
}
