// Type for the Tailwind build output (`app.generated.css`), which Wrangler serves as a Text
// module. The stylesheet itself is gitignored and rebuilt before dev, test and deploy.
declare const content: string
export default content
