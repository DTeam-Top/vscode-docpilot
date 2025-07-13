# Text Selection Enhancement Ideas - DocPilot VSCode Extension

**Date:** 2025年7月13日  
**Status:** Proposal - Awaiting Decision  
**Current Issue:** Text content matching may have some fragmentation

---

## 🔍 **Problem Analysis**

### **Root Cause of Text Fragmentation:**

The current text selection implementation suffers from fragmentation because PDF.js's `getTextContent()` returns text in small, disconnected fragments. Each text item becomes a separate `<span>` element, leading to:

- **Choppy Selection**: Users can't smoothly select continuous text
- **Fragmented Copy/Paste**: Copied text has unexpected breaks and spaces
- **Poor UX**: Visual text appears continuous but behaves as disconnected fragments
- **Performance Impact**: Many small DOM elements instead of logical text blocks

### **Current Implementation Analysis:**

```javascript
// Current problematic approach - each textItem = separate span
textContent.items.forEach((textItem, index) => {
    const textSpan = document.createElement('span');
    textSpan.textContent = textItem.str; // "H", "e", "l", "l", "o" become 5 spans
    // ... positioning logic
});
```

**Example Fragmentation Pattern:**

- PDF Text: "Hello World!"
- Current Output: `["H", "e", "l", "l", "o", " ", "W", "o", "r", "l", "d", "!"]`
- Desired Output: `["Hello", " ", "World", "!"]` or `["Hello World!"]`

---

## 💡 **Enhancement Solutions**

### **Approach 1: Spatial Clustering Algorithm**

**Concept:** Group text items based on their spatial proximity and alignment.

```javascript
function groupTextItems(textItems, viewport) {
    const groups = [];
    const LINE_HEIGHT_THRESHOLD = 5; // pixels
    const WORD_SPACING_THRESHOLD = 10; // pixels
    
    textItems.forEach(item => {
        const y = viewport.height - (item.transform[5] * scale);
        const x = item.transform[4] * scale;
        
        // Find existing group on same line
        let targetGroup = groups.find(group => 
            Math.abs(group.baseline - y) < LINE_HEIGHT_THRESHOLD &&
            Math.abs(group.endX - x) < WORD_SPACING_THRESHOLD
        );
        
        if (targetGroup) {
            // Merge with existing group
            targetGroup.text += item.str;
            targetGroup.endX = x + (item.width * scale);
            targetGroup.items.push(item);
        } else {
            // Create new group
            groups.push({
                text: item.str,
                baseline: y,
                startX: x,
                endX: x + (item.width * scale),
                items: [item],
                transform: item.transform
            });
        }
    });
    
    return groups;
}
```

**Pros:**

- Handles various PDF layouts
- Preserves spatial relationships
- Maintains proper word spacing

**Cons:**

- Complex threshold tuning needed
- May struggle with rotated text
- Performance overhead for large documents

### **Approach 2: Character-Level Sequential Merging**

**Concept:** Merge adjacent text items that should logically be part of the same word or phrase.

```javascript
function mergeAdjacentText(textItems) {
    const merged = [];
    let currentGroup = null;
    
    textItems.forEach((item, index) => {
        if (!currentGroup) {
            currentGroup = { 
                ...item, 
                combinedStr: item.str,
                items: [item]
            };
            return;
        }
        
        const prevItem = textItems[index - 1];
        const isAdjacent = areItemsAdjacent(prevItem, item);
        const isSameStyle = haveSameStyle(prevItem, item);
        
        if (isAdjacent && isSameStyle) {
            // Merge with current group
            currentGroup.combinedStr += item.str;
            currentGroup.items.push(item);
        } else {
            // Finalize current group and start new one
            merged.push(currentGroup);
            currentGroup = { 
                ...item, 
                combinedStr: item.str,
                items: [item]
            };
        }
    });
    
    if (currentGroup) merged.push(currentGroup);
    return merged;
}

function areItemsAdjacent(item1, item2) {
    const threshold = 3; // pixels
    const item1End = item1.transform[4] + (item1.width || 0);
    const item2Start = item2.transform[4];
    return Math.abs(item2Start - item1End) <= threshold;
}

function haveSameStyle(item1, item2) {
    return item1.fontName === item2.fontName && 
           Math.abs(item1.transform[0] - item2.transform[0]) < 0.1; // Same scale
}
```

