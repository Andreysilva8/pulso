const path = require('node:path')
const { spawnSync } = require('node:child_process')
const electron = require('electron')

const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env
const result = spawnSync(electron, ['--disable-gpu', '--no-sandbox', '.', '--smoke-test'], {
  cwd: path.resolve(__dirname, '..'),
  env: cleanEnv,
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true,
})

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

const ready = result.stdout?.includes('PULSO_DESKTOP_READY')
if (result.error || result.status !== 0 || !ready) {
  console.error('O Electron de desenvolvimento não concluiu o smoke test.', result.error || result.status)
  process.exit(1)
}
