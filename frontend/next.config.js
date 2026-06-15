/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'

const nextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  swcMinify: true,

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'StockSense India',
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ]
  },

  async headers() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || ''
    const connectSrc = [
      "'self'",
      apiUrl,
      wsUrl,
      'ws://localhost:*',
      'http://localhost:*',
      'https://*.up.railway.app',
      'wss://*.up.railway.app',
    ].filter(Boolean).join(' ')

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "frame-src 'self'",
              `connect-src ${connectSrc}`,
              "font-src 'self' data:",
            ].join('; '),
          },
        ],
      },
    ]
  },

  images: {
    domains: ['localhost'],
  },
}

module.exports = nextConfig
