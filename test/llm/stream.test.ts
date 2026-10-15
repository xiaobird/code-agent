import { expect, test } from "vitest"
import { scriptedModel, text, reasoning, toolCall, finish } from "../helpers/model"
import { streamLLM } from "../../src/llm/stream"

const messages = [{ role: "user" as const, content: "hi" }]

test("maps text deltas and finish", async () => {
  const model = scriptedModel([[...text("hello"), finish("stop", 1, 1)]])
  const events = []
  for await (const e of streamLLM({ model, system: [], messages, tools: {}, abort: new AbortController().signal }))
    events.push(e)
  expect(events[0]).toMatchObject({ type: "text-delta", text: "hello" })
  expect(events.at(-1)).toMatchObject({
    type: "finish",
    reason: "stop",
    tokens: { input: 1, output: 1, total: 2 },
  })
})

test("maps tool calls", async () => {
  const model = scriptedModel([[toolCall("c1", "noop", { a: 1 }), finish("tool-calls", 1, 1)]])
  const events = []
  for await (const e of streamLLM({ model, system: [], messages, tools: {}, abort: new AbortController().signal }))
    events.push(e)
  expect(events[0]).toMatchObject({ type: "tool-call", id: "c1", name: "noop", input: { a: 1 } })
})

test("maps errors", async () => {
  const model = scriptedModel([[{ type: "error", error: new Error("provider down") }]])
  const events = []
  for await (const e of streamLLM({ model, system: [], messages, tools: {}, abort: new AbortController().signal }))
    events.push(e)
  expect(events[0]).toMatchObject({ type: "error", error: { message: "provider down" } })
})

test("maps reasoning deltas", async () => {
  const model = scriptedModel([[...reasoning("let me think"), ...text("answer"), finish("stop", 1, 1)]])
  const events = []
  for await (const e of streamLLM({ model, system: [], messages, tools: {}, abort: new AbortController().signal }))
    events.push(e)
  expect(events[0]).toMatchObject({ type: "reasoning-delta", text: "let me think" })
  expect(events[1]).toMatchObject({ type: "text-delta", text: "answer" })
})
