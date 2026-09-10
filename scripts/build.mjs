#!/usr/bin/env node
/**
 * Build one of the two deploy targets from this single codebase.
 *
 *   node scripts/build.mjs site    ->  dist-site/    (public website)
 *   node scripts/build.mjs admin   ->  dist-admin/   (staff admin panel)
 *
 * Why a build step at all: both targets are deployed as separate Vercel
 * projects on separate domains, and the public one must not merely *hide* the
 * admin panel — it must not contain it. Copying only what each target needs is
 * what makes `/admin` genuinely absent from the public domain.
 *
 * The three files both targets share (css/styles.css, js/supabase-config.js,
 * js/timetable-render.js) are copied from one place, so the admin's live
 * preview can never drift from the real site styling.
 */
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Public URL of the deployed public site — used by the admin's "View site" link. */
const PUBLIC_SITE_URL =
  process.env.PUBLIC_SITE_URL || 'https://info-pasinduathukoralaict.vercel.app';

/** Files shared by both targets. Single source, copied into each build. */
const SHARED = [
  'css/styles.css',
  'js/supabase-config.js',
  'js/timetable-render.js'
];

const SITE = {
  outDir: 'dist-site',
  // every top-level page except the admin panel
  pages: (all) => all.filter((f) => f !== 'admin.html'),
  assets: [
    'js/app.js',
    'js/timetable-live.js',
    'js/timetable-index.js',
    'images',
    'robots.txt'
  ]
};

const ADMIN = {
  outDir: 'dist-admin',
  pages: () => [],           // admin.html is handled specially, as index.html
  assets: ['css/admin.css', 'js/admin.js']
};

async function emptyDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

/**
 * Recursive file/directory copy written by hand rather than fs.promises.cp,
 * which only became stable in Node 18 — some Vercel projects still pin an
 * older Node.js Version (Project Settings -> General), and this must not
 * depend on that being current.
 */
async function copyRecursive(from, to) {
  const info = await stat(from);
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from)) {
      await copyRecursive(join(from, entry), join(to, entry));
    }
  } else {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

async function copyInto(outDir, relPath) {
  const from = join(ROOT, relPath);
  if (!existsSync(from)) {
    console.warn(`  ! skipped missing ${relPath}`);
    return;
  }
  await copyRecursive(from, join(outDir, relPath));
}

async function buildSite() {
  const outDir = join(ROOT, SITE.outDir);
  await emptyDir(outDir);

  const all = (await readdir(ROOT)).filter((f) => f.endsWith('.html'));
  const pages = SITE.pages(all);
  for (const page of pages) await copyInto(outDir, page);
  for (const asset of [...SHARED, ...SITE.assets]) await copyInto(outDir, asset);

  console.log(`site:  ${pages.length} pages + ${SHARED.length + SITE.assets.length} asset paths -> ${SITE.outDir}/`);

  // Guard: the whole point of the split is that this file is absent here.
  if (existsSync(join(outDir, 'admin.html')) || existsSync(join(outDir, 'js/admin.js'))) {
    throw new Error('admin files leaked into the public build');
  }
}

async function buildAdmin() {
  const outDir = join(ROOT, ADMIN.outDir);
  await emptyDir(outDir);

  for (const asset of [...SHARED, ...ADMIN.assets]) await copyInto(outDir, asset);

  // admin.html becomes the site root, so the panel lives at "/" on its own domain
  let html = await readFile(join(ROOT, 'admin.html'), 'utf8');

  // "View site" must point at the public domain now that they are separate
  html = html.replace('href="/times"', `href="${PUBLIC_SITE_URL}/times"`);

  await writeFile(join(outDir, 'index.html'), html, 'utf8');

  // Belt and braces alongside the page's own noindex meta tag
  await writeFile(
    join(outDir, 'robots.txt'),
    'User-agent: *\nDisallow: /\n',
    'utf8'
  );

  console.log(`admin: index.html + ${SHARED.length + ADMIN.assets.length} asset paths -> ${ADMIN.outDir}/`);

  if (!html.includes('name="robots"')) {
    throw new Error('admin page lost its noindex meta tag');
  }
}

const target = process.argv[2];
const builders = { site: buildSite, admin: buildAdmin };

if (!builders[target]) {
  console.error('Usage: node scripts/build.mjs <site|admin>');
  process.exit(1);
}

builders[target]().catch((err) => {
  console.error(`Build failed: ${err.message}`);
  process.exitCode = 1;
});
