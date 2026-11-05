export interface ProductIcon {
  src: string
  label: string
}

/** Official product marks, keyed by MCP slug; external URLs keep the Worker bundle free of images. */
const ICONS = new Map<string, ProductIcon>([
  [
    "calendar",
    {
      src: "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
      label: "Google Calendar"
    }
  ],
  [
    "notes",
    {
      src: "https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/onenote_48x1.svg",
      label: "Microsoft OneNote"
    }
  ]
])

export function productIcon(mcp: string): ProductIcon | undefined {
  return ICONS.get(mcp)
}
