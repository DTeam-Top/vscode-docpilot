/**
 * Mermaid Renderer for VSCode Markdown Preview
 * Automatically renders Mermaid diagrams in markdown preview mode
 */

(async () => {
  // Import Mermaid from CDN
  const mermaid = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');

  // Detect VSCode theme
  const getTheme = () => {
    const bodyClass = document.body.className;
    if (bodyClass.includes('vscode-dark') || bodyClass.includes('vscode-high-contrast')) {
      return 'dark';
    }
    return 'default';
  };

  // Initialize Mermaid with VSCode theme
  const initializeMermaid = () => {
    mermaid.default.initialize({
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
  const createDiagramContainer = (index) => {
    const container = document.createElement('div');
    container.className = 'mermaid-container';
    container.setAttribute('data-diagram-index', index);
    return container;
  };

  // Render a single Mermaid diagram
  const renderDiagram = async (code, container, index) => {
    try {
      const id = `mermaid-diagram-${Date.now()}-${index}`;
      const { svg } = await mermaid.default.render(id, code);
      container.innerHTML = svg;
      container.classList.add('mermaid-rendered');
    } catch (error) {
      console.error('Mermaid rendering error:', error);
      container.innerHTML = `<div class="mermaid-error">
        <strong>Mermaid Syntax Error</strong>
        <pre>${escapeHtml(error.message || 'Unknown error')}</pre>
      </div>`;
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

  // Find and render all Mermaid diagrams
  const renderAllMermaidDiagrams = async () => {
    // Skip if in reveal.js mode (reveal.js handles mermaid itself)
    if (isRevealMode()) {
      return;
    }

    let index = 0;

    // Format 1: ```mermaid code blocks (rendered by markdown-it as <pre><code class="language-mermaid">)
    const codeBlocks = document.querySelectorAll('pre > code.language-mermaid');
    for (const codeBlock of codeBlocks) {
      // Skip if already rendered
      if (codeBlock.closest('.mermaid-container')) {
        continue;
      }

      const code = codeBlock.textContent.trim();
      if (code) {
        const container = createDiagramContainer(index++);
        await renderDiagram(code, container, index);

        // Replace the entire <pre><code> structure
        const preElement = codeBlock.parentElement;
        if (preElement && preElement.tagName === 'PRE') {
          preElement.replaceWith(container);
        }
      }
    }

    // Format 2: <pre class="mermaid"> HTML blocks
    const preBlocks = document.querySelectorAll('pre.mermaid');
    for (const preBlock of preBlocks) {
      // Skip if already rendered
      if (preBlock.classList.contains('mermaid-container')) {
        continue;
      }

      const code = preBlock.textContent.trim();
      if (code) {
        const container = createDiagramContainer(index++);
        await renderDiagram(code, container, index);
        preBlock.replaceWith(container);
      }
    }
  };

  // Debounce function to avoid excessive re-renders
  let renderTimeout = null;
  const debouncedRender = () => {
    if (renderTimeout) {
      clearTimeout(renderTimeout);
    }
    renderTimeout = setTimeout(() => {
      renderAllMermaidDiagrams();
    }, 100);
  };

  // Watch for theme changes
  const observeThemeChanges = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // Theme changed - reinitialize and re-render
          initializeMermaid();
          // Re-render all diagrams with new theme
          document.querySelectorAll('.mermaid-container').forEach((container) => {
            container.classList.remove('mermaid-rendered');
          });
          debouncedRender();
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
      // Check if new content was added
      let hasNewContent = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewContent = true;
          break;
        }
      }

      if (hasNewContent) {
        debouncedRender();
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
      initializeMermaid();
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
