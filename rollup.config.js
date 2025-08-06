const { nodeResolve } = require('@rollup/plugin-node-resolve');
const { minify } = require('rollup-plugin-esbuild-minify');
const postcss = require('rollup-plugin-postcss');

module.exports = [
  // JavaScript bundle
  {
    input: 'src/webview/scripts/pdfViewer.js',
    output: {
      file: 'out/webview/scripts/pdfViewer.min.js',
      format: "esm",
      name: 'PDFViewer'
    },
    plugins: [
      nodeResolve(),
      minify()
    ]
  },
  // CSS bundle
  {
    input: 'src/webview/styles/pdfViewer.css',
    output: {
      file: 'out/webview/styles/pdfViewer.min.css'
    },
    plugins: [
      postcss({
        extract: true,
        minimize: true,
        sourceMap: false
      })
    ]
  }
];