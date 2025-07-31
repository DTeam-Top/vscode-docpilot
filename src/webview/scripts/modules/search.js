import { state } from './state.js';
import { renderTextLayer, renderVisibleTextLayers } from './renderer.js';

// This module contains all logic for the text search feature.

const searchState = {
  isActive: false,
  query: '',
  matches: [],
  currentMatchIndex: -1,
  pageTextCache: new Map(),
};

function debounce(func, delay) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

export function toggleSearch() {
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');
  if (searchState.isActive) {
    closeSearch();
  } else {
    searchState.isActive = true;
    overlay.style.display = 'block';
    input.focus();
    input.addEventListener('input', debounce(handleSearchInput, 300));
    input.addEventListener('keydown', handleSearchKeydown);
  }
}

export function closeSearch() {
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');
  searchState.isActive = false;
  overlay.style.display = 'none';
  input.value = '';
  clearSearchHighlights();
  searchState.query = '';
  searchState.matches = [];
  searchState.currentMatchIndex = -1;
  updateSearchButtons();
  input.removeEventListener('input', handleSearchInput);
  input.removeEventListener('keydown', handleSearchKeydown);
}

function handleSearchInput(event) {
  const query = event.target.value.trim().toLowerCase();
  if (query.length < 2) {
    clearSearchHighlights();
    searchState.matches = [];
    searchState.currentMatchIndex = -1;
    updateSearchButtons();
    return;
  }
  performSearch(query);
}

function handleSearchKeydown(event) {
  if (event.key === 'Escape') {
    closeSearch();
  } else if (event.key === 'Enter') {
    if (event.shiftKey) {
      searchPrevious();
    } else {
      searchNext();
    }
  }
}

async function performSearch(query) {
  if (!query || query === searchState.query) return;

  searchState.query = query;
  searchState.matches = [];
  searchState.currentMatchIndex = -1;
  clearSearchHighlights();

  for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
    const pageText = await getPageText(pageNum);
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;
    while ((match = regex.exec(pageText)) !== null) {
      searchState.matches.push({
        pageNum,
        match,
      });
    }
  }

  if (searchState.matches.length > 0) {
    searchState.currentMatchIndex = 0;
    highlightCurrentMatch();
  }
  updateSearchButtons();
}

async function getPageText(pageNum) {
  if (searchState.pageTextCache.has(pageNum)) {
    return searchState.pageTextCache.get(pageNum);
  }
  const page = await state.pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const pageText = textContent.items.map((item) => item.str).join('');
  searchState.pageTextCache.set(pageNum, pageText);
  return pageText;
}

export function searchNext() {
  if (searchState.matches.length === 0) return;
  searchState.currentMatchIndex = (searchState.currentMatchIndex + 1) % searchState.matches.length;
  highlightCurrentMatch();
}

export function searchPrevious() {
  if (searchState.matches.length === 0) return;
  searchState.currentMatchIndex =
    (searchState.currentMatchIndex - 1 + searchState.matches.length) % searchState.matches.length;
  highlightCurrentMatch();
}

async function highlightCurrentMatch() {
  if (searchState.currentMatchIndex < 0) return;

  const match = searchState.matches[searchState.currentMatchIndex];
  const pageElement = document.getElementById(`page-${match.pageNum}`);
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  clearSearchHighlights();

  // Ensure text layer is rendered for the target page
  if (!state.textLayerStates.get(match.pageNum)?.rendered) {
    await renderTextLayer(match.pageNum);
  }

  highlightMatchInTextLayer(match.pageNum, searchState.query);
}

function highlightMatchInTextLayer(pageNum, query) {
  const textLayer = state.textLayerStates.get(pageNum)?.container;
  if (!textLayer) return;

  const spans = textLayer.querySelectorAll('span');
  let content = '';
  const spanMetas = [];
  spans.forEach((span) => {
    content += span.textContent;
    spanMetas.push({ span, length: span.textContent.length });
  });

  const regex = new RegExp(query, 'gi');
  let match;
  while ((match = regex.exec(content)) !== null) {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    let currentIndex = 0;
    for (const meta of spanMetas) {
      const spanStart = currentIndex;
      const spanEnd = spanStart + meta.length;

      if (spanEnd > startIndex && spanStart < endIndex) {
        // This span is part of the match
        meta.span.classList.add('search-highlight');
        if (searchState.matches[searchState.currentMatchIndex].match.index === startIndex) {
          meta.span.classList.add('current');
        }
      }
      currentIndex = spanEnd;
    }
  }
}

function clearSearchHighlights() {
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach((h) => {
    h.classList.remove('search-highlight');
    h.classList.remove('current');
  });
}

function updateSearchButtons() {
  const prevBtn = document.getElementById('searchPrevBtn');
  const nextBtn = document.getElementById('searchNextBtn');
  const hasMatches = searchState.matches.length > 0;
  if (prevBtn) prevBtn.disabled = !hasMatches;
  if (nextBtn) nextBtn.disabled = !hasMatches;
}
