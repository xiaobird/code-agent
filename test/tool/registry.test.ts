import { expect, test } from "vitest"
import { registerTool, toAISDKTools } from "../../src/tool/registry"

test("wraps tool for AI SDK and normalizes errors", async () => {
  registerTool({
    id: "boom", description: "fails", parameters: { type: "object", properties: {} },
    async execute() { throw new Error("kaboom") },
  })
  const tools = toAISDKTools({ sessionID: "s", abort: new AbortController().signal,
    ask: async () => {}, metadata: async () => {} })
  const result = await tools.boom.execute!({}, { toolCallId: "t1", messages: [] })
  expect(result.output).toContain("kaboom")
})
