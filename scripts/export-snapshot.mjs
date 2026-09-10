#!/usr/bin/env node
/**
 * Export every published timetable to data/timetables.snapshot.json.
 *
 * This is the durable backup of what the site is serving, and the intended
 * input for generating baked fallback HTML at build time later on — so the
 * hand-written rows currently acting as the tier-3 fallback can eventually
 * be generated rather than maintained.
 *
 *   npm run snapshot
 *
 * Connection details come from the environment when set, otherwise they are
 * read out of js/supabase-config.js so there is one source of truth. Only
 * the publishable key is ever used; this script reads public data only.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/timetables.snapshot.json');

async function readConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
    return {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_PUBLISHABLE_KEY
    };
  }
  const src = await readFile(resolve(ROOT, 'js/supabase-config.js'), 'utf8');
  const url = src.match(/SUPABASE_URL\s*=\s*'([^']+)'/);
  const key = src.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/);
  if (!url || !key) {
    throw new Error('Could not read Supabase config from js/supabase-config.js');
  }
  return { url: url[1], key: key[1] };
}

const SELECT = [
  '*',
  'timetable_sections(*)',
  'class_slots(*)',
  'timetable_notes(*)'
].join(',');

function bySort(a, b) {
  return (a.sort_order || 0) - (b.sort_order || 0);
}

async function main() {
  const { url, key } = await readConfig();
  const endpoint =
    `${url}/rest/v1/timetables?select=${encodeURIComponent(SELECT)}&order=sort_order.asc`;

  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`Supabase responded ${res.status} ${res.statusText}`);
  }

  const rows = await res.json();
  const timetables = rows.map((t) => ({
    ...t,
    class_slots: (t.class_slots || []).sort(bySort),
    timetable_sections: (t.timetable_sections || []).sort(bySort),
    timetable_notes: (t.timetable_notes || []).sort(bySort)
  }));

  const snapshot = {
    generated_at: new Date().toISOString(),
    source: url,
    count: timetables.length,
    timetables
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  const slots = timetables.reduce((n, t) => n + t.class_slots.length, 0);
  console.log(
    `Wrote ${timetables.length} published timetables (${slots} class slots) to ` +
    'data/timetables.snapshot.json'
  );
}

main().catch((err) => {
  console.error('Snapshot failed:', err.message);
  process.exitCode = 1;
});
