// Gives every script and the stylesheet a version taken from its own content, and writes
// those versions into docs/index.html. A browser then can never mix a new page with old,
// cached scripts. Run after changing anything in docs/js or docs/css:  node tools/stamp.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../docs/', import.meta.url);
const hash = rel => createHash('sha1').update(readFileSync(new URL(rel, root))).digest('hex').slice(0, 10);
export function stamped(html) {
  const files = readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js')).sort();
  const imports = Object.fromEntries(files.map(f => [`./js/${f}`, `./js/${f}?v=${hash('js/' + f)}`]));
  const map = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
  const build = createHash('sha1').update(Object.values(imports).join('|')).digest('hex').slice(0, 10);
  return html
    .replace(/<script type="importmap">.*?<\/script>\n?/s, '')
    .replace(/<meta name="build"[^>]*>\n?/, '')
    .replace(/(<meta name="viewport"[^>]*>\n)/, `$1<meta name="build" content="${build}">\n`)
    .replace(/<link rel="stylesheet" href="css\/style\.css[^"]*">/, `<link rel="stylesheet" href="css/style.css?v=${hash('css/style.css')}">`)
    .replace(/<script type="module" src="(?:\.\/)?js\/app\.js[^"]*"><\/script>/, `${map}\n<script type="module" src="./js/app.js?v=${hash('js/app.js')}"></script>`);
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = new URL('index.html', root);
  const before = readFileSync(file, 'utf8'), after = stamped(before);
  if (before !== after) writeFileSync(file, after);
  console.log(before === after ? 'index.html is up to date' : 'index.html stamped');
}
