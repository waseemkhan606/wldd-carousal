import { rerenderCarousel } from "../lib/generate/pipeline"; import { closeBrowser } from "../lib/render/renderer";
(async () => { for (const id of process.argv.slice(2).map(Number)) { const r = await rerenderCarousel(id); console.log("re-rendered", id, "flags:", Object.keys(r.flags).length); } await closeBrowser(); })();
