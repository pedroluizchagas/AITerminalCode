import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // O pacote de protocolo é TypeScript cru (sem build), então o Next precisa transpilá-lo.
  transpilePackages: ['@ati/protocol'],
  reactStrictMode: true,
  // ESLint não está configurado neste pacote; não bloquear o build de produção.
  eslint: { ignoreDuringBuilds: true },
  // Service worker minimalista servido de /public; cabeçalho para permitir escopo na raiz.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
