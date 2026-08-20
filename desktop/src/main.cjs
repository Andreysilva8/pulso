const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  session,
  shell,
} = require('electron')
const {
  PULSO_APP_URL,
  canCheckPermission,
  canGrantPermission,
  isPulsoUrl,
  isTrustedDisplayRequest,
  safeExternalUrl,
} = require('./security.cjs')

const smokeTest = process.argv.includes('--smoke-test')
if (smokeTest) {
  app.setPath('userData', path.join(app.getPath('temp'), `pulso-desktop-smoke-${process.pid}`))
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.disableHardwareAcceleration()
}
let mainWindow = null
let activePicker = null
const OFFLINE_URL = pathToFileURL(path.join(__dirname, 'offline.html')).toString()
const SMOKE_DOCUMENT = '<!doctype html><html><head><meta charset="UTF-8"></head><body><main data-pulso-desktop-smoke>Pulso Desktop pronto.</main></body></html>'
const SMOKE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(SMOKE_DOCUMENT)}`
const grantedMediaTypes = new Set()
let mediaPermissionQueue = Promise.resolve(false)
let lastPulsoUrl = PULSO_APP_URL

function requestedMediaTypes(details) {
  const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : []
  return [...new Set(mediaTypes.filter((type) => type === 'audio' || type === 'video'))]
}

function mediaPermissionCopy(mediaTypes) {
  if (mediaTypes.includes('audio') && mediaTypes.includes('video')) {
    return {
      message: 'Permitir câmera e microfone?',
      detail: 'O Pulso só começará a capturar depois que você confirmar. Você ainda controla câmera e microfone pelos botões da chamada.',
    }
  }
  if (mediaTypes.includes('video')) {
    return {
      message: 'Permitir acesso à câmera?',
      detail: 'A câmera será aberta somente após esta confirmação e poderá ser desligada pelo botão da chamada.',
    }
  }
  return {
    message: 'Permitir acesso ao microfone?',
    detail: 'O microfone será usado na pré-sala e poderá ser silenciado ou trocado a qualquer momento.',
  }
}

async function confirmMediaPermission(mediaTypes) {
  const missing = mediaTypes.filter((type) => !grantedMediaTypes.has(type))
  if (!missing.length) return true
  if (!mainWindow || mainWindow.isDestroyed()) return false

  const copy = mediaPermissionCopy(missing)
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Permissão de mídia — Pulso',
    message: copy.message,
    detail: copy.detail,
    buttons: ['Permitir nesta sessão', 'Bloquear'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (result.response !== 0) return false
  for (const type of missing) grantedMediaTypes.add(type)
  return true
}

function finishPicker(result) {
  const picker = activePicker
  if (!picker) return
  activePicker = null
  picker.resolve(result)
  if (!picker.window.isDestroyed()) picker.window.close()
}

function isAllowedMainNavigation(rawUrl) {
  const offlinePage = rawUrl === OFFLINE_URL
    || rawUrl.startsWith(`${OFFLINE_URL}?`)
    || rawUrl.startsWith(`${OFFLINE_URL}#`)
  return offlinePage || isPulsoUrl(rawUrl)
}

function openSourcePicker(sources, audioRequested) {
  if (activePicker) finishPicker(null)

  const pickerWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: true,
    show: false,
    autoHideMenuBar: true,
    title: 'Escolha o que compartilhar — Pulso',
    backgroundColor: '#08121f',
    webPreferences: {
      preload: path.join(__dirname, 'picker-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
    },
  })

  pickerWindow.setMenuBarVisibility(false)
  pickerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  pickerWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  const sourceMap = new Map(sources.map((source) => [source.id, source]))
  const payload = {
    audioAvailable: process.platform === 'win32' && Boolean(audioRequested),
    sources: sources.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
      appIcon: source.appIcon?.isEmpty() === false ? source.appIcon.toDataURL() : '',
    })),
  }

  return new Promise((resolve) => {
    activePicker = { window: pickerWindow, sourceMap, resolve }

    pickerWindow.once('ready-to-show', () => pickerWindow.show())
    pickerWindow.webContents.once('did-finish-load', () => {
      if (!pickerWindow.isDestroyed()) pickerWindow.webContents.send('pulso-picker:sources', payload)
    })
    pickerWindow.once('closed', () => {
      if (activePicker?.window !== pickerWindow) return
      activePicker = null
      resolve(null)
    })
    void pickerWindow.loadFile(path.join(__dirname, 'picker.html')).catch((error) => {
      console.error('Falha ao carregar o seletor de compartilhamento.', error)
      if (activePicker?.window === pickerWindow) finishPicker(null)
    })
  })
}

