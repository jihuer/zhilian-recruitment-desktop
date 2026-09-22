import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist-desktop',{recursive:true});
await build({entryPoints:['desktop/main.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist-desktop/main.cjs',external:['electron','playwright','sql.js','unzipper']});
await build({entryPoints:['desktop/preload.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist-desktop/preload.cjs',external:['electron']});
