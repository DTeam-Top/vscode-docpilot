import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const openLocalPdf = vscode.commands.registerCommand(
    'docpilot.openLocalPdf',
    async (uri?: vscode.Uri) => {
      let pdfPath: string;

      if (uri?.fsPath) {
        pdfPath = uri.fsPath;
      } else {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'PDF Files': ['pdf'] },
        });

        if (!result || result.length === 0) {
          return;
        }
        pdfPath = result[0].fsPath;
      }

      if (!fs.existsSync(pdfPath)) {
        vscode.window.showErrorMessage('PDF file not found');
        return;
      }

      showPdfViewer(context, pdfPath, path.basename(pdfPath));
    }
  );

  const openPdfFromUrl = vscode.commands.registerCommand('docpilot.openPdfFromUrl', async () => {
    const url = await vscode.window.showInputBox({
      prompt: 'Enter PDF URL',
      placeHolder: 'https://example.com/document.pdf',
    });

    if (!url) {
      return;
    }

    try {
      new URL(url);
      showPdfViewer(context, url, 'Remote PDF');
    } catch {
      vscode.window.showErrorMessage('Invalid URL format');
    }
  });

  context.subscriptions.push(openLocalPdf, openPdfFromUrl);
}

function showPdfViewer(_context: vscode.ExtensionContext, pdfSource: string, title: string) {
  const isUrl = pdfSource.startsWith('http');
  const webviewOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: isUrl ? [] : [vscode.Uri.file(path.dirname(pdfSource))],
  };

  const panel = vscode.window.createWebviewPanel(
    'pdfViewer',
    title,
    vscode.ViewColumn.One,
    webviewOptions
  );

  panel.webview.html = getWebviewContent(panel.webview, pdfSource);
}

