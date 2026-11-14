// The fxmind mark: the brain of docs/assets/logo.png with its FX plate, drawn as one mask over a flat fill so the
// faint and tilted copies (settings, agent panel) and the theme's turn of the fill keep working. The fill is the
// accent the theme turns (mint in the fxmind theme), the plate is cut out and the letters stay in the fill.
export const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><mask id="kem">' +
  '<g fill="#fff"><circle cx="31" cy="32" r="17"/><circle cx="50" cy="26" r="18"/><circle cx="69" cy="32" r="17"/>' +
  '<circle cx="20" cy="52" r="15"/><circle cx="80" cy="52" r="15"/><circle cx="30" cy="71" r="16"/>' +
  '<circle cx="70" cy="71" r="16"/><circle cx="50" cy="77" r="15"/><rect x="22" y="28" width="56" height="48"/></g>' +
  '<path d="M50 7V33M50 69V93" stroke="#000" stroke-width="3.5" stroke-linecap="round" fill="none"/>' +
  '<rect x="18" y="35" width="64" height="31" rx="7" fill="#000"/>' +
  '<text x="50" y="60" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="27" font-weight="800" letter-spacing="1" fill="#fff">FX</text>' +
  '</mask></defs><g mask="url(#kem)"><rect width="100" height="100" fill="#a79cf7"/></g></svg>'

// Shared texture for all FXMIND panels. Coordinates follow the *visible*
// panel, not a large off-screen SVG. The SDK clips absolute layers to the
// actual Box; a 448px high image hid the watermark in a ~130px modal.
const MARK_INNER = MARK_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace('fill="#a79cf7"', 'fill="#ffffff"')

const textureCache = new Map<string, string>()

/** Compact, theme-aware microcircuit texture, consistent across every view. */
export function textureSvg(width: number, height: number, accent = '#92b9a8'): string {
  const key = `${width}:${height}:${accent}`
  const cached = textureCache.get(key)
  if (cached) return cached
  const logoSize = Math.min(106, Math.round(height * .72))
  const x = width - logoSize - 48
  const y = Math.round((height - logoSize) / 2)
  const circuits = Array.from({ length: 18 }, (_, i) => {
    const cx = 12 + i * 54
    const cy = (i * 37 + 16) % height
    const nx = cx + 26
    const ny = (cy + (i % 2 ? 19 : -16) + height) % height
    return `<path d="M${cx} ${cy}L${nx} ${ny}l19 ${i % 2 ? 8 : -9}" fill="none" stroke="#d0e9db" stroke-opacity=".19" stroke-width=".8"/><circle cx="${cx}" cy="${cy}" r="1.25" fill="#e0f7eb" fill-opacity=".38"/><circle cx="${nx}" cy="${ny}" r=".75" fill="#e0f7eb" fill-opacity=".30"/>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMaxYMid slice">` +
    '<defs><pattern id="fxdots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".65" fill="#e5f5e9" opacity=".20"/></pattern>' +
    `<linearGradient id="fxwash"><stop stop-color="${accent}" stop-opacity=".015"/><stop offset=".48" stop-color="${accent}" stop-opacity=".045"/><stop offset="1" stop-color="${accent}" stop-opacity=".16"/></linearGradient>` +
    '<radialGradient id="fxhalo"><stop stop-color="#f4fff6" stop-opacity=".10"/><stop offset="1" stop-color="#e2ffe8" stop-opacity="0"/></radialGradient></defs>' +
    `<rect width="${width}" height="${height}" fill="url(#fxwash)"/><rect width="${width}" height="${height}" fill="url(#fxdots)"/>` +
    `<g>${circuits}</g><ellipse cx="${Math.round(width * .84)}" cy="${Math.round(height * .5)}" rx="${Math.round(width * .36)}" ry="${Math.round(height * .85)}" fill="url(#fxhalo)"/>` +
    `<svg x="${x}" y="${y}" width="${logoSize}" height="${logoSize}" viewBox="0 0 100 100" opacity=".15"><g transform="rotate(-12 50 50)">${MARK_INNER}</g></svg>` +
    '</svg>'
  if (textureCache.size >= 16) textureCache.clear()
  textureCache.set(key, svg)
  return svg
}

// Same material, scaled to the panel's real height.
export const TEXTURE_SVG = textureSvg(960, 96)
export const TEXTURE_TALL_SVG = textureSvg(960, 160)
