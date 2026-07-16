/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The public gallery pages (/@user/slug) are intentionally embeddable via
  // ?embed=1, so we can't set a site-wide anti-framing header. Instead deny
  // framing explicitly on the sensitive routes — dashboard, admin, and the auth
  // forms — so no other origin can iframe them for clickjacking. The public
  // exhibition + artist pages stay framable (that's the embed feature).
  async headers() {
    const denyFraming = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ]
    return ['/me', '/admin', '/signin', '/signup', '/reset'].map((source) => ({
      source,
      headers: denyFraming,
    }))
  },
}

export default nextConfig
