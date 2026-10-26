/**
 * Mermaid Renderer for VSCode Markdown Preview
 * Automatically renders Mermaid diagrams in markdown preview mode
 */

(() => {
  // Mermaid is imported from CDN on first use, so nothing is loaded when
  // VSCode's built-in Mermaid renderer handles the preview
  let mermaidPromise = null;
  const loadMermaid = () => {
    mermaidPromise ??= import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
      .then((module) => {
        initializeMermaid(module.default);
        return module.default;
      })
      .catch((error) => {
        // Allow a retry on the next render (e.g. after a network hiccup)
        mermaidPromise = null;
        throw error;
      });
    return mermaidPromise;
  };

  // Detect VSCode theme
  const getTheme = () => {
    const bodyClass = document.body.className;
    if (bodyClass.includes('vscode-dark') || bodyClass.includes('vscode-high-contrast')) {
      return 'dark';
    }
    return 'default';
  };

  // Initialize Mermaid with VSCode theme
  const initializeMermaid = (mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      theme: getTheme(),
      securityLevel: 'loose',
      fontFamily: 'var(--vscode-font-family)',
      // Additional config for better VSCode integration
      themeVariables: {
        fontSize: '14px',
      },
    });
  };

  // Create a container for the rendered diagram
  const createDiagramContainer = (index, code) => {
    const container = document.createElement('div');
    container.className = 'mermaid-container';
    container.setAttribute('data-diagram-index', index);
    // Keep the original source so the diagram can be re-rendered (e.g. on theme change)
    container.setAttribute('data-mermaid-source', code);
    return container;
  };

  // Render a single Mermaid diagram
  const renderDiagram = async (mermaid, code, container, index) => {
    try {
      const id = `mermaid-diagram-${Date.now()}-${index}`;
      const { svg } = await mermaid.render(id, code);
      container.innerHTML = svg;
      container.classList.remove('mermaid-error-container');
      container.classList.add('mermaid-rendered');
    } catch (error) {
      console.error('Mermaid rendering error:', error);
      container.innerHTML = `<div class="mermaid-error">
        <strong>Mermaid Syntax Error</strong>
        <pre>${escapeHtml(error.message || 'Unknown error')}</pre>
      </div>`;
      container.classList.remove('mermaid-rendered');
      container.classList.add('mermaid-error-container');
    }
  };

  // Escape HTML to prevent XSS
  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Check if we're in reveal.js mode
  const isRevealMode = () => {
    return document.querySelector('.reveal') !== null;
  };

  // VSCode 1.143+ ships a built-in Mermaid renderer (vscode.mermaid-markdown-features) whose
  // markdown-it plugin adds this marker to the preview. When present, defer to it entirely:
  // running both makes them race over the same blocks.
  const hasBuiltInMermaid = () => {
    return document.getElementById('markdown-mermaid') !== null;
  };

  // A block must still hold Mermaid source text. If it is inside one of our containers,
  // or already contains an SVG (rendered by another renderer, e.g. VS Code's built-in
  // preview or another extension), its textContent is SVG labels + CSS, not Mermaid source.
  const isUnrenderedSource = (element) => {
    return !element.closest('.mermaid-container') && !element.querySelector('svg');
  };

  // Find and render all Mermaid diagrams
  const renderAllMermaidDiagrams = async () => {
    // Skip if in reveal.js mode (reveal.js handles mermaid itself)
    if (isRevealMode() || hasBuiltInMermaid()) {
      return;
    }

    // Format 1: ```mermaid code blocks (rendered by markdown-it as <pre><code class="language-mermaid">)
    // Format 2: <pre class="mermaid"> HTML blocks
    const selector = 'pre > code.language-mermaid, pre.mermaid';
    const blocks = [...document.querySelectorAll(selector)].filter(isUnrenderedSource);
    if (blocks.length === 0) {
      return;
    }

    const mermaid = await loadMermaid();
    let index = document.querySelectorAll('.mermaid-container').length;
    for (const block of blocks) {
      // Re-check: the DOM may have changed while Mermaid was loading or rendering
      if (!block.isConnected || !isUnrenderedSource(block)) {
        continue;
      }

      const code = block.textContent.trim();
      if (!code) {
        continue;
      }

      const container = createDiagramContainer(index, code);
      await renderDiagram(mermaid, code, container, index++);

      // Replace the entire <pre> element (for Format 1, the parent of <code>)
      const preElement = block.tagName === 'PRE' ? block : block.parentElement;
      preElement.replaceWith(container);
    }
  };

  // Re-render existing diagrams from their stored source (e.g. after a theme change)
  const rerenderAllMermaidDiagrams = async () => {
    const containers = document.querySelectorAll('.mermaid-container[data-mermaid-source]');
    if (containers.length === 0) {
      return;
    }

    const mermaid = await loadMermaid();
    initializeMermaid(mermaid);
    for (const container of containers) {
      const index = container.getAttribute('data-diagram-index');
      await renderDiagram(mermaid, container.getAttribute('data-mermaid-source'), container, index);
    }
  };

  // Debounce function to avoid excessive re-renders
  let renderTimeout = null;
  const debouncedRender = () => {
    if (renderTimeout) {
      clearTimeout(renderTimeout);
    }
    renderTimeout = setTimeout(() => {
      renderAllMermaidDiagrams().catch((error) => {
        console.error('Failed to render Mermaid diagrams:', error);
      });
    }, 100);
  };

  // Watch for theme changes
  const observeThemeChanges = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // Theme changed - reinitialize and re-render all diagrams with the new theme
          rerenderAllMermaidDiagrams().catch((error) => {
            console.error('Failed to re-render Mermaid diagrams:', error);
          });
          break;
        }
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  };

  // Watch for content changes (markdown preview updates)
  const observeContentChanges = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          debouncedRender();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  // Listen for reveal mode changes
  const observeRevealMode = () => {
    window.addEventListener('docpilot-mode-change', (e) => {
      if (e.detail.mode === 'normal') {
        // Switching back to normal mode, re-render mermaid
        console.log('Switching to normal mode, re-rendering Mermaid diagrams');
        setTimeout(() => {
          debouncedRender();
        }, 100);
      }
    });
  };

  // Initialize and render
  const initialize = async () => {
    try {
      await renderAllMermaidDiagrams();
      observeThemeChanges();
      observeContentChanges();
      observeRevealMode();
      console.log('DocPilot Mermaid renderer initialized');
    } catch (error) {
      console.error('Failed to initialize Mermaid renderer:', error);
    }
  };

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
