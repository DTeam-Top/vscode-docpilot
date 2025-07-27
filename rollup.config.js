const { nodeResolve } = require('@rollup/plugin-node-resolve');
const { minify } = require('rollup-plugin-esbuild-minify');

module.exports = {
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
};