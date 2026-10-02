// 冒烟校验的启动器：用 esbuild 的 JS API 打包校验脚本（自动选对平台二进制），再执行。
// 用法：npm run verify:hazard
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'node_modules/.cache/verify-hazard-rules.mjs')

await build({
  entryPoints: [resolve(root, 'scripts/verify-hazard-rules.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': resolve(root, 'src') },
  outfile,
  logLevel: 'silent',
})

await import(outfile)
