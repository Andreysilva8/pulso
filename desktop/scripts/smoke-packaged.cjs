const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (process.platform !== 'win32') {
  console.log('Smoke empacotado ignorado fora do Windows.')
  process.exit(0)
}

const executable = path.resolve(__dirname, '..', '..', 'release', 'win-unpacked', 'Pulso.exe')
const { ELECTRON_RUN_AS_NODE: _ignored, ...cleanEnv } = process.env
const result = spawnSync(executable, ['--disable-gpu', '--no-sandbox', '--smoke-test'], {
  env: cleanEnv,
  encoding: 'utf8',
  timeout: 30_000,
  windowsHide: true,
})

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)

const ready = result.stdout?.includes('PULSO_DESKTOP_READY')
if (result.error || result.status !== 0 || !ready) {
  console.error('O executável empacotado não concluiu o smoke test.', result.error || result.status)
  process.exit(1)
}
