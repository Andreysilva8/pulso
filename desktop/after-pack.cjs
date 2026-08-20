const path = require('node:path')
const {
  flipFuses,
  FuseV1Options,
  FuseVersion,
} = require('@electron/fuses')

module.exports = async function hardenElectron(context) {
  const executableName = context.packager.appInfo.productFilename
  const executablePath = path.join(
    context.appOutDir,
    context.electronPlatformName === 'win32' ? `${executableName}.exe` : executableName,
  )

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  })
}
