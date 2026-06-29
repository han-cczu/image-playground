export function shouldRuntimeCache({ method, requestUrl, serviceWorkerUrl, pathname }) {
  if (method !== 'GET') return false

  const url = new URL(requestUrl)
  const swUrl = new URL(serviceWorkerUrl)
  const scopePath = swUrl.pathname.replace(/[^/]*$/, '')
  const assetsPath = `${scopePath}assets/`
  return url.origin === swUrl.origin && (pathname ?? url.pathname).startsWith(assetsPath)
}
