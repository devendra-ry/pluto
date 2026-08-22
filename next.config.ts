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
    return [
      {
        source: '/(.*)',
        headers: [
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
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
