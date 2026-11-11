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
