const { nodeResolve } = require('@rollup/plugin-node-resolve');
const { minify } = require('rollup-plugin-esbuild-minify');
const postcss = require('rollup-plugin-postcss');

module.exports = [
  // JavaScript bundle - PDF Viewer
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
  // JavaScript bundle - Mermaid Renderer for Markdown Preview
  {
    input: 'src/markdown/scripts/mermaidRenderer.js',
    output: {
      file: 'out/markdown/scripts/mermaidRenderer.js',
      format: 'iife',
      name: 'MermaidRenderer'
    },
    plugins: [
      nodeResolve()
      // Note: No minification to preserve dynamic import from CDN
    ]
  },
  // CSS bundle - PDF Viewer
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
  },
  // CSS bundle - Mermaid styles for Markdown Preview
  {
    input: 'src/markdown/styles/mermaid.css',
    output: {
      file: 'out/markdown/styles/mermaid.css'
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