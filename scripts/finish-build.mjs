// The two builds land in one package, so each half needs the marker node reads to decide how to
// load it: without these, dist/cjs is parsed as ESM because the root package.json says module.
import { writeFileSync } from 'node:fs';

writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log('wrote the module-type markers into dist/cjs and dist/esm');
