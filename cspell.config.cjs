const {baseConfig} = require('@virmator/spellcheck/configs/cspell.config.base.cjs');

module.exports = {
    ...baseConfig,
    ignorePaths: [
        ...baseConfig.ignorePaths,
        'packages/pdf-vir/www-static/pdf.worker.mjs',
    ],
    words: [
        ...baseConfig.words,
        'pdfium',
        'embedpdf',
        'emscripten',
    ],
};
