const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Enable support for additional file types
config.resolver.assetExts.push(
  // Adds support for `.db` files for SQLite databases
  'db'
);

// Enable support for importing from node_modules
config.resolver.nodeModulesPaths = [
  // Default node_modules directory
  './node_modules',
  // Allow imports from the parent directory's node_modules
  '../node_modules',
];

module.exports = config;