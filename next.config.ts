import type { NextConfig } from "next";

function getSupabaseStorageRemotePatterns(): NonNullable<NextConfig['images']>['remotePatterns'] {
  const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!rawSupabaseUrl) {
    return [];
  }

  try {
    const parsed = new URL(rawSupabaseUrl);
    const protocol = parsed.protocol.replace(':', '') as 'http' | 'https';
    const port = parsed.port || '';

    return [
      {
        protocol,
        hostname: parsed.hostname,
        port,
        pathname: "/storage/v1/object/sign/**",
      },
      {
        protocol,
        hostname: parsed.hostname,
        port,
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: getSupabaseStorageRemotePatterns(),
  },
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';

    // Construct CSP header
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'unsafe-inline' ${isProd ? '' : "'unsafe-eval'"} https://va.vercel-scripts.com https://vercel.live;
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      font-src 'self' data: https://fonts.gstatic.com;
      img-src 'self' blob: data: https://*.supabase.co;
      connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://*.vercel-insights.com https://*.vercel-scripts.com;
      frame-src 'self' https://vercel.live;
      worker-src 'self' blob:;
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      ${isProd ? 'upgrade-insecure-requests;' : ''}
    `.replace(/\s{2,}/g, ' ').trim();

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader,
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
