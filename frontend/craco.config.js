// Load configuration from environment or config file
const path = require('path');

// Environment variable overrides
const config = {
  disableHotReload: process.env.DISABLE_HOT_RELOAD === 'true',
};

module.exports = {
  webpack: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    configure: (webpackConfig, { env, paths }) => {
      
      // Optimizations for West Africa - slower networks
      if (env === 'production') {
        // Enable advanced code splitting for better caching
        webpackConfig.optimization = {
          ...webpackConfig.optimization,
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxSize: 200000, // Max 200KB chunks for slow networks
            cacheGroups: {
              // Separate Radix UI components for better caching
              radixui: {
                test: /[\\/]node_modules[\\/]@radix-ui[\\/]/,
                name: 'radixui',
                chunks: 'all',
                priority: 30,
                reuseExistingChunk: true,
              },
              // Separate React/React-DOM
              react: {
                test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
                name: 'react',
                chunks: 'all',
                priority: 25,
                reuseExistingChunk: true,
              },
              // Language translations (lazy load)
              translations: {
                test: /[\\/]src[\\/]contexts[\\/]LanguageContext\.js/,
                name: 'translations',
                chunks: 'all',
                priority: 20,
              },
              // Common libraries
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendor',
                chunks: 'all',
                priority: 10,
                reuseExistingChunk: true,
              },
            },
          },
        };

        // Compress heavily for West African networks
        webpackConfig.optimization.minimize = true;
        
        // Remove source maps in production to reduce bundle size
        webpackConfig.devtool = false;
        
        // Add performance hints for slow networks
        webpackConfig.performance = {
          maxAssetSize: 250000, // 250KB per asset max
          maxEntrypointSize: 400000, // 400KB max entry point
          hints: 'warning',
        };
      }
      
      // Disable hot reload completely if environment variable is set
      if (config.disableHotReload) {
        // Remove hot reload related plugins
        webpackConfig.plugins = webpackConfig.plugins.filter(plugin => {
          return !(plugin.constructor.name === 'HotModuleReplacementPlugin');
        });
        
        // Disable watch mode
        webpackConfig.watch = false;
        webpackConfig.watchOptions = {
          ignored: /.*/, // Ignore all files
        };
      } else {
        // Add ignored patterns to reduce watched directories
        webpackConfig.watchOptions = {
          ...webpackConfig.watchOptions,
          ignored: [
            '**/node_modules/**',
            '**/.git/**',
            '**/build/**',
            '**/dist/**',
            '**/coverage/**',
            '**/public/**',
          ],
        };
      }
      
      return webpackConfig;
    },
  },
  devServer: {
    // Enable compression for development too (West Africa optimization)
    compress: true,
  },
};