/* global pdfjsLib */

/**
 * Scrolls to a specific page in the PDF viewer.
 * @param {number} pageNum - The page number to navigate to.
 */
export function goToPage(pageNum) {
  const pageElement = document.getElementById(`page-${pageNum}`);
  if (pageElement) {
    pageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Helper function to show status messages in the UI.
 * @param {string} message The message to display.
 */
export function showStatusMessage(message) {
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = `
    position: fixed;
    bottom: 50px;
    right: 20px;
    background: var(--vscode-notifications-background);
    color: var(--vscode-notifications-foreground);
    border: 1px solid var(--vscode-notifications-border);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    transition: opacity 0.3s ease;
  `;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  setTimeout(() => {
    statusDiv.style.opacity = '0';
    setTimeout(() => {
      if (statusDiv.parentNode) {
        statusDiv.parentNode.removeChild(statusDiv);
      }
    }, 300);
  }, 2000);
}

/**
 * Waits for the pdfjsLib to be available on the window object.
 * @returns {Promise<void>}
 */
export function waitForPdfJs() {
  return new Promise((resolve) => {
    if (window.pdfjsLib) {
      resolve();
    } else {
      const checkPdfJs = () => {
        if (window.pdfjsLib) {
          resolve();
        } else {
          setTimeout(checkPdfJs, 10);
        }
      };
      checkPdfJs();
    }
  });
}

/**
 * Extract annotations from a PDF page with enhanced content extraction.
 * @param {Object} page PDF.js page object
 * @param {number} pageNum Page number
 * @returns {Promise<Array>} Array of annotation objects
 */
export async function extractAnnotationsFromPage(page, pageNum) {
  try {
    const annotations = await page.getAnnotations();
    return annotations.map((annotation, index) => {
      let content = '';
      let title = '';

      // Try multiple approaches to extract meaningful content
      if (annotation.contents && annotation.contents.trim()) {
        content = annotation.contents.trim();
      } else if (annotation.url) {
        content = `Link to: ${annotation.url}`;
      } else if (annotation.dest) {
        content = `Internal link`;
      } else if (annotation.file && annotation.file.filename) {
        content = `File attachment: ${annotation.file.filename}`;
      } else if (annotation.title && annotation.title.trim()) {
        content = annotation.title.trim();
      } else if (annotation.subject && annotation.subject.trim()) {
        content = annotation.subject.trim();
      } else if (annotation.action) {
        content = `Action: ${annotation.action.type || 'Unknown'}`;
      } else {
        // Fallback based on annotation type
        switch (annotation.subtype) {
          case 'Link':
            content = annotation.url ? `External link` : `Internal navigation`;
            break;
          case 'Text':
            content = annotation.contents || 'Text annotation';
            break;
          case 'Note':
            content = annotation.contents || 'Note';
            break;
          case 'Highlight':
            content = 'Highlighted text';
            break;
          case 'Underline':
            content = 'Underlined text';
            break;
          case 'StrikeOut':
            content = 'Struck out text';
            break;
          case 'Squiggly':
            content = 'Squiggly underline';
            break;
          case 'FreeText':
            content = annotation.contents || 'Free text';
            break;
          case 'FileAttachment':
            content = 'File attachment';
            break;
          default:
            content = `${annotation.subtype || 'Unknown'} annotation`;
        }
      }

      // Extract title/subject if available
      if (annotation.title && annotation.title.trim()) {
        title = annotation.title.trim();
      } else if (annotation.subject && annotation.subject.trim()) {
        title = annotation.subject.trim();
      }

      return {
        id: `annotation_${pageNum}_${index}`,
        pageNum,
        type: annotation.subtype || 'unknown',
        content: content || 'No content available',
        title: title,
        rect: annotation.rect || [],
        url: annotation.url || null,
        dest: annotation.dest || null,
        ...annotation,
      };
    });
  } catch (error) {
    console.warn(`Failed to extract annotations from page ${pageNum}:`, error);
    return [];
  }
}

/**
 * Extract document metadata.
 * @param {Object} pdfDoc PDF.js document object
 * @returns {Promise<Object>} Metadata object
 */
export async function extractMetadata(pdfDoc) {
  try {
    const metadata = await pdfDoc.getMetadata();
    return metadata.info || {};
  } catch (error) {
    console.warn('Failed to extract metadata:', error);
    return {};
  }
}

/**
 * Extract document bookmarks with enhanced information.
 * @param {Object} pdfDoc PDF.js document object
 * @returns {Promise<Array>} Array of bookmark objects
 */
export async function extractBookmarks(pdfDoc) {
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || outline.length === 0) return [];

    // Process bookmarks recursively to ensure all properties are properly set
    const processBookmarks = async (bookmarks, level = 0) => {
      const processedBookmarks = [];

      for (let i = 0; i < bookmarks.length; i++) {
        const bookmark = bookmarks[i];
        const processedBookmark = {
          title: bookmark.title || `Untitled Bookmark ${i + 1}`,
          dest: bookmark.dest,
          url: bookmark.url,
          newWindow: bookmark.newWindow,
          count: bookmark.count,
          items: [],
        };

        // Process destination to get page number
        if (bookmark.dest) {
          try {
            if (Array.isArray(bookmark.dest)) {
              // dest is an array [pageRef, name, ...args]
              const pageRef = bookmark.dest[0];
              if (pageRef && typeof pageRef === 'object' && pageRef.num !== undefined) {
                const pageNum = (await pdfDoc.getPageIndex(pageRef)) + 1;
                processedBookmark.pageNum = pageNum;
              }
            } else if (typeof bookmark.dest === 'string') {
              // dest is a named destination string
              try {
                const destArray = await pdfDoc.getDestination(bookmark.dest);
                if (destArray && destArray[0]) {
                  const pageRef = destArray[0];
                  const pageNum = (await pdfDoc.getPageIndex(pageRef)) + 1;
                  processedBookmark.pageNum = pageNum;
                }
              } catch (destError) {
                console.warn(`Failed to resolve named destination ${bookmark.dest}:`, destError);
              }
            }
          } catch (pageError) {
            console.warn('Failed to resolve bookmark page:', pageError);
          }
        }

        // Process nested bookmarks recursively
        if (bookmark.items && bookmark.items.length > 0) {
          processedBookmark.items = await processBookmarks(bookmark.items, level + 1);
        }

        processedBookmarks.push(processedBookmark);
      }

      return processedBookmarks;
    };

    return await processBookmarks(outline);
  } catch (error) {
    console.warn('Failed to extract bookmarks:', error);
    return [];
  }
}

