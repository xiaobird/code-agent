// import 即注册工具（registerTool 副作用）
import "./tool/read"
import "./tool/grep"
import "./tool/glob"
import { startRepl } from "./cli/repl"

startRepl().catch((e) => {
  console.error(e)
  process.exit(1)
})
