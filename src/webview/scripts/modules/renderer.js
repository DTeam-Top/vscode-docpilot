import { state, CONSTANTS } from './state.js';

// This module handles all PDF.js rendering logic for the canvas and the text layer.

export function renderAllPages() {
    const _pdfPages = document.getElementById('pdfPages');
    const promises = [];

    for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
        promises.push(renderPage(pageNum));
    }

    return Promise.all(promises);
}

export function renderPage(pageNum) {
    return state.pdfDoc.getPage(pageNum).then((page) => {
        const viewport = page.getViewport({ scale: state.scale });

        const pageDiv = document.createElement('div');
        pageDiv.className = 'pdf-page';
        pageDiv.id = `page-${pageNum}`;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        pageDiv.appendChild(canvas);

        const textContainer = document.createElement('div');
        textContainer.className = 'textLayer hidden';
        pageDiv.appendChild(textContainer);

        state.textLayerStates.set(pageNum, {
            textLayer: null,
            container: textContainer,
            rendered: false,
            page: page,
        });

        document.getElementById('pdfPages').appendChild(pageDiv);

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
        };
        return page.render(renderContext).promise;
    });
}

export function rerenderAllPages() {
    const pages = document.querySelectorAll('.pdf-page');
    const renderPromises = [];

    pages.forEach((pageDiv, index) => {
        const pageNum = index + 1;
        const canvas = pageDiv.querySelector('canvas');
        if (canvas && state.pdfDoc) {
            const promise = state.pdfDoc.getPage(pageNum).then((page) => {
                const viewport = page.getViewport({ scale: state.scale });
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport,
                };

                if (state.textSelectionEnabled) {
                    const textState = state.textLayerStates.get(pageNum);
                    if (textState) {
                        textState.container.innerHTML = '';
                        textState.rendered = false;
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


// --- Text Layer Functions ---

export function initializeTextSelection() {
    if (state.pdfDoc.numPages > 100) {
        document.getElementById('warningBanner').style.display = 'block';
        state.textSelectionEnabled = false;
    } else {
        state.textSelectionEnabled = false; // Start disabled
    }
}

export function toggleTextSelection() {
    state.textSelectionEnabled = !state.textSelectionEnabled;
    const icon = document.getElementById('textSelectionIcon');
    const baseUrl = icon.src.substring(0, icon.src.lastIndexOf('/') + 1);

    if (state.textSelectionEnabled) {
        icon.src = `${baseUrl}text.svg`;
        renderVisibleTextLayers();
    } else {
        icon.src = `${baseUrl}view.svg`;
        hideAllTextLayers();
    }
}

function getVisiblePageRange() {
    const containerRect = state.pagesContainer.getBoundingClientRect();
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
    if (!state.textSelectionEnabled) return false;
    const visibleRange = getVisiblePageRange();
    return (
        pageNum >= visibleRange.start - CONSTANTS.VISIBLE_PAGE_BUFFER &&
        pageNum <= visibleRange.end + CONSTANTS.VISIBLE_PAGE_BUFFER
    );
}

export async function renderVisibleTextLayers() {
    const visibleRange = getVisiblePageRange();
    const promises = [];

    for (
        let pageNum = Math.max(1, visibleRange.start - CONSTANTS.VISIBLE_PAGE_BUFFER);
        pageNum <= Math.min(state.pdfDoc.numPages, visibleRange.end + CONSTANTS.VISIBLE_PAGE_BUFFER);
        pageNum++
    ) {
        if (shouldRenderTextLayer(pageNum)) {
            promises.push(renderTextLayer(pageNum));
        }
    }

    state.textLayerStates.forEach((_state, pageNum) => {
        if (!shouldRenderTextLayer(pageNum)) {
            cleanupTextLayer(pageNum);
        }
    });

    await Promise.all(promises);
}

export async function renderTextLayer(pageNum) {
    const textState = state.textLayerStates.get(pageNum);
    if (!textState || textState.rendered) return;

    try {
        const startTime = performance.now();
        textState.container.innerHTML = '';
        textState.container.className = 'textLayer enabled';

        const textContent = await textState.page.getTextContent();
        if (textContent.items.length > CONSTANTS.MAX_TEXT_DIVS_PER_PAGE) {
            console.warn(`Page ${pageNum} has too many text items, skipping`);
            textState.container.className = 'textLayer hidden';
            return;
        }

        const viewport = textState.page.getViewport({ scale: state.scale });
        const fragment = document.createDocumentFragment();

        textContent.items.forEach((textItem, index) => {
            if (!textItem.str || textItem.str.trim() === '') return;
            const textSpan = document.createElement('span');
            textSpan.textContent = textItem.str;
            textSpan.setAttribute('data-text-index', index);
            const tx = textItem.transform;
            const [scaleX, skewY, , , translateX, translateY] = tx;
            const fontSize = Math.sqrt(scaleX * scaleX + skewY * skewY);
            const fontScale = fontSize * state.scale;
            textSpan.style.left = `${translateX * state.scale}px`;
            textSpan.style.top = `${viewport.height - translateY * state.scale - fontScale}px`;
            textSpan.style.fontSize = `${fontScale}px`;
            if (textItem.fontName && textItem.fontName.includes('Bold')) {
                textSpan.style.fontWeight = 'bold';
            }
            fragment.appendChild(textSpan);
        });

        textState.container.appendChild(fragment);
        textState.rendered = true;

        monitorTextLayerPerformance(performance.now() - startTime);
        state.textLayerCache.set(pageNum, Date.now());
        if (state.textLayerCache.size > CONSTANTS.MAX_CACHED_TEXT_LAYERS) {
            evictOldestTextLayer();
        }
    } catch (error) {
        console.error(`Failed to render text layer for page ${pageNum}:`, error);
        textState.container.className = 'textLayer hidden';
    }
}

export function hideAllTextLayers() {
    state.textLayerStates.forEach((textState) => {
        if (textState.container) {
            textState.container.className = 'textLayer hidden';
            textState.rendered = false;
        }
    });
}

function cleanupTextLayer(pageNum) {
    const textState = state.textLayerStates.get(pageNum);
    if (textState) {
        if (textState.container) {
            textState.container.innerHTML = '';
            textState.container.className = 'textLayer hidden';
        }
        textState.rendered = false;
        state.textLayerCache.delete(pageNum);
    }
}

function evictOldestTextLayer() {
    let oldestPageNum = null;
    let oldestTime = Date.now();
    state.textLayerCache.forEach((time, pageNum) => {
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
    state.renderTimes.push(renderTime);
    if (state.renderTimes.length > 5) state.renderTimes.shift();
    const avgTime = state.renderTimes.reduce((a, b) => a + b) / state.renderTimes.length;
    if (avgTime > CONSTANTS.PERFORMANCE_THRESHOLD) {
        console.warn(`Text layer rendering too slow (avg: ${Math.round(avgTime)}ms)`);
    }
}

export async function extractAllTextContent() {
    try {
        let allText = '';
        for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
            const page = await state.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            let pageText = '';
            textContent.items.forEach((item) => {
                if (item.str?.trim()) {
                    pageText += `${item.str} `;
                }
            });
            if (pageText.trim()) {
                allText += `\n--- Page ${pageNum} ---\n${pageText.trim()}\n`;
            }
        }
        return allText.trim();
    } catch (error) {
        console.error('Error extracting text:', error);
        throw error;
    }
}


