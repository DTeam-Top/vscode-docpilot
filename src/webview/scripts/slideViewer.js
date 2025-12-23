/**
 * Slide Viewer for VSCode Markdown Preview
 * Renders markdown files as reveal.js presentations
 */

(async () => {
  // Get VS Code API
  const vscode = acquireVsCodeApi();

  // State management
  let revealInstance = null;
  let settings = null;
  let markdownContent = '';

  /**
   * Load CSS dynamically
   */
  async function loadCSS(href, id = null) {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (id && document.getElementById(id)) {
        resolve();
        return;
      }

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      if (id) link.id = id;

      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`));

      document.head.appendChild(link);
    });
  }

  /**
   * Get VSCode theme
   */
  function getVSCodeTheme() {
    const bodyClass = document.body.className;
    if (bodyClass.includes('vscode-dark') || bodyClass.includes('vscode-high-contrast')) {
      return 'dark';
    }
    return 'light';
  }

  /**
   * Map VSCode theme to Reveal.js theme
   */
  function mapToRevealTheme(userTheme) {
    const vscodeTheme = getVSCodeTheme();

    // If user explicitly chose a theme, use it
    if (userTheme && userTheme !== 'auto') {
      return userTheme;
    }

    // Otherwise map VSCode theme
    return vscodeTheme === 'dark' ? 'black' : 'white';
  }

  /**
   * Transform markdown content into reveal.js slides
   */
  function transformMarkdownToSlides(markdown) {
    // Split by horizontal slide separator (---)
    const slides = markdown.split(/\n---\n/);

    let slideHTML = '';

    for (const slideContent of slides) {
      // Check for vertical slides (----)
      if (slideContent.includes('\n----\n')) {
        // This slide has vertical sub-slides
        const verticalSlides = slideContent.split(/\n----\n/);
        slideHTML += '<section>\n';

        for (const vSlide of verticalSlides) {
          slideHTML += `<section data-markdown>\n<textarea data-template>\n${vSlide.trim()}\n</textarea>\n</section>\n`;
        }

        slideHTML += '</section>\n';
      } else {
        // Regular horizontal slide
        slideHTML += `<section data-markdown>\n<textarea data-template>\n${slideContent.trim()}\n</textarea>\n</section>\n`;
      }
    }

    return slideHTML;
  }

  /**
   * Initialize Reveal.js
   */
  async function initializeReveal() {
    try {
      // Hide loading indicator
      const loadingIndicator = document.getElementById('loadingIndicator');

      // Load Reveal.js core and theme CSS from cdnjs
      const revealTheme = mapToRevealTheme(settings.theme);
      await loadCSS(
        'https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.2.1/reveal.min.css',
        'reveal-core-css'
      );
      await loadCSS(
        `https://cdnjs.cloudflare.com/ajax/libs/reveal.js/5.2.1/theme/${revealTheme}.min.css`,
        'reveal-theme-css'
      );

      // Load highlight.js theme for code blocks
      const highlightTheme = getVSCodeTheme() === 'dark' ? 'monokai' : 'github';
      await loadCSS(
        `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${highlightTheme}.min.css`,
        'highlight-css'
      );

      // Transform markdown to slides
      const slidesHTML = transformMarkdownToSlides(markdownContent);
      const slidesContainer = document.getElementById('slidesContainer');
      slidesContainer.innerHTML = slidesHTML;

      // Dynamic import of Reveal.js and plugins
      const [
        { default: Reveal },
        { default: RevealMarkdown },
        { default: RevealHighlight },
        { default: RevealNotes },
        { default: RevealMath },
        { default: RevealMermaid },
      ] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.esm.js'),
        import('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/markdown/markdown.esm.js'),
        import('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/highlight/highlight.esm.js'),
        import('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/notes/notes.esm.js'),
        import('https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/math/math.esm.js'),
        import(
          'https://cdn.jsdelivr.net/npm/reveal.js-mermaid-plugin@2/plugin/mermaid/mermaid.esm.js'
        ),
      ]);

      // Configure Reveal.js
      const config = {
        embedded: false,
        controls: settings.controls !== false,
        progress: settings.progress !== false,
        slideNumber: settings.slideNumber === true,
        transition: settings.transition || 'slide',
        hash: true,
        plugins: [RevealMarkdown, RevealHighlight, RevealNotes, RevealMermaid, RevealMath.KaTeX],
        markdown: {
          smartypants: true,
        },
        // KaTeX math rendering config
        math: {
          mathjax: null,
          katex: {
            version: 'latest',
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
              { left: '\\[', right: '\\]', display: true },
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
          },
        },
        keyboard: {
          27: () => {
            // ESC key - show info message
            vscode.postMessage({
              type: 'showMessage',
              message: 'Press Alt+F4 or close the tab to exit slide mode',
            });
          },
        },
      };

      // Initialize Reveal
      const revealElement = document.querySelector('.reveal');
      revealInstance = new Reveal(revealElement, config);
      await revealInstance.initialize();

      if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
      }
    } catch (error) {
      console.error('Failed to initialize Reveal.js:', error);
      const loadingIndicator = document.getElementById('loadingIndicator');
      if (loadingIndicator) {
        loadingIndicator.innerHTML = `
          <div style="color: var(--vscode-errorForeground); text-align: center;">
            <h2>Failed to load slides</h2>
            <p>${error.message || 'Unknown error'}</p>
          </div>
        `;
      }
    }
  }

  /**
   * Handle messages from extension
   */
  window.addEventListener('message', async (event) => {
    const message = event.data;

    switch (message.type) {
      case 'settingsLoaded':
        settings = message.data;
        // If we have both settings and content, initialize
        if (markdownContent) {
          await initializeReveal();
        }
        break;

      case 'markdownContentLoaded':
        markdownContent = message.data.content;
        // If we have both settings and content, initialize
        if (settings) {
          await initializeReveal();
        }
        break;

      case 'markdownContentError':
        console.error('Failed to load markdown:', message.error);
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator) {
          loadingIndicator.innerHTML = `
            <div style="color: var(--vscode-errorForeground); text-align: center;">
              <h2>Failed to load markdown file</h2>
              <p>${message.error || 'Unknown error'}</p>
            </div>
          `;
        }
        break;
    }
  });

  /**
   * Initialize on load
   */
  async function initialize() {
    try {
      // Request settings and markdown content from extension
      vscode.postMessage({ type: 'getSettings' });
      vscode.postMessage({ type: 'getMarkdownContent' });
    } catch (error) {
      console.error('Failed to initialize slide viewer:', error);
    }
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
