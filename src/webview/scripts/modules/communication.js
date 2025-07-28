import { state } from './state.js';
import { extractAllTextContent } from './renderer.js';
import { handleFolderSelected, handleExtractionCompleted, handleExtractionError, updateExtractionProgress } from './extractor.js';
/* global PDF_CONFIG */

// This module handles all communication with the VS Code extension host.

/**
 * Post a message to the VS Code extension host.
 * @param {object} message - The message to send.
 */
export function postMessage(message) {
    state.vscode.postMessage(message);
}

/**
 * Handles incoming messages from the extension host.
 * @param {MessageEvent} event - The message event.
 */
async function handleExtensionMessage(event) {
    const message = event.data;
    console.log('Webview received message:', message.type);

    const summarizeBtn = document.getElementById('summarizeBtn');
    const exportBtn = document.getElementById('exportBtn');

    switch (message.type) {
        case 'extractAllText':
            try {
                if (!state.pdfDoc) {
                    throw new Error('PDF not loaded yet');
                }
                const extractedText = await extractAllTextContent();
                console.log('Text extraction completed, sending response');
                postMessage({ type: 'textExtracted', text: extractedText });
            } catch (error) {
                console.error('Text extraction failed:', error);
                postMessage({ type: 'textExtractionError', error: error.message || 'Unknown error' });
            }
            break;

        case 'summarizeStarted':
            console.log('Summarization started in extension');
            break;

        case 'summarizeCompleted':
            console.log('Summarization completed');
            if (summarizeBtn) {
                summarizeBtn.disabled = false;
                summarizeBtn.style.opacity = '1';
                summarizeBtn.title = 'Summarize this PDF using AI';
            }
            break;

        case 'summarizeError':
            console.error('Summarization error:', message.error);
            if (summarizeBtn) {
                summarizeBtn.disabled = false;
                summarizeBtn.style.opacity = '1';
                summarizeBtn.title = 'Summarize this PDF using AI';
            }
            break;

        case 'exportCompleted':
             console.log('Export completed');
             if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.style.opacity = '1';
                exportBtn.title = 'Export Text';
             }
            break;

        case 'exportError':
            console.error('Export error:', message.error);
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.style.opacity = '1';
                exportBtn.title = 'Export Text';
            }
            break;

        case 'folderSelected':
            console.log('Folder selected:', message.data.folderPath);
            handleFolderSelected(message.data.folderPath);
            break;

        case 'extractionProgress':
            console.log('Extraction progress:', message.progress);
            if (message.progress) {
                updateExtractionProgress(message.progress);
            }
            break;

        case 'extractionCompleted':
            console.log('Extraction completed:', message.data);
            if (message.data) {
                handleExtractionCompleted(message.data);
            }
            break;

        case 'extractionError':
            console.error('Extraction error:', message.error);
            if (message.error) {
                handleExtractionError(message.error);
            }
            break;
        
        // ... other message types like 'objectCountsUpdated', etc.
    }
}

/**
 * Initializes the message listener for communication from the extension.
 */
export function initializeMessageListener() {
    window.addEventListener('message', handleExtensionMessage);
}

// Specific message sending functions
export function requestSummary() {
    console.log('Requesting document summary...');
    postMessage({
        type: 'summarizeRequest',
        fileName: PDF_CONFIG.fileName,
        isUrl: PDF_CONFIG.isUrl,
        pdfUri: PDF_CONFIG.pdfUri,
    });
}

export function reportError(error, isCorsError = false) {
    postMessage({
        type: 'textExtractionError',
        error: `Failed to load PDF: ${error.message}`,
        isCorsError: isCorsError,
        isUrl: PDF_CONFIG.isUrl,
    });
}

export function requestDownloadFallback() {
    console.log('Download PDF fallback requested');
    postMessage({
        type: 'downloadPdfFallback',
        url: PDF_CONFIG.pdfUri,
    });
}

export function requestOpenInBrowser() {
    console.log('Open in browser requested');
    postMessage({
        type: 'openInBrowser',
        url: PDF_CONFIG.pdfUri,
    });
}
