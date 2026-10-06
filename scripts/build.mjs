// Builds dist/artifact.html: the whole game in one file, for the playable copy in Claude's Artifact viewer.
// The site itself needs no build; this is only for that copy. Run: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(root + f, 'utf8');
const b64 = f => readFileSync(root + f).toString('base64');

const js = execSync(`npx -y esbuild@0.24.0 ${root}js/app.js --bundle --format=iife --minify`, { encoding: 'utf8' });
let css = read('css/app.css')
  .replace('url(../fonts/fraunces.woff2)', `url(data:font/woff2;base64,${b64('fonts/fraunces.woff2')})`)
  .replace('url(../fonts/figtree.woff2)', `url(data:font/woff2;base64,${b64('fonts/figtree.woff2')})`);

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const out = `<title>Loose Change</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${css}</style>
${body}
<script>window.LOOSE_CHANGE_ARTIFACT = true;</script>
<script>${js.replace(/<\/script/g, '<\\/script')}</script>
`;
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/artifact.html', out);
console.log('dist/artifact.html', (out.length / 1024).toFixed(0), 'KB');
