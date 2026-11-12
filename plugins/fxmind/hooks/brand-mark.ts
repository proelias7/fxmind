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

// The fxmind texture, one for every panel: a fine net of thoughts (small nodes joined by hairlines) that turns
// across the surface. It is white at a whisper, so it takes the colour of whatever panel it lies on.
export const TEXTURE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="240" viewBox="0 0 1600 240" preserveAspectRatio="none">' +
  '<defs><pattern id="net" width="30" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">' +
  '<path d="M4 5L19 11L10 22M19 11L30 3M10 22L-2 28" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1"/>' +
  '<g fill="#fff"><circle cx="4" cy="5" r="1.3" fill-opacity=".26"/><circle cx="19" cy="11" r="1.6" fill-opacity=".32"/>' +
  '<circle cx="10" cy="22" r="1.2" fill-opacity=".22"/></g></pattern>' +
  '<linearGradient id="fd" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></linearGradient>' +
  '<mask id="fm"><rect width="1600" height="240" fill="url(#fd)"/></mask></defs>' +
  '<rect width="1600" height="240" fill="url(#net)" mask="url(#fm)"/></svg>'

// The mark as a faint watermark for a panel's right edge: white, tilted, at a whisper, over the texture.
export const WATERMARK_SVG = MARK_SVG.replace('<g mask=', '<g opacity=".09" transform="rotate(-12 50 50)" mask=').replace('fill="#a79cf7"', 'fill="#ffffff"')
