// src → out/desktop (Electron 창들), out/site (아이폰 웹앱)
//   node scripts/build.mjs [desktop|site|all]
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const which = process.argv[2] || 'all';

const common = {
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  loader: { '.woff2': 'file', '.png': 'file' },
  define: { __VERSION__: JSON.stringify(pkg.version) },
};

async function desktop() {
  const out = 'out/desktop';
  await fs.rm(out, { recursive: true, force: true });
  await esbuild.build({
    ...common,
    entryPoints: ['src/desktop/note.js', 'src/desktop/list.js'],
    outdir: out,
    entryNames: '[name]',
    target: 'chrome120',
  });
  for (const f of ['note.html', 'list.html']) await fs.copyFile(`src/desktop/${f}`, `${out}/${f}`);
  console.log('desktop →', out);
}

async function site() {
  const out = 'out/site';
  await fs.rm(out, { recursive: true, force: true });
  const result = await esbuild.build({
    ...common,
    entryPoints: ['src/mobile/app.js'],
    outdir: out,
    entryNames: '[name]-[hash]',
    target: ['safari15', 'chrome110'],
    metafile: true,
  });
  const built = Object.keys(result.metafile.outputs).map(p => path.relative(out, p).replaceAll('\\', '/'));
  const js = built.find(p => /^app-\w+\.js$/.test(p));
  const css = built.find(p => /^app-\w+\.css$/.test(p));

  let html = await fs.readFile('src/mobile/index.html', 'utf8');
  html = html.replaceAll('%APP_JS%', js).replaceAll('%APP_CSS%', css).replaceAll('%VERSION%', pkg.version);
  await fs.writeFile(`${out}/index.html`, html);
  await fs.copyFile('src/mobile/manifest.webmanifest', `${out}/manifest.webmanifest`);
  await fs.cp('src/mobile/icons', `${out}/icons`, { recursive: true });
  const icons = (await fs.readdir('src/mobile/icons')).map(f => `icons/${f}`);

  // 서비스 워커: 이번 빌드 파일 목록과 버전을 박아 넣어. 파일이 바뀌면 버전도 바뀌어서 폰이 새로 받아.
  const files = ['./', 'manifest.webmanifest', ...icons, ...built];
  const version = crypto.createHash('sha256').update(html + built.join('|')).digest('hex').slice(0, 10);
  const sw = (await fs.readFile('src/mobile/sw.js', 'utf8'))
    .replace('%VERSION%', version)
    .replace('%FILES%', JSON.stringify(files));
  await fs.writeFile(`${out}/sw.js`, sw);
  console.log('site →', out, `(${version})`);
}

if (which === 'desktop' || which === 'all') await desktop();
if (which === 'site' || which === 'all') await site();
