import type { NextConfig } from "next";

/**
 * Vercel / Next performance defaults for the OFL catalog.
 * - cacheComponents: Partial Prerender static shell + stream client islands
 * - optimizePackageImports: tree-shake heavy icon / query / state packages
 * - headers: long CDN cache for public static assets
 * - images: remotePatterns only (catalog prefers zero raster images)
 */
const nextConfig: NextConfig = {
  // Next 16 PPR / Cache Components — static shell + streaming dynamic holes
  cacheComponents: true,

  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  // Allow Playwright (and other local tooling) on 127.0.0.1 during dev HMR.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  images: {
    // Prefer no next/image in the font catalog; allow-list kept for future chrome.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.jsdelivr.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/**",
      },
    ],
  },

  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@tanstack/react-query",
      "@tanstack/react-table",
      "@tanstack/react-virtual",
      "xstate",
      "@xstate/react",
    ],
  },

  async headers() {
    // Note: /_next/static/* already gets immutable Cache-Control from Next.js.
    // Do not override it — custom headers trigger a build warning and can
    // interfere with dev HMR. CDN still caches hashed assets long-term.
    return [
      // Public static files (svg/ico)
      {
        source: "/:path*.(svg|ico|png|jpg|jpeg|gif|webp|woff2|woff)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
