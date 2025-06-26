import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config) => {
    if (!config.watchOptions) {
      config.watchOptions = {};
    }
    const existingIgnored = config.watchOptions.ignored || [];
    const ignoredAsArray = Array.isArray(existingIgnored) ? existingIgnored : [existingIgnored];
    config.watchOptions.ignored = [...ignoredAsArray, '**/functions/**'];
    return config;
  },
};

export default nextConfig;