/**
 * Convert image object to base64.
 * @param {Object} imgObj PDF.js image object
 * @returns {Promise<string|null>} Base64 image string or null
 */
export async function convertImageToBase64(imgObj) {
  try {
    if (!imgObj.data) return null;

    const { data, width, height, kind } = imgObj;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = width;
    canvas.height = height;

    let imageData;

    switch (kind) {
      case 1: // GRAYSCALE_1BPP
        imageData = convertGrayscale1BPP(data, width, height);
        break;
      case 2: // RGB_24BPP
        imageData = convertRGB24BPP(data, width, height);
        break;
      case 3: // RGBA_32BPP
        imageData = new ImageData(new Uint8ClampedArray(data), width, height);
        break;
      default:
        imageData = new ImageData(new Uint8ClampedArray(data), width, height);
        break;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return null;
  }
}

/**
 * Convert RGB 24BPP data to RGBA.
 * @param {Uint8Array} data Image data
 * @param {number} width Image width
 * @param {number} height Image height
 * @returns {ImageData} RGBA ImageData
 */
function convertRGB24BPP(data, width, height) {
  const rgbaData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 3) {
    const rgbaIndex = (i / 3) * 4;
    rgbaData[rgbaIndex] = data[i];
    rgbaData[rgbaIndex + 1] = data[i + 1];
    rgbaData[rgbaIndex + 2] = data[i + 2];
    rgbaData[rgbaIndex + 3] = 255;
  }
  return new ImageData(rgbaData, width, height);
}

/**
 * Convert grayscale 1BPP data to RGBA.
 * @param {Uint8Array} data Image data
 * @param {number} width Image width
 * @param {number} height Image height
 * @returns {ImageData} RGBA ImageData
 */
function convertGrayscale1BPP(data, width, height) {
  const rgbaData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    for (let bit = 7; bit >= 0; bit--) {
      const pixelIndex = (i * 8 + (7 - bit)) * 4;
      if (pixelIndex >= rgbaData.length) break;
      const value = (byte >> bit) & 1 ? 255 : 0;
      rgbaData[pixelIndex] = value;
      rgbaData[pixelIndex + 1] = value;
      rgbaData[pixelIndex + 2] = value;
      rgbaData[pixelIndex + 3] = 255;
    }
  }
  return new ImageData(rgbaData, width, height);
}

// ===== COMPREHENSIVE PDF EXTRACTION FUNCTIONS =====

/**
 * Extract images from a PDF page with comprehensive format support.
 * @param {Object} page PDF.js page object
 * @param {number} pageNum Page number
 * @returns {Promise<Array>} Array of image objects
 */
