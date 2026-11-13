// Fails when the committed generated types drift from openapi.yaml.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'gelatik-contract-'))
const out = join(dir, 'schema.d.ts')
try {
  execFileSync('npx', ['openapi-typescript', 'openapi.yaml', '-o', out], { stdio: 'pipe' })
  const committed = readFileSync(new URL('../../../apps/web/src/api/schema.d.ts', import.meta.url), 'utf8')
  if (readFileSync(out, 'utf8') !== committed) {
    console.error('apps/web/src/api/schema.d.ts is out of date. Run: npm run contracts:generate')
    process.exit(1)
  }
  console.log('Contract types are up to date.')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