**Pros:**

- Simple to implement and understand
- Preserves original text order
- Low performance impact

**Cons:**

- May not handle complex layouts well
- Requires careful adjacency detection
- Limited to sequential text items

### **Approach 3: Word Boundary Detection**

**Concept:** Intelligently detect word boundaries and group text accordingly.

```javascript
function detectWordBoundaries(textItems) {
    const words = [];
    let currentWord = { items: [], text: '', transform: null };
    
    textItems.forEach((item, index) => {
        const isWhitespace = /^\s+$/.test(item.str);
        const nextItem = textItems[index + 1];
        const hasSpaceAfter = nextItem && 
            (nextItem.transform[4] - (item.transform[4] + (item.width || 0))) > 3;
        
        if (!isWhitespace) {
            currentWord.items.push(item);
            currentWord.text += item.str;
            if (!currentWord.transform) currentWord.transform = item.transform;
        }
        
        // End word if we hit whitespace or significant gap
        if (isWhitespace || hasSpaceAfter || index === textItems.length - 1) {
            if (currentWord.text.trim()) {
                words.push(currentWord);
                
                // Add space if there was significant gap
                if (hasSpaceAfter && !isWhitespace) {
                    words.push({
                        items: [],
                        text: ' ',
                        transform: item.transform,
                        isSpace: true
                    });
                }
            }
            currentWord = { items: [], text: '', transform: null };
        }
    });
    
    return words;
}
```

**Pros:**

- Natural word-level grouping
- Handles spaces intelligently
- Good for most text scenarios

**Cons:**

- Complex whitespace handling
- May break on unusual layouts
- Requires extensive testing

### **Approach 4: Hybrid Multi-Level Grouping**

**Concept:** Combine multiple strategies for optimal results.

```javascript
function hybridTextGrouping(textItems, viewport) {
    // Level 1: Basic character merging
    const charMerged = mergeAdjacentText(textItems);
    
    // Level 2: Word boundary detection
    const wordGrouped = detectWordBoundaries(charMerged);
    
    // Level 3: Line-level spatial clustering
    const lineGrouped = groupByLines(wordGrouped, viewport);
    
    return lineGrouped;
}
```

---

## 🚀 **Implementation Strategy**

### **Phase 1: Basic Line Grouping (Quick Win)**

- **Timeline:** 1-2 days
- **Risk:** Low
- **Impact:** Medium

```javascript
// Simple implementation in renderTextLayer function
const lineGroups = groupItemsByLine(textContent.items);
lineGroups.forEach(lineGroup => {
    const lineSpan = document.createElement('span');
    lineSpan.textContent = lineGroup.text;
    lineSpan.style.whiteSpace = 'pre'; // Preserve spaces
    // ... apply positioning from first item in group
});
```

### **Phase 2: Word-Level Enhancement (Balanced)**

- **Timeline:** 3-5 days
- **Risk:** Medium
- **Impact:** High

Implement word boundary detection with configurable thresholds.

### **Phase 3: Advanced Spatial Clustering (Comprehensive)**

- **Timeline:** 1-2 weeks
- **Risk:** High
- **Impact:** Very High

Full spatial analysis with rotation and scaling support.

---

## 🔧 **Technical Implementation Details**

### **Configuration System**

```javascript
const TEXT_GROUPING_CONFIG = {
    enableWordGrouping: true,
    enableLineGrouping: true,
    enableCharacterMerging: true,
    
    // Thresholds (in pixels at scale 1.0)
    wordSpacingThreshold: 8,
    lineHeightThreshold: 5,
    characterSpacingThreshold: 2,
    
    // Features
    preservePunctuation: true,
    mergeAdjacentChars: true,
    handleRotatedText: false, // Advanced feature
    
    // Performance
    maxGroupSize: 1000, // characters
    enablePerformanceMonitoring: true
};
```

### **Enhanced Debug Mode**

