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

// The fxmind texture, one for every panel: a fine net of thoughts (small nodes joined by hairlines) with the mark,
// large and faint, near the right edge. Built the way the panels' own art is (which the app draws): the same <style>
// head, a right-anchored slice, one plain pattern (no transform, no mask), at one pixel per unit, so it is laid out
// and drawn like that art, in the same right-anchored box.
const NET =
  '<pattern id="fxnet" width="30" height="26" patternUnits="userSpaceOnUse">' +
  '<path d="M4 5L19 11L10 22M19 11L30 3M10 22L-2 28M0 3L4 5M30 28L26 26" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1"/>' +
  '<circle cx="4" cy="5" r="1.3" fill="#fff" fill-opacity=".26"/><circle cx="19" cy="11" r="1.6" fill="#fff" fill-opacity=".32"/>' +
  '<circle cx="10" cy="22" r="1.2" fill="#fff" fill-opacity=".22"/></pattern>'
const MARK_INNER = MARK_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace('fill="#a79cf7"', 'fill="#ffffff"')

/** The texture at width by height pixels: the net over all of it, the mark near the right, centred on the height. */
export function textureSvg(width: number, height: number): string {
  const size = Math.min(170, Math.round(height * 1.25))
  const x = width - size - 40
  const y = Math.round(height / 2 - size / 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMaxYMid slice">` +
    '<style>:root{color-scheme:light dark}html,body{margin:0}svg{background:transparent;display:block}</style>' +
    `<defs>${NET}</defs><rect width="${width}" height="${height}" fill="url(#fxnet)"/>` +
    `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100" opacity=".12"><g transform="rotate(-12 50 50)">${MARK_INNER}</g></svg>` +
    '</svg>'
}
/** The size every band's art is drawn at (FROST_WIDTH * 2 by FROST_HEIGHT * 2), and the settings panel's taller one. */
export const TEXTURE_SVG = textureSvg(880, 128)
export const TEXTURE_TALL_SVG = textureSvg(880, 256)
