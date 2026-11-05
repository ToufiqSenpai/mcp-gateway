import type { Child } from "hono/jsx"

export interface LayoutProps {
  title: string
  devBypass?: boolean
  children: Child
}

export function Layout({ title, devBypass, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href="/admin/app.css" />
      </head>
      <body class="bg-slate-50 text-slate-900">
        {devBypass ? (
          <div class="bg-amber-300 px-4 py-2 text-center text-sm font-semibold text-amber-950">
            Dev auth bypass active — Cloudflare Access is not being verified.
          </div>
        ) : null}
        <header class="border-b border-slate-200 bg-white">
          <div class="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
            <a class="text-lg font-semibold" href="/admin">
              MCP Gateway
            </a>
          </div>
        </header>
        <main class="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
