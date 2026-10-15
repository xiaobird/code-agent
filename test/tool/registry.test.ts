import { expect, test } from "vitest"
import { registerTool, toAISDKTools } from "../../src/tool/registry"

test("wraps tool for AI SDK and normalizes errors", async () => {
  registerTool({
    id: "boom", description: "fails", parameters: { type: "object", properties: {} },
    async execute() { throw new Error("kaboom") },
  })
  const tools = toAISDKTools({ sessionID: "s", abort: new AbortController().signal,
    ask: async () => {}, metadata: async () => {} })
  const result = await tools.boom.execute!({}, { toolCallId: "t1", messages: [], context: undefined as never })
  expect(result.output).toContain("kaboom")
})

test("parallel tool executions are serialized", async () => {
  const events: string[] = []
  registerTool({
    id: "probe",
    description: "",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      events.push("start")
      await new Promise((r) => setTimeout(r, 30))
      events.push("end")
      return { title: "probe", output: "ok" }
    },
  })
  const tools = toAISDKTools({ sessionID: "s", abort: new AbortController().signal, ask: async () => {}, metadata: async () => {} })
  await Promise.all([
    tools.probe.execute!({}, { toolCallId: "t1", messages: [], context: undefined as never }),
    tools.probe.execute!({}, { toolCallId: "t2", messages: [], context: undefined as never }),
  ])
  // 串行：start,start,end,end 不允许；必须 start,end,start,end
  expect(events).toEqual(["start", "end", "start", "end"])
})
