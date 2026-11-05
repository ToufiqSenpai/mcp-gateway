// Runs the Tailwind watcher beside `wrangler dev` so CSS and the Worker reload together.
import { spawn } from "node:child_process"

const run = (command: string) => spawn(command, { stdio: "inherit", shell: true })

const children = [
  run("pnpm --filter @mcp-gateway/web css:watch"),
  run("pnpm exec wrangler dev --env-file .env --infer-origin-from-routes=false --live-reload")
]

for (const child of children) {
  child.on("exit", code => {
    for (const other of children) other.kill()
    process.exitCode = code ?? 1
  })
}
