// Lists every [FILL] in the content JSON with its path, so the owner sees each gap. Exit 0 always.
import { readFileSync } from 'node:fs';

const FILES = ['content/projects.json', 'content/profile.json', 'content/strings.json'];

function walk(value, path, out) {
  if (typeof value === 'string') {
    if (value.includes('[FILL')) out.push(`${path}: ${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`, out);
  }
  return out;
}

let total = 0;
for (const file of FILES) {
  const data = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  const name = file.replace(/^content\//, '').replace(/\.json$/, '');
  const lines = walk(data, name, []);
  total += lines.length;
  for (const line of lines) console.log(line);
}
console.log(`${total} [FILL] item(s)`);
