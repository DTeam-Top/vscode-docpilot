import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

// Store active PDF viewers for text extraction
const activePdfViewers = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
  console.log('DocPilot extension activating...');

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

  // Register chat participant
  console.log('Registering chat participant: docpilot');
  console.log('Available chat API:', !!vscode.chat);
  console.log('Chat createChatParticipant function:', typeof vscode.chat?.createChatParticipant);

  const chatParticipant = vscode.chat.createChatParticipant(
    'docpilot.chat-participant',
    (request, chatContext, stream, token) =>
      handleChatRequest(request, chatContext, stream, token, context)
  );

  console.log('Chat participant registered successfully');
  console.log('Chat participant ID:', chatParticipant.id);

  // Set additional metadata for better discoverability
  chatParticipant.iconPath = vscode.ThemeIcon.File;
  chatParticipant.followupProvider = {
    provideFollowups: () => [
      {
        prompt: '@docpilot /summarise',
        label: 'Summarise a PDF file',
        command: 'summarise',
      },
    ],
  };

  // Add additional debugging
  chatParticipant.onDidReceiveFeedback((feedback) => {
    console.log('Received feedback:', feedback);
  });

  context.subscriptions.push(openLocalPdf, openPdfFromUrl, chatParticipant);

  console.log('DocPilot extension activation complete');
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extensionContext: vscode.ExtensionContext
): Promise<vscode.ChatResult> {
  console.log('Chat request received:', {
    command: request.command,
    prompt: request.prompt,
  });

  // Always respond with something to test if the handler is being called
  stream.markdown('🤖 DocPilot is responding! ');

  try {
    if (request.command === 'summarise') {
      console.log('Handling summarise command');
      stream.markdown('Starting PDF summarisation...\n');
      return await handleSummaryCommand(request, stream, token, extensionContext);
    } else {
      console.log('Unknown or missing command:', request.command, 'showing help');
      stream.markdown(
        'Available commands:\n- `/summarise <file>` - Summarise a PDF file\n\nUsage: `@docpilot /summarise path/to/file.pdf`'
      );
      return { metadata: { command: 'help' } };
    }
  } catch (error) {
    console.error('Error in chat request handler:', error);
    stream.markdown(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { metadata: { command: request.command, error: String(error) } };
  }
}

async function handleSummaryCommand(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  extensionContext: vscode.ExtensionContext
): Promise<vscode.ChatResult> {
  console.log('handleSummaryCommand called with prompt:', request.prompt);

  const prompt = request.prompt.trim();
  let pdfPath: string;

  if (!prompt) {
    // Show file picker if no file specified
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'PDF Files': ['pdf'] },
      title: 'Select PDF file to summarise',
    });

    if (!result || result.length === 0) {
      stream.markdown('❌ No file selected');
      return { metadata: { command: 'summarise', cancelled: true } };
    }
    pdfPath = result[0].fsPath;
  } else if (prompt.startsWith('http')) {
    // Handle URL
    pdfPath = prompt;
  } else {
    // Handle file path - resolve relative to workspace
    if (path.isAbsolute(prompt)) {
      pdfPath = prompt;
    } else {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        stream.markdown('❌ No workspace folder found. Please provide an absolute path.');
        return { metadata: { command: 'summarise', error: 'No workspace' } };
      }
      pdfPath = path.join(workspaceFolder.uri.fsPath, prompt);
    }

    // Check if file exists for local files
    if (!pdfPath.startsWith('http') && !fs.existsSync(pdfPath)) {
      stream.markdown(`❌ File not found: ${pdfPath}`);
      return { metadata: { command: 'summarise', error: 'File not found' } };
    }
  }

  // Show progress
  stream.markdown('📄 Opening PDF and extracting text...\n');

  try {
    // Open the PDF in DocPilot viewer
    const fileName = pdfPath.startsWith('http') ? 'Remote PDF' : path.basename(pdfPath);
    const panel = showPdfViewer(extensionContext, pdfPath, fileName);

    // Wait a moment for the webview to load
    stream.markdown('⏳ Waiting for PDF to load...\n');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Extract text content from the PDF
    stream.markdown('🔍 Extracting text content...\n');
    const pdfText = await extractTextFromPdf(panel, pdfPath);

    if (!pdfText || pdfText.trim().length === 0) {
      stream.markdown(
        '⚠️ No text content found in the PDF. The document may contain only images or be protected.'
      );
      return { metadata: { command: 'summarise', warning: 'No text content' } };
    }

    // Get available language models first
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
      stream.markdown('❌ No language models available. Please make sure Copilot is enabled.');
      return { metadata: { command: 'summarise', error: 'No models available' } };
    }

    const model = models[0];

    // Estimate token count (rough approximation: 4 characters per token)
    const estimatedTokens = Math.ceil(pdfText.length / 4);
    const maxTokensForModel = model.maxInputTokens || 4000; // Conservative default
    const promptOverhead = 500; // Tokens for our prompt template
    const maxContentTokens = maxTokensForModel - promptOverhead;
    const maxContentLength = maxContentTokens * 4; // Convert back to characters

    stream.markdown('🤖 Generating summary...\n\n');

    let textToSummarize: string;
    let summaryStrategy: string;

    if (pdfText.length <= maxContentLength) {
      // Content fits within token limits
      textToSummarize = pdfText;
      summaryStrategy = 'full';
    } else {
      // Content is too large, use intelligent truncation
      const pages = pdfText.split(/--- Page \d+ ---/);
      const firstPages = pages.slice(0, Math.min(5, pages.length)).join('\n--- Page ---\n');
      const lastPages = pages.slice(-2).join('\n--- Page ---\n');

      textToSummarize =
        firstPages + '\n\n[... Content from middle pages omitted for brevity ...]\n\n' + lastPages;

      // If still too long, just take the beginning
      if (textToSummarize.length > maxContentLength) {
        textToSummarize =
          pdfText.substring(0, maxContentLength) + '\n\n[Content truncated due to length...]';
      }
      summaryStrategy = 'truncated';
    }

    stream.markdown(
      `📊 Processing ${pdfText.length} characters (${estimatedTokens} tokens estimated)\n\n`
    );

    // Create optimized prompt
    const summaryPrompt = `Summarize this PDF document:

**File:** ${fileName}
**Strategy:** ${summaryStrategy === 'full' ? 'Full content analysis' : 'Key sections analysis'}

**Content:**
${textToSummarize}

Provide:
1. Brief overview
2. Key points
3. Main findings
4. Document structure`;

    try {
      const summaryResponse = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(summaryPrompt)],
        {},
        token
      );

      stream.markdown('## 📋 PDF Summary\n\n');

      for await (const chunk of summaryResponse.text) {
        stream.markdown(chunk);
        if (token.isCancellationRequested) {
          break;
        }
      }

      if (summaryStrategy === 'truncated') {
        stream.markdown(
          '\n\n⚠️ *Note: This summary is based on selected sections due to document length.*'
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('token')) {
        stream.markdown(
          '❌ Document too large for summarization. Trying with smaller excerpt...\n\n'
        );

        // Fallback: use just the first 1000 characters
        const shortExcerpt = pdfText.substring(0, 1000) + '...\n\n[Showing excerpt only]';
        const fallbackPrompt = `Provide a brief summary of this PDF excerpt:\n\n${shortExcerpt}`;

        try {
          const fallbackResponse = await model.sendRequest(
            [vscode.LanguageModelChatMessage.User(fallbackPrompt)],
            {},
            token
          );

          stream.markdown('## 📋 PDF Summary (Excerpt)\n\n');
          for await (const chunk of fallbackResponse.text) {
            stream.markdown(chunk);
            if (token.isCancellationRequested) {
              break;
            }
          }
          stream.markdown(
            '\n\n⚠️ *Note: Summary based on document excerpt only due to size constraints.*'
          );
        } catch {
          throw error; // Re-throw original error if fallback also fails
        }
      } else {
        throw error;
      }
    }

    stream.markdown(
      `\n\n---\n*PDF opened in DocPilot viewer. Text content: ${pdfText.length} characters*`
    );

    return {
      metadata: {
        command: 'summarise',
        file: pdfPath,
        textLength: pdfText.length,
      },
    };
  } catch (error) {
    stream.markdown(
      `❌ Failed to process PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return { metadata: { command: 'summarise', error: String(error) } };
  }
}

async function extractTextFromPdf(panel: vscode.WebviewPanel, _pdfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Text extraction timeout - PDF may not have loaded properly'));
    }, 30000); // 30 second timeout

    // Listen for messages from the webview
    const disposable = panel.webview.onDidReceiveMessage((message) => {
      console.log('Received message from webview:', message.type);

      if (message.type === 'textExtracted') {
        console.log('Text extraction successful, length:', message.text?.length || 0);
        clearTimeout(timeout);
        disposable.dispose();
        resolve(message.text);
      } else if (message.type === 'textExtractionError') {
        console.log('Text extraction error:', message.error);
        clearTimeout(timeout);
        disposable.dispose();
        reject(new Error(message.error));
      }
    });

    // Request text extraction from the webview
    console.log('Sending text extraction request to webview');
    panel.webview.postMessage({ type: 'extractAllText' });
  });
}

function showPdfViewer(
  _context: vscode.ExtensionContext,
  pdfSource: string,
  title: string
): vscode.WebviewPanel {
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

  // Register for text extraction
  activePdfViewers.set(pdfSource, panel);

  panel.onDidDispose(() => {
    activePdfViewers.delete(pdfSource);
  });

  return panel;
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
        .pdf-page .textLayer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            color: transparent;
            font-family: sans-serif;
            line-height: 1;
            overflow: hidden;
            pointer-events: auto;
            z-index: 2;
            mix-blend-mode: normal;
        }
        .pdf-page .textLayer span {
            color: transparent;
            position: absolute;
            white-space: pre;
            cursor: text;
            transform-origin: 0% 0%;
            user-select: text;
            -webkit-user-select: text;
            -moz-user-select: text;
            -ms-user-select: text;
            line-height: 1;
            font-family: sans-serif;
        }
        .pdf-page .textLayer span::selection {
            background: rgba(0, 123, 255, 0.3);
            color: transparent;
        }
        .pdf-page .textLayer span::-moz-selection {
            background: rgba(0, 123, 255, 0.3);
            color: transparent;
        }
        .pdf-page .textLayer.hidden {
            display: none;
        }
        .pdf-page .textLayer.enabled {
            display: block;
        }
        .warning-banner {
            background-color: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            padding: 8px 16px;
            margin: 8px;
            border-radius: 3px;
            font-size: 12px;
            display: none;
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
            <button id="textSelectionBtn" onclick="toggleTextSelection()">Enable Text Selection</button>
            <button id="debugBtn" onclick="toggleDebug()" style="font-size: 10px;">Debug</button>
            <div class="zoom-controls">
                <button onclick="zoomOut()">−</button>
                <input type="range" id="zoomSlider" min="0.25" max="3" step="0.25" value="1" oninput="setZoom(this.value)">
                <button onclick="zoomIn()">+</button>
                <span id="zoomLevel">100%</span>
            </div>
        </div>
    </div>
    <div class="warning-banner" id="warningBanner">
        ⚠️ Large document detected. Text selection may impact performance.
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
        // Make vscode API available first
        const vscode = acquireVsCodeApi();
        console.log('VSCode API initialized');
        
        let pdfDoc = null;
        let scale = 1.0;
        let currentPage = 1;
        let zoomTimeout = null;
        const pagesContainer = document.getElementById('pdfContainer');
        const progressFill = document.getElementById('progressFill');
        
        // Text layer management
        let textSelectionEnabled = false;
        let debugMode = false; // Add debug mode for development
        const textLayerStates = new Map(); // pageNum -> { textLayer, container, rendered }
        const textLayerCache = new Map(); // LRU cache for text layers
        const MAX_CACHED_TEXT_LAYERS = 10;
        const VISIBLE_PAGE_BUFFER = 2;
        const MAX_TEXT_DIVS_PER_PAGE = 50000;
        let renderTimes = [];
        const PERFORMANCE_THRESHOLD = 500; // 500ms
        
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
            initializeTextSelection();
            renderAllPages();
            
            // Signal that PDF is ready for text extraction
            console.log('PDF loaded successfully, ready for text extraction');
        }).catch(function(error) {
            console.error('Error loading PDF:', error);
            pagesContainer.innerHTML = 
                '<div class="error">Failed to load PDF. The file may be corrupted or inaccessible.</div>';
            
            // Notify extension of PDF loading error
            vscode.postMessage({
                type: 'textExtractionError',
                error: 'Failed to load PDF: ' + error.message
            });
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
                
                // Create text layer container (but don't render yet)
                const textContainer = document.createElement('div');
                textContainer.className = 'textLayer hidden';
                pageDiv.appendChild(textContainer);
                
                // Store text layer state
                textLayerStates.set(pageNum, {
                    textLayer: null,
                    container: textContainer,
                    rendered: false,
                    page: page
                });
                
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
                    // Update text layer visibility when scrolling
                    if (textSelectionEnabled) {
                        renderVisibleTextLayers();
                    }
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
                        
                        // If text selection is enabled, invalidate and re-render text layer
                        if (textSelectionEnabled) {
                            const state = textLayerStates.get(pageNum);
                            if (state) {
                                state.container.innerHTML = '';
                                state.rendered = false;
                                // Re-render text layer for visible pages
                                if (shouldRenderTextLayer(pageNum)) {
                                    renderTextLayer(pageNum);
                                }
                            }
                        }
                        
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
        
        // Text layer management functions
        function initializeTextSelection() {
            if (pdfDoc.numPages > 100) {
                document.getElementById('warningBanner').style.display = 'block';
                textSelectionEnabled = false;
                document.getElementById('textSelectionBtn').textContent = 'Enable Text Selection';
            } else {
                textSelectionEnabled = false; // Start disabled, let user choose
                document.getElementById('textSelectionBtn').textContent = 'Enable Text Selection';
            }
        }
        
        function toggleTextSelection() {
            textSelectionEnabled = !textSelectionEnabled;
            const btn = document.getElementById('textSelectionBtn');
            btn.textContent = textSelectionEnabled ? 'Disable Text Selection' : 'Enable Text Selection';
            btn.style.backgroundColor = textSelectionEnabled ? 
                'var(--vscode-button-secondaryBackground)' : 
                'var(--vscode-button-background)';
            
            if (textSelectionEnabled) {
                console.log('Text selection enabled - rendering text layers for visible pages');
                renderVisibleTextLayers();
            } else {
                console.log('Text selection disabled - hiding all text layers');
                hideAllTextLayers();
            }
        }
        
        function getVisiblePageRange() {
            const containerRect = pagesContainer.getBoundingClientRect();
            const pages = document.querySelectorAll('.pdf-page');
            let start = 1, end = 1;
            
            for (let i = 0; i < pages.length; i++) {
                const pageRect = pages[i].getBoundingClientRect();
                if (pageRect.bottom >= containerRect.top && pageRect.top <= containerRect.bottom) {
                    if (start === 1) start = i + 1;
                    end = i + 1;
                }
            }
            
            return { start, end };
        }
        
        function shouldRenderTextLayer(pageNum) {
            if (!textSelectionEnabled) return false;
            const visibleRange = getVisiblePageRange();
            return pageNum >= (visibleRange.start - VISIBLE_PAGE_BUFFER) && 
                   pageNum <= (visibleRange.end + VISIBLE_PAGE_BUFFER);
        }
        
        async function renderVisibleTextLayers() {
            const visibleRange = getVisiblePageRange();
            const promises = [];
            
            for (let pageNum = Math.max(1, visibleRange.start - VISIBLE_PAGE_BUFFER); 
                 pageNum <= Math.min(pdfDoc.numPages, visibleRange.end + VISIBLE_PAGE_BUFFER); 
                 pageNum++) {
                if (shouldRenderTextLayer(pageNum)) {
                    promises.push(renderTextLayer(pageNum));
                }
            }
            
            // Cleanup text layers outside visible range
            textLayerStates.forEach((state, pageNum) => {
                if (!shouldRenderTextLayer(pageNum)) {
                    cleanupTextLayer(pageNum);
                }
            });
            
            await Promise.all(promises);
        }
        
        async function renderTextLayer(pageNum) {
            const state = textLayerStates.get(pageNum);
            if (!state || state.rendered) return;
            
            try {
                const startTime = performance.now();
                
                // Clear container
                state.container.innerHTML = '';
                state.container.className = 'textLayer enabled';
                
                // Get text content with safer options
                const textContent = await state.page.getTextContent();
                if (textContent.items.length > MAX_TEXT_DIVS_PER_PAGE) {
                    console.warn(\`Page \${pageNum} has \${textContent.items.length} text items, skipping\`);
                    state.container.className = 'textLayer hidden';
                    return;
                }
                
                const viewport = state.page.getViewport({scale: scale});
                
                // Create a document fragment for better performance
                const fragment = document.createDocumentFragment();
                
                // Process text items with simplified positioning
                textContent.items.forEach((textItem, index) => {
                    if (!textItem.str || textItem.str.trim() === '') return;
                    
                    const textSpan = document.createElement('span');
                    textSpan.textContent = textItem.str;
                    textSpan.setAttribute('data-text-index', index);
                    
                    // Extract transformation matrix values
                    const tx = textItem.transform;
                    const [scaleX, skewY, skewX, scaleY, translateX, translateY] = tx;
                    
                    // Calculate position and font size
                    const fontSize = Math.sqrt(scaleX * scaleX + skewY * skewY);
                    const fontScale = fontSize * scale;
                    
                    // Apply positioning
                    textSpan.style.left = (translateX * scale) + 'px';
                    textSpan.style.top = (viewport.height - (translateY * scale) - fontScale) + 'px';
                    textSpan.style.fontSize = fontScale + 'px';
                    
                    // Set font family if available
                    if (textItem.fontName && textItem.fontName !== 'g_d0_f1') {
                        if (textItem.fontName.includes('Bold')) {
                            textSpan.style.fontWeight = 'bold';
                        }
                    }
                    
                    fragment.appendChild(textSpan);
                });
                
                // Append all text spans at once
                state.container.appendChild(fragment);
                
                state.textLayer = { cancel: () => {} };
                state.rendered = true;
                
                const renderTime = performance.now() - startTime;
                monitorTextLayerPerformance(renderTime);
                
                // Update cache
                textLayerCache.set(pageNum, Date.now());
                if (textLayerCache.size > MAX_CACHED_TEXT_LAYERS) {
                    evictOldestTextLayer();
                }
                
            } catch (error) {
                console.error(\`Failed to render text layer for page \${pageNum}:\`, error);
                state.container.className = 'textLayer hidden';
            }
        }
        
        function updateTextLayerViewport(pageNum, viewport) {
            const state = textLayerStates.get(pageNum);
            if (state && state.textLayer && state.rendered && textSelectionEnabled) {
                try {
                    // Clear and mark for re-render
                    state.container.innerHTML = '';
                    state.rendered = false;
                } catch (error) {
                    console.error(\`Failed to update text layer viewport for page \${pageNum}:\`, error);
                }
            }
        }
        
        function hideAllTextLayers() {
            console.log('Hiding all text layers');
            textLayerStates.forEach((state, pageNum) => {
                if (state.container) {
                    state.container.className = 'textLayer hidden';
                }
            });
        }
        
        function cleanupTextLayer(pageNum) {
            const state = textLayerStates.get(pageNum);
            if (state) {
                if (state.textLayer) {
                    state.textLayer.cancel();
                }
                if (state.container) {
                    state.container.innerHTML = '';
                    state.container.className = 'textLayer hidden';
                }
                state.textLayer = null;
                state.rendered = false;
                textLayerCache.delete(pageNum);
            }
        }
        
        function evictOldestTextLayer() {
            let oldestPageNum = null;
            let oldestTime = Date.now();
            
            textLayerCache.forEach((time, pageNum) => {
                if (time < oldestTime) {
                    oldestTime = time;
                    oldestPageNum = pageNum;
                }
            });
            
            if (oldestPageNum !== null) {
                cleanupTextLayer(oldestPageNum);
            }
        }
        
        function monitorTextLayerPerformance(renderTime) {
            renderTimes.push(renderTime);
            if (renderTimes.length > 5) renderTimes.shift();
            
            const avgTime = renderTimes.reduce((a, b) => a + b) / renderTimes.length;
            if (avgTime > PERFORMANCE_THRESHOLD) {
                console.warn(\`Text layer rendering too slow (avg: \${Math.round(avgTime)}ms), consider disabling\`);
            }
        }
        
        function toggleDebug() {
            debugMode = !debugMode;
            const btn = document.getElementById('debugBtn');
            btn.textContent = debugMode ? 'Debug ON' : 'Debug';
            btn.style.backgroundColor = debugMode ? '#ff6b6b' : 'var(--vscode-button-background)';
            
            // Update text layer styling for debug mode
            textLayerStates.forEach((state, pageNum) => {
                if (state.container && state.rendered) {
                    const spans = state.container.querySelectorAll('span');
                    spans.forEach((span, index) => {
                        if (debugMode) {
                            span.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                            span.style.border = '1px solid red';
                            span.style.color = 'rgba(0, 0, 0, 0.5)';
                            // Add tooltip with text content for debugging
                            span.title = \`Text: "\${span.textContent}" | Index: \${index} | Font: \${span.style.fontSize}\`;
                        } else {
                            span.style.backgroundColor = '';
                            span.style.border = '';
                            span.style.color = 'transparent';
                            span.title = '';
                        }
                    });
                }
            });
            
            console.log(\`Debug mode \${debugMode ? 'enabled' : 'disabled'}\`);
            if (debugMode) {
                console.log('Hover over text elements to see their content and positioning info');
            }
        }
        
        // Text extraction functionality for chat integration
        async function extractAllTextContent() {
            try {
                let allText = '';
                console.log('Starting text extraction for all pages...');
                
                for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                    const page = await pdfDoc.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    
                    let pageText = '';
                    textContent.items.forEach(item => {
                        if (item.str && item.str.trim()) {
                            pageText += item.str + ' ';
                        }
                    });
                    
                    if (pageText.trim()) {
                        allText += \`\\n--- Page \${pageNum} ---\\n\${pageText.trim()}\\n\`;
                    }
                }
                
                console.log(\`Extracted \${allText.length} characters from \${pdfDoc.numPages} pages\`);
                return allText.trim();
            } catch (error) {
                console.error('Error extracting text:', error);
                throw error;
            }
        }
        
        // Listen for messages from the extension
        window.addEventListener('message', async (event) => {
            const message = event.data;
            console.log('Webview received message:', message.type);
            
            if (message.type === 'extractAllText') {
                try {
                    console.log('Starting text extraction, PDF loaded:', !!pdfDoc);
                    
                    if (!pdfDoc) {
                        throw new Error('PDF not loaded yet');
                    }
                    
                    const extractedText = await extractAllTextContent();
                    console.log('Text extraction completed, sending response');
                    
                    // Send the extracted text back to the extension
                    vscode.postMessage({
                        type: 'textExtracted',
                        text: extractedText
                    });
                } catch (error) {
                    console.error('Text extraction failed:', error);
                    vscode.postMessage({
                        type: 'textExtractionError',
                        error: error.message || 'Unknown error during text extraction'
                    });
                }
            }
        });
        
        console.log('Webview script loaded and ready for messages');
        
        
    </script>
</body>
</html>`;
}

export function deactivate() {
  // Extension cleanup - currently no cleanup needed
}
