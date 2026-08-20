const grid = document.querySelector('#source-grid')
const screensTab = document.querySelector('#screens-tab')
const windowsTab = document.querySelector('#windows-tab')
const audioOption = document.querySelector('#audio-option')
const includeAudio = document.querySelector('#include-audio')
const cancelButton = document.querySelector('#cancel-button')
const shareButton = document.querySelector('#share-button')

let sources = []
let activeType = 'screen'
let selectedSourceId = ''

function visibleSources() {
  return sources.filter((source) => source.type === activeType)
}

function chooseSource(sourceId) {
  selectedSourceId = sourceId
  shareButton.disabled = !selectedSourceId
  renderSources()
}

function renderSources() {
  const list = visibleSources()
  grid.replaceChildren()

  if (!list.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.innerHTML = `<strong>Nenhuma ${activeType === 'screen' ? 'tela' : 'janela'} disponível</strong><span>Tente abrir a janela desejada e volte a compartilhar.</span>`
    grid.append(empty)
    return
  }

  for (const source of list) {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = `source-card ${selectedSourceId === source.id ? 'is-selected' : ''}`
    card.setAttribute('aria-pressed', String(selectedSourceId === source.id))
    card.setAttribute('aria-label', source.name)

    const preview = document.createElement('span')
    preview.className = 'source-card__preview'
    if (source.thumbnail) {
      const image = document.createElement('img')
      image.src = source.thumbnail
      image.alt = ''
      preview.append(image)
    }

    const copy = document.createElement('span')
    copy.className = 'source-card__copy'
    if (source.appIcon) {
      const icon = document.createElement('img')
      icon.src = source.appIcon
      icon.alt = ''
      copy.append(icon)
    }
    const title = document.createElement('strong')
    title.textContent = source.name
    copy.append(title)

    card.append(preview, copy)
    card.addEventListener('click', () => chooseSource(source.id))
    card.addEventListener('dblclick', () => {
      chooseSource(source.id)
      submitSelection()
    })
    grid.append(card)
  }
}

function setActiveType(type) {
  activeType = type
  const firstVisible = sources.find((source) => source.type === type)
  if (!sources.some((source) => source.id === selectedSourceId && source.type === type)) {
    selectedSourceId = firstVisible?.id || ''
  }
  screensTab.setAttribute('aria-selected', String(type === 'screen'))
  windowsTab.setAttribute('aria-selected', String(type === 'window'))
  shareButton.disabled = !selectedSourceId
  renderSources()
}

function submitSelection() {
  if (!selectedSourceId) return
  window.pulsoPicker.select(selectedSourceId, includeAudio.checked)
  shareButton.disabled = true
  cancelButton.disabled = true
}

screensTab.addEventListener('click', () => setActiveType('screen'))
windowsTab.addEventListener('click', () => setActiveType('window'))
shareButton.addEventListener('click', submitSelection)
cancelButton.addEventListener('click', () => window.pulsoPicker.cancel())
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.pulsoPicker.cancel()
})

window.pulsoPicker.onSources((payload) => {
  sources = Array.isArray(payload?.sources) ? payload.sources : []
  const audioAvailable = Boolean(payload?.audioAvailable)
  includeAudio.disabled = !audioAvailable
  audioOption.classList.toggle('is-disabled', !audioAvailable)
  setActiveType(sources.some((source) => source.type === 'screen') ? 'screen' : 'window')
})
