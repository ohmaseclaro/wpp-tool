const { join } = require('path');

// Keep Chrome inside the project so clearing ~/.cache/puppeteer cannot break the tool.
module.exports = { cacheDirectory: join(__dirname, '.cache', 'puppeteer') };