ipcMain.on('pulso-picker:select', (event, payload) => {
  if (!activePicker || event.sender !== activePicker.window.webContents) return
  const source = typeof payload?.sourceId === 'string'
    ? activePicker.sourceMap.get(payload.sourceId)
    : null
  if (!source) return
  finishPicker({ source, includeAudio: Boolean(payload.includeAudio) })
})

ipcMain.on('pulso-picker:cancel', (event) => {
  if (!activePicker || event.sender !== activePicker.window.webContents) return
  finishPicker(null)
})

function configurePermissions() {
  const pulsoSession = session.defaultSession

  pulsoSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (webContents && webContents !== mainWindow.webContents) return false
    const requestingUrl = details?.requestingUrl || details?.securityOrigin || requestingOrigin
    return canCheckPermission(permission, requestingUrl, details, grantedMediaTypes)
  })

  pulsoSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || webContents.getURL()
    const trustedMainFrame = Boolean(
      mainWindow
        && !mainWindow.isDestroyed()
        && webContents === mainWindow.webContents
        && details?.isMainFrame
        && isPulsoUrl(requestingUrl),
    )
    if (permission !== 'media') {
      callback(trustedMainFrame && canGrantPermission(permission, requestingUrl))
      return
    }

    const mediaTypes = requestedMediaTypes(details)
    if (!trustedMainFrame || !mediaTypes.length) {
      callback(false)
      return
    }

    const permissionRequest = mediaPermissionQueue
      .catch(() => false)
      .then(() => confirmMediaPermission(mediaTypes))
    mediaPermissionQueue = permissionRequest
    void permissionRequest
      .then((allowed) => callback(allowed && mediaTypes.every((type) => grantedMediaTypes.has(type))))
      .catch(() => callback(false))
  })

  pulsoSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const expectedFrame = mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.webContents.mainFrame
      : null
    if (!isTrustedDisplayRequest(request, expectedFrame)) {
      callback({})
      return
    }

    try {
      const excludedIds = new Set()
      if (mainWindow && !mainWindow.isDestroyed()) excludedIds.add(mainWindow.getMediaSourceId())
      if (activePicker && !activePicker.window.isDestroyed()) excludedIds.add(activePicker.window.getMediaSourceId())

      const sources = (await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 480, height: 270 },
        fetchWindowIcons: true,
      })).filter((source) => !excludedIds.has(source.id))

      const choice = await openSourcePicker(sources, request.audioRequested)
      if (!choice) {
        callback({})
        return
      }

      callback({
        video: choice.source,
        ...(choice.includeAudio && request.audioRequested && process.platform === 'win32'
          ? { audio: 'loopback' }
          : {}),
      })
    } catch (error) {
      console.error('Falha ao abrir o seletor de compartilhamento.', error)
      callback({})
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 620,
    show: !smokeTest,
    autoHideMenuBar: true,
    title: 'Pulso',
    backgroundColor: '#08121f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged && !smokeTest,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isPulsoUrl(url)) {
      void mainWindow?.loadURL(url)
      return { action: 'deny' }
    }
    const external = safeExternalUrl(url)
    if (external) void shell.openExternal(external)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMainNavigation(url)) return
    event.preventDefault()
    const external = safeExternalUrl(url)
    if (external) void shell.openExternal(external)
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isPulsoUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !isPulsoUrl(validatedUrl)) return
    lastPulsoUrl = validatedUrl
    void mainWindow?.loadFile(path.join(__dirname, 'offline.html'), {
      query: { returnTo: lastPulsoUrl },
    })
  })
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    if (isPulsoUrl(url)) lastPulsoUrl = url
  })
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    if (isPulsoUrl(url)) lastPulsoUrl = url
  })
  mainWindow.webContents.once('did-finish-load', async () => {
    if (!smokeTest || !mainWindow || mainWindow.isDestroyed()) return
    try {
      const result = await mainWindow.webContents.executeJavaScript(`({
        url: location.href,
        electron: /Electron\\//.test(navigator.userAgent),
        packagedShell: Boolean(document.querySelector('[data-pulso-desktop-smoke]'))
      })`)
      const valid = result?.url?.startsWith('data:text/html;charset=utf-8,')
        && result?.electron === true
        && result?.packagedShell === true
      console.log(`PULSO_DESKTOP_READY ${JSON.stringify(result)}`)
      app.exit(valid ? 0 : 1)
    } catch (error) {
      console.error('PULSO_DESKTOP_FAILED', error)
      app.exit(1)
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  if (smokeTest) void mainWindow.loadURL(SMOKE_URL)
  else void mainWindow.loadURL(PULSO_APP_URL)
}

const hasSingleInstanceLock = smokeTest || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    if (smokeTest) {
      const timeout = setTimeout(() => {
        console.error('PULSO_DESKTOP_FAILED timeout')
        app.exit(1)
      }, 20_000)
      timeout.unref()
    }
    app.setAppUserModelId('com.pulso.desktop')
    configurePermissions()
    createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