export async function extractImagesFromPage(page, pageNum) {
  const images = [];

  try {
    const operatorList = await page.getOperatorList();
    console.log(`Page ${pageNum} operator list:`, operatorList);
    console.log(`Found ${operatorList.fnArray.length} operations`);

    let imageIndex = 0;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
      const fn = operatorList.fnArray[i];
      const args = operatorList.argsArray[i];

      // Check all possible image operations
      // OPS constants from PDF.js: paintImageXObject = 85, paintJpegXObject = 86, paintImageMaskXObject = 87
      if (fn === 85 || fn === 86 || fn === 87) {
        console.log(`Found image operation: fn=${fn}, args=`, args);
        const objId = args[0];

        try {
          // Wait for the object to be available with timeout
          const imgObj = await Promise.race([
            new Promise((resolve) => {
              page.objs.get(objId, resolve);
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Image object timeout')), 2000)
            ),
          ]);

          if (imgObj && !imgObj.error) {
            let base64Image = null;

            // Try different approaches to get image data
            if (imgObj.bitmap && imgObj.bitmap instanceof ImageBitmap) {
              console.log(`Found ImageBitmap, width: ${imgObj.width}, height: ${imgObj.height}`);
              base64Image = await convertImageBitmapToBase64(imgObj.bitmap);
            } else if (imgObj.data) {
              console.log(
                `Found image data, kind: ${imgObj.kind}, width: ${imgObj.width}, height: ${imgObj.height}`
              );
              base64Image = await convertImageToBase64(imgObj);
            } else if (imgObj instanceof HTMLImageElement) {
              // If it's already an HTML image element
              base64Image = await convertHTMLImageToBase64(imgObj);
            } else if (imgObj instanceof HTMLCanvasElement) {
              // If it's a canvas
              base64Image = imgObj.toDataURL('image/png');
            }

            if (base64Image) {
              const extractedImage = {
                id: `img_${pageNum}_${imageIndex}`,
                pageNum,
                base64: base64Image,
                width: imgObj.width || 0,
                height: imgObj.height || 0,
                x: 0,
                y: 0,
              };

              // Filter out very small images (likely icons, bullets, etc.)
              const minSize = 80; // Minimum width or height
              const minArea = 5000; // Minimum total area
              const area = extractedImage.width * extractedImage.height;

              if (
                extractedImage.width >= minSize ||
                extractedImage.height >= minSize ||
                area >= minArea
              ) {
                console.log(
                  `Successfully extracted meaningful image ${imageIndex} from page ${pageNum} (${extractedImage.width}×${extractedImage.height})`
                );
                images.push(extractedImage);
                imageIndex++;
              } else {
                console.log(
                  `Skipped small image: ${extractedImage.width}×${extractedImage.height} (too small)`
                );
              }
            } else {
              console.warn(`Could not convert image object to base64:`, imgObj);
            }
          } else {
            console.warn(`Image object ${objId} failed to load or has errors`);
          }
        } catch (objError) {
          // Handle JPEG 2000 and other decode errors gracefully
          if (objError.message.includes('JpxError') || objError.message.includes('OpenJPEG')) {
            console.warn(`Skipping JPEG 2000 image ${objId} (format not supported)`);
          } else {
            console.warn(`Failed to extract image object ${objId}:`, objError.message);
          }
        }
      }
    }

    console.log(`Extracted ${images.length} images from page ${pageNum}`);
    return images;
  } catch (error) {
    console.error(`Error extracting images from page ${pageNum}:`, error);
    return [];
  }
}

/**
 * Extract tables from a PDF page using text positioning analysis.
 * @param {Object} page PDF.js page object
 * @param {number} pageNum Page number
 * @returns {Promise<Array>} Array of table objects
 */
export async function extractTablesFromPage(page, pageNum) {
  try {
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    // Convert text items to our format
    const textItems = textContent.items
      .filter((item) => item.str && item.str.trim().length > 0)
      .map((item) => {
        const transform = item.transform;
        const x = transform[4];
        const y = viewport.height - transform[5];

        return {
          str: item.str.trim(),
          x,
          y,
          width: item.width || 0,
          height: Math.abs(transform[3]) || 12,
          fontName: item.fontName || '',
          fontSize: Math.abs(transform[3]) || 12,
        };
      });

    if (textItems.length < 6) return [];

    // Simple table detection: group items into potential tables
    const tables = detectTablesFromTextItems(textItems, pageNum);
    return tables;
  } catch (error) {
    console.error(`Error detecting tables from page ${pageNum}:`, error);
    return [];
  }
}

