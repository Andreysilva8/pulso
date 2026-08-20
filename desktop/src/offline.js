const PULSO_ORIGIN = 'https://pulso-9ojl.onrender.com'
const retryLink = document.querySelector('#retry-link')

try {
  const returnTo = new URL(location.href).searchParams.get('returnTo')
  if (returnTo && new URL(returnTo).origin === PULSO_ORIGIN && retryLink) {
    retryLink.href = returnTo
  }
} catch {
  // Keep the safe home URL already present in the HTML.
}

window.addEventListener('online', () => retryLink?.click(), { once: true })