function getWebviewContent(webview: vscode.Webview, pdfSource: string): string {
  const isUrl = pdfSource.startsWith('http');
  let pdfUri: string;

  if (isUrl) {
    pdfUri = pdfSource;
  } else {
    const fileUri = vscode.Uri.file(pdfSource);
    pdfUri = webview.asWebviewUri(fileUri).toString();
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Viewer</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            font-family: var(--vscode-font-family);
            background-color: #525659;
        }
        .toolbar {
            background-color: var(--vscode-editor-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 8px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--vscode-foreground);
            z-index: 100;
            position: sticky;
            top: 0;
        }
        .pdf-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: auto;
            background-color: #525659;
            position: relative;
            padding: 20px 0;
        }
        .pdf-pages {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            min-height: 100%;
        }
        .pdf-page {
            position: relative;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            background: white;
            margin-bottom: 10px;
        }
        .pdf-page canvas {
            display: block;
            max-width: 100%;
            height: auto;
        }
        .controls {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 12px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .zoom-controls {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        input[type="range"] {
            width: 100px;
        }
        .page-info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .error, .loading {
            color: var(--vscode-foreground);
            text-align: center;
            padding: 40px 20px;
            background-color: var(--vscode-editor-background);
            margin: 20px;
            border-radius: 4px;
        }
        .loading {
            color: var(--vscode-descriptionForeground);
        }
        .progress-bar {
            width: 100%;
            height: 2px;
            background-color: var(--vscode-progressBar-background);
            position: absolute;
            bottom: 0;
        }
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-background);
            width: 0%;
            transition: width 0.3s ease;
        }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
    <div class="toolbar">
        <div class="file-info">
            <span>📄 ${isUrl ? 'Remote PDF' : path.basename(pdfSource)}</span>
            <span class="page-info" id="pageInfo">Loading...</span>
        </div>
        <div class="controls">
            <button onclick="fitToWidth()">Fit Width</button>
            <button onclick="fitToPage()">Fit Page</button>
            <div class="zoom-controls">
                <button onclick="zoomOut()">−</button>
                <input type="range" id="zoomSlider" min="0.25" max="3" step="0.25" value="1" oninput="setZoom(this.value)">
                <button onclick="zoomIn()">+</button>
                <span id="zoomLevel">100%</span>
            </div>
        </div>
    </div>
    <div class="pdf-container" id="pdfContainer">
        <div class="loading">
            Loading PDF...
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
        </div>
    </div>
    
    <script>
        let pdfDoc = null;
        let scale = 1.0;
        let currentPage = 1;
        let zoomTimeout = null;
        const pagesContainer = document.getElementById('pdfContainer');
        const progressFill = document.getElementById('progressFill');
        
        // Load PDF
        const loadingTask = pdfjsLib.getDocument('${pdfUri}');
        loadingTask.onProgress = function(progress) {
            if (progress.total > 0) {
                const percent = (progress.loaded / progress.total) * 100;
                progressFill.style.width = percent + '%';
            }
        };
        
        loadingTask.promise.then(function(pdf) {
            pdfDoc = pdf;
            pagesContainer.innerHTML = '<div class="pdf-pages" id="pdfPages"></div>';
            updatePageInfo();
            renderAllPages();
        }).catch(function(error) {
            console.error('Error loading PDF:', error);
            pagesContainer.innerHTML = 
                '<div class="error">Failed to load PDF. The file may be corrupted or inaccessible.</div>';
        });
        
        function renderAllPages() {
            const pdfPages = document.getElementById('pdfPages');
            const promises = [];
            
            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                promises.push(renderPage(pageNum));
            }
            
            return Promise.all(promises).then(() => {
                setupScrollListener();
                fitToWidth(); // Default to fit width
            });
        }
        
        function renderPage(pageNum) {
            return pdfDoc.getPage(pageNum).then(function(page) {
                const viewport = page.getViewport({scale: scale});
                
                // Create page container
                const pageDiv = document.createElement('div');
                pageDiv.className = 'pdf-page';
                pageDiv.id = 'page-' + pageNum;
                
                // Create canvas
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                pageDiv.appendChild(canvas);
                document.getElementById('pdfPages').appendChild(pageDiv);
                
                // Render canvas content
                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };
                
                return page.render(renderContext).promise;
            });
        }
        
        function setupScrollListener() {
            const container = pagesContainer;
            let scrollTimeout;
            
            container.addEventListener('scroll', function() {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    updateCurrentPage();
                }, 150);
            });
        }
        
        function updateCurrentPage() {
            const containerRect = pagesContainer.getBoundingClientRect();
            const pages = document.querySelectorAll('.pdf-page');
            
            for (let i = 0; i < pages.length; i++) {
                const pageRect = pages[i].getBoundingClientRect();
                if (pageRect.top <= containerRect.height / 2 && pageRect.bottom >= containerRect.height / 2) {
                    currentPage = i + 1;
                    updatePageInfo();
                    break;
                }
            }
        }
        
        function setZoom(newScale, immediate = false) {
            scale = parseFloat(newScale);
            document.getElementById('zoomSlider').value = scale;
            updateZoomInfo();
            
            // Throttle re-rendering for slider, immediate for buttons
            clearTimeout(zoomTimeout);
            if (immediate) {
                rerenderAllPages();
            } else {
                zoomTimeout = setTimeout(() => {
                    rerenderAllPages();
                }, 150);
            }
        }
        
        function rerenderAllPages() {
            const pages = document.querySelectorAll('.pdf-page');
            let renderPromises = [];
            
            // Re-render each page at the new scale
            pages.forEach((pageDiv, index) => {
                const pageNum = index + 1;
                const canvas = pageDiv.querySelector('canvas');
                if (canvas && pdfDoc) {
                    const promise = pdfDoc.getPage(pageNum).then(function(page) {
                        const viewport = page.getViewport({scale: scale});
                        const ctx = canvas.getContext('2d');
                        
                        // Clear canvas first to prevent artifacts
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        
                        // Update canvas size for new scale
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;
                        
                        // Re-render at new scale
                        const renderContext = {
                            canvasContext: ctx,
                            viewport: viewport
                        };
                        
                        return page.render(renderContext).promise;
                    });
                    renderPromises.push(promise);
                }
            });
            
            return Promise.all(renderPromises);
        }
        
        function zoomIn() {
            const newScale = Math.min(scale + 0.25, 3);
            setZoom(newScale, true);
        }
        
        function zoomOut() {
            const newScale = Math.max(scale - 0.25, 0.25);
            setZoom(newScale, true);
        }
        
        function fitToWidth() {
            const container = pagesContainer;
            const containerWidth = container.clientWidth - 40;
            const firstCanvas = document.querySelector('.pdf-page canvas');
            if (firstCanvas) {
                const canvasNaturalWidth = firstCanvas.width;
                const newScale = containerWidth / canvasNaturalWidth;
                setZoom(newScale, true);
            }
        }
        
        function fitToPage() {
            const container = pagesContainer;
            const containerHeight = container.clientHeight - 40;
            const containerWidth = container.clientWidth - 40;
            const firstCanvas = document.querySelector('.pdf-page canvas');
            if (firstCanvas) {
                const canvasNaturalWidth = firstCanvas.width;
                const canvasNaturalHeight = firstCanvas.height;
                const scaleX = containerWidth / canvasNaturalWidth;
                const scaleY = containerHeight / canvasNaturalHeight;
                const newScale = Math.min(scaleX, scaleY);
                setZoom(newScale, true);
            }
        }
        
        function updatePageInfo() {
            if (pdfDoc) {
                document.getElementById('pageInfo').textContent = 
                    \`Page \${currentPage} of \${pdfDoc.numPages}\`;
            }
        }
        
        function updateZoomInfo() {
            document.getElementById('zoomLevel').textContent = 
                Math.round(scale * 100) + '%';
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    zoomIn();
                } else if (e.key === '-') {
                    e.preventDefault();
                    zoomOut();
                } else if (e.key === '0') {
                    e.preventDefault();
                    setZoom(1);
                }
            }
        });
        
        // Only zoom on wheel when Ctrl is explicitly held down
        document.addEventListener('wheel', function(e) {
            if (e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    zoomIn();
                } else {
                    zoomOut();
                }
            }
        });
        
    </script>
</body>
</html>`;
}

export function deactivate() {
  // Extension cleanup - currently no cleanup needed
}