/**
 * Convert HTML image element to base64.
 * @param {HTMLImageElement} imgElement Image element
 * @returns {Promise<string|null>} Base64 image string or null
 */
async function convertHTMLImageToBase64(imgElement) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;

    ctx.drawImage(imgElement, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error converting HTML image to base64:', error);
    return null;
  }
}

/**
 * Convert ImageBitmap to base64.
 * @param {ImageBitmap} imageBitmap ImageBitmap object
 * @returns {Promise<string|null>} Base64 image string or null
 */
async function convertImageBitmapToBase64(imageBitmap) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    // Draw the ImageBitmap to the canvas
    ctx.drawImage(imageBitmap, 0, 0);

    return canvas.toDataURL('image/png');
  } catch (error) {
    console.error('Error converting ImageBitmap to base64:', error);
    return null;
  }
}

/**
 * Detect tables from text items using positioning analysis.
 * @param {Array} textItems Array of text items
 * @param {number} pageNum Page number
 * @returns {Array} Array of table objects
 */
function detectTablesFromTextItems(textItems, pageNum) {
  // Sort by Y then X
  const sortedItems = textItems.sort((a, b) => {
    const yDiff = Math.abs(a.y - b.y);
    if (yDiff < 5) {
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  // Group into rows
  const rows = [];
  let currentRow = [];
  let currentY = sortedItems[0]?.y || 0;

  for (const item of sortedItems) {
    if (Math.abs(item.y - currentY) <= 10) {
      currentRow.push(item);
    } else {
      if (currentRow.length > 0) {
        rows.push([...currentRow]);
      }
      currentRow = [item];
      currentY = item.y;
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // Look for table patterns
  const tables = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const firstRow = rows[i];
    if (firstRow.length < 2) continue;

    const tableRows = [firstRow];

    // Find consecutive rows with similar structure
    for (let j = i + 1; j < rows.length; j++) {
      const nextRow = rows[j];
      if (rowsAreAligned(firstRow, nextRow)) {
        tableRows.push(nextRow);
      } else {
        break;
      }
    }

    if (tableRows.length >= 2) {
      const tableData = {
        id: `table_${pageNum}_${tables.length}`,
        pageNum,
        rows: tableRows.map((row) => row.map((item) => item.str)),
      };
      tables.push(tableData);
      i += tableRows.length - 1;
    }
  }

  return tables;
}

/**
 * Check if two table rows are aligned.
 * @param {Array} row1 First row
 * @param {Array} row2 Second row
 * @returns {boolean} True if rows are aligned
 */
function rowsAreAligned(row1, row2) {
  if (Math.abs(row1.length - row2.length) > 1) return false;

  const minLength = Math.min(row1.length, row2.length);
  let alignedColumns = 0;

  for (let i = 0; i < minLength; i++) {
    if (Math.abs(row1[i].x - row2[i].x) <= 15) {
      alignedColumns++;
    }
  }

  return alignedColumns >= minLength * 0.7;
}

/**
 * Extract fonts from a PDF page with enhanced font information.
 * @param {Object} page PDF.js page object
 * @param {number} pageNum Page number
 * @returns {Promise<Array>} Array of font objects
 */
export async function extractFontsFromPage(page, pageNum) {
  try {
    const textContent = await page.getTextContent();
    const fonts = new Map();

    // Get font mapping from page resources for better font info
    let fontResources = {};
    try {
      const resources = await page.getOperatorList();
      // Try to get font resources if available
      const pageDict = page._pageDict;
      if (pageDict && pageDict.get && pageDict.get('Resources')) {
        const resources = pageDict.get('Resources');
        if (resources.get && resources.get('Font')) {
          fontResources = resources.get('Font');
        }
      }
    } catch (fontResourceError) {
      // Font resources not available, continue with basic extraction
    }

    textContent.items.forEach((item) => {
      if (item.fontName && !fonts.has(item.fontName)) {
        // Clean up font name for display
        let displayName = item.fontName;
        let fontType = 'Unknown';

        // Extract meaningful name from PDF font identifiers
        if (displayName.includes('+')) {
          // Remove font subset prefix (e.g., "ABCDEF+Arial" -> "Arial")
          displayName = displayName.split('+')[1] || displayName;
        }

        // Clean up common PDF font naming patterns
        displayName = displayName.replace(/[_-]?MT$/, ''); // Remove -MT suffix
        displayName = displayName.replace(/[_-]?PS$/, ''); // Remove -PS suffix

        // Handle embedded font patterns with better classification
        const originalName = displayName;
        if (displayName.match(/^[a-z]+_d\d+_f\d+$/)) {
          // Pattern like g_d0_f1 - this is an embedded font
          displayName = '';

          // Try to classify embedded font type based on usage context or common patterns
          // Look at the actual font usage in the text to make educated guesses
          const fontUsage = textContent.items.filter(
            (textItem) => textItem.fontName === item.fontName
          );
          if (fontUsage.length > 0) {
            // Analyze character patterns to guess font type
            const sampleText = fontUsage
              .slice(0, 10)
              .map((t) => t.str)
              .join('')
              .toLowerCase();

            // Check for common patterns that suggest font type
            if (sampleText.match(/[0-9.,%-]+/) && sampleText.match(/[a-z]/)) {
              fontType = 'Sans-serif (Text)';
            } else if (sampleText.match(/^[0-9.,%-\s]+$/)) {
              fontType = 'Sans-serif (Numbers)';
            } else if (sampleText.match(/[ivxlcdm]+/i) && sampleText.length < 20) {
              fontType = 'Serif (Titles/Headers)';
            } else {
              fontType = 'Document Font';
            }
          } else {
            fontType = 'Document Font';
          }
        } else {
          // Try to identify font type from name for non-embedded fonts
          const lowerName = displayName.toLowerCase();
          if (
            lowerName.includes('arial') ||
            lowerName.includes('helvetica') ||
            lowerName.includes('calibri') ||
            lowerName.includes('verdana')
          ) {
            fontType = 'Sans-serif';
            displayName =
              displayName.replace(/regular|bold|italic|light/gi, '').trim() || displayName;
          } else if (
            lowerName.includes('times') ||
            lowerName.includes('serif') ||
            lowerName.includes('georgia') ||
            lowerName.includes('garamond')
          ) {
            fontType = 'Serif';
            displayName =
              displayName.replace(/regular|bold|italic|light/gi, '').trim() || displayName;
          } else if (
            lowerName.includes('courier') ||
            lowerName.includes('mono') ||
            lowerName.includes('consolas')
          ) {
            fontType = 'Monospace';
            displayName =
              displayName.replace(/regular|bold|italic|light/gi, '').trim() || displayName;
          } else if (
            lowerName.includes('symbol') ||
            lowerName.includes('ding') ||
            lowerName.includes('wingding')
          ) {
            fontType = 'Symbol';
          } else if (displayName.length > 0) {
            fontType = 'Custom';
          }
        }

        fonts.set(item.fontName, {
          id: `font_${pageNum}_${item.fontName.replace(/[^a-zA-Z0-9]/g, '_')}`,
          pageNum,
          name: displayName,
          originalName: item.fontName,
          type: fontType,
        });
      }
    });

    return Array.from(fonts.values());
  } catch (error) {
    console.warn(`Failed to extract fonts from page ${pageNum}:`, error);
    return [];
  }
}

/**
 * Extract form fields from a PDF document.
 * @param {Object} pdfDoc PDF.js document object
 * @returns {Promise<Array>} Array of form field objects
 */
export async function extractFormFields(pdfDoc) {
  try {
    const fieldObjects = await pdfDoc.getFieldObjects();
    if (!fieldObjects) return [];

    const formFields = [];
    for (const [name, field] of Object.entries(fieldObjects)) {
      formFields.push({
        id: `field_${name}`,
        name: name,
        type: field.type || 'unknown',
        value: field.value || '',
        page: field.page || 1,
      });
    }

    return formFields;
  } catch (error) {
    console.warn('Failed to extract form fields:', error);
    return [];
  }
}

/**
 * Extract attachments from a PDF document.
 * @param {Object} pdfDoc PDF.js document object
 * @returns {Promise<Array>} Array of attachment objects
 */
export async function extractAttachments(pdfDoc) {
  try {
    const attachments = await pdfDoc.getAttachments();
    if (!attachments) return [];

    const attachmentObjects = [];
    for (const [filename, attachment] of Object.entries(attachments)) {
      attachmentObjects.push({
        filename: filename,
        content: attachment.content,
        description: attachment.description || '',
        size: attachment.content ? attachment.content.length : 0,
      });
    }

    return attachmentObjects;
  } catch (error) {
    console.warn('Failed to extract attachments:', error);
    return [];
  }
}

/**
 * Extract JavaScript from a PDF document.
 * @param {Object} pdfDoc PDF.js document object
 * @returns {Promise<Array>} Array of JavaScript code strings
 */
export async function extractJavaScript(pdfDoc) {
  try {
    const javaScript = await pdfDoc.getJavaScript();
    return javaScript || [];
  } catch (error) {
    console.warn('Failed to extract JavaScript:', error);
    return [];
  }
}