```javascript
function analyzeTextFragmentation() {
    console.log('=== Text Fragmentation Analysis ===');
    
    textLayerStates.forEach((state, pageNum) => {
        if (state.rendered) {
            const spans = state.container.querySelectorAll('span');
            const totalChars = Array.from(spans).reduce((sum, span) => 
                sum + span.textContent.length, 0);
            const avgCharsPerSpan = totalChars / spans.length;
            
            console.log(`Page ${pageNum}:`, {
                totalSpans: spans.length,
                totalCharacters: totalChars,
                avgCharsPerSpan: avgCharsPerSpan.toFixed(2),
                fragmentationRatio: (spans.length / totalChars * 100).toFixed(1) + '%'
            });
            
            // Identify problematic patterns
            const singleCharSpans = Array.from(spans).filter(span => 
                span.textContent.length === 1).length;
            if (singleCharSpans > spans.length * 0.5) {
                console.warn(`High single-character fragmentation: ${singleCharSpans}/${spans.length}`);
            }
        }
    });
}

function toggleFragmentationAnalysis() {
    // Add button to analyze current fragmentation
    analyzeTextFragmentation();
    
    // Visual highlighting of problem areas
    textLayerStates.forEach((state, pageNum) => {
        const spans = state.container.querySelectorAll('span');
        spans.forEach(span => {
            if (span.textContent.length === 1) {
                span.style.backgroundColor = 'rgba(255, 0, 0, 0.3)'; // Red for single chars
            } else if (span.textContent.length < 4) {
                span.style.backgroundColor = 'rgba(255, 165, 0, 0.3)'; // Orange for short fragments
            }
        });
    });
}
```

### **Performance Monitoring**

```javascript
function monitorGroupingPerformance(startTime, method, itemCount) {
    const duration = performance.now() - startTime;
    const itemsPerMs = itemCount / duration;
    
    console.log(`Text grouping (${method}): ${duration.toFixed(2)}ms for ${itemCount} items (${itemsPerMs.toFixed(1)} items/ms)`);
    
    if (duration > 100) { // 100ms threshold
        console.warn(`Slow text grouping detected. Consider disabling advanced grouping for this document.`);
    }
}
```

---

## 🎯 **Alternative Approaches**

### **Option A: Dual-Mode Implementation**

- **Fast Mode:** Current implementation (no grouping)
- **Precise Mode:** Enhanced grouping algorithms
- **Auto Mode:** Automatically choose based on document complexity

### **Option B: Progressive Enhancement**

- Start with current implementation
- Apply grouping in background
- Seamlessly upgrade when ready

### **Option C: User-Configurable Strategy**

```javascript
// Settings panel for users
const userSettings = {
    textGroupingStrategy: 'auto', // 'none', 'basic', 'advanced', 'auto'
    performanceFirst: false,
    debugMode: false
};
```

---

## 📊 **Success Metrics**

### **Quantitative Metrics:**

- **Fragmentation Ratio:** `(total spans / total characters) * 100`
- **Average Characters per Span:** Target > 5 characters
- **Copy/Paste Quality:** User-reported satisfaction
- **Performance Impact:** < 20% increase in render time

### **Qualitative Metrics:**

- **User Experience:** Smooth text selection behavior
- **Copy Accuracy:** Copied text matches visual expectation
- **Selection Continuity:** No gaps in selection highlighting

---

## 🚧 **Implementation Notes**

### **Critical Considerations:**

1. **Backward Compatibility:** Ensure current functionality doesn't break
2. **Performance:** Large documents should not become unusable
3. **Testing:** Extensive testing with various PDF types required
4. **Fallback Strategy:** Graceful degradation when grouping fails

### **Testing Strategy:**

1. **PDF Variety:** Test with academic papers, forms, magazines, technical docs
2. **Performance Testing:** Documents with 100+ pages, 10,000+ text items
3. **Edge Cases:** Rotated text, multi-column layouts, tables
4. **Cross-browser:** Chrome, Firefox, Safari compatibility

### **Risk Mitigation:**

- Feature flag for easy disable
- Performance monitoring with automatic fallback
- Extensive logging for debugging
- User feedback mechanism

---

## 📝 **Decision Points**

### **Immediate Decision Required:**

1. **Scope:** Which approach to implement first?
2. **Timeline:** How much time to allocate?
3. **Priority:** High/Medium/Low priority vs other features?

### **Future Considerations:**

1. Should this be configurable by users?
2. Integration with search functionality?
3. Potential for ML-based text grouping?

---

**Next Steps:** Awaiting decision on implementation approach and timeline.
