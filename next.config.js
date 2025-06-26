/** @type {import('next').NextConfig} */
const nextConfig = {
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
  watchOptions: {
    // The `postinstall` script (now removed) and firebase CLI commands write to the `functions` directory.
    // This causes the Next.js dev server to restart endlessly.
    // To prevent this, we ignore the `functions` directory from being watched.
    ignored: ['**/functions/**'],
  },
};

module.exports = nextConfig;
