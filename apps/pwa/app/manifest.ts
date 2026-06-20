import type { MetadataRoute } from 'next'

/**
 * Web App Manifest (servido em /manifest.webmanifest).
 * Ícones em SVG maskable — evitam precisar de PNGs binários no repo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AITerminalControl',
    short_name: 'AITerminal',
    description: 'Controle o OpenClaude do seu PC de casa, do celular.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
