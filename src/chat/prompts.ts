import type { DocumentChunk } from '../types/interfaces';

export const Prompts = {
  summarize: {
    singleChunk: (fileName: string, text: string) => {
      return `Summarize this PDF document:

**File:** ${fileName}
**Strategy:** Full content analysis

**Content:**
${text}

Provide:
1. Brief overview
2. Key points
3. Main findings
4. Document structure`;
    },
    
    chunk: (chunk: DocumentChunk, fileName: string) => {
      return `Summarize this section of the PDF document:

**File:** ${fileName}
**Section:** Pages ${chunk.startPage}-${chunk.endPage} (Chunk ${chunk.index + 1})
**Content:**
${chunk.content}

Provide a comprehensive summary focusing on:
1. Main topics and themes
2. Key information and findings
3. Important details
4. Context and structure

Keep the summary detailed enough to preserve important information for later consolidation.`;
    },
    
    consolidation: (summaries: string[], fileName: string, totalPages: number) => {
      const combinedSummaries = summaries
        .map((summary, index) => `## Section ${index + 1}\n${summary}`)
        .join('\n\n');

      return `Create a comprehensive final summary from these section summaries of a PDF document:

**File:** ${fileName}
**Total Pages:** ${totalPages}
**Section Summaries:**
${combinedSummaries}

Create a unified summary that:
1. Provides a clear overview of the entire document
2. Synthesizes key themes and findings across all sections
3. Maintains logical flow and coherence
4. Highlights the most important information
5. Notes the document structure and organization

The final summary should be comprehensive yet concise, giving readers a complete understanding of the document's content and significance.`;
    },
    
    fallback: (shortExcerpt: string) => {
      return `Provide a brief summary of this PDF excerpt:\n\n${shortExcerpt}`;
    }
  },
  
  mindmap: {
    singleChunk: (fileName: string, text: string) => {
      return `Create a Mermaid mindmap from this PDF document:

**File:** ${fileName}
**Strategy:** Full content analysis

**Content:**
${text}

Generate a comprehensive Mermaid mindmap using proper syntax:
1. Start with "mindmap" declaration
2. Use root node with document title: root((Document Title))
3. Create main branches for key topics
4. Add sub-branches for important details
5. Use clear, concise node labels
6. Structure hierarchically to show relationships

Example format:
\`\`\`
mindmap
  root((Document Title))
    Topic1
      SubTopic1
      SubTopic2
    Topic2
      SubTopic3
        Detail1
        Detail2
    Topic3
      SubTopic4
\`\`\`

Focus on the document's main themes, key findings, and logical structure.`;
    },
    
    chunk: (chunk: DocumentChunk, fileName: string) => {
      return `Create a Mermaid mindmap section from this part of the PDF document:

**File:** ${fileName}
**Section:** Pages ${chunk.startPage}-${chunk.endPage} (Chunk ${chunk.index + 1})
**Content:**
${chunk.content}

Generate mindmap branches for this section that can be integrated into a larger mindmap:
1. Identify the main topics in this section
2. Create branches with clear, concise labels
3. Include important sub-topics and details
4. Use proper Mermaid mindmap syntax
5. Focus on content that will be meaningful in the overall document structure

Return only the branch structure (no "mindmap" declaration or root node), like:
\`\`\`
    MainConcept1
      SubConcept1
      SubConcept2
    MainConcept2
      SubConcept3
        Detail1
\`\`\``;
    },
    
    consolidation: (mindmaps: string[], fileName: string, totalPages: number) => {
      const combinedMindmaps = mindmaps
        .map((mindmap, index) => `## Section ${index + 1}\n${mindmap}`)
        .join('\n\n');

      return `Create a unified Mermaid mindmap from these section mindmaps of a PDF document:

**File:** ${fileName}
**Total Pages:** ${totalPages}
**Section Mindmaps:**
${combinedMindmaps}

Create a comprehensive mindmap that:
1. Starts with "mindmap" declaration
2. Uses a root node with the document title: root((Document Title))
3. Organizes all section content into logical main branches
4. Maintains hierarchical structure showing relationships
5. Eliminates redundancy while preserving important details
6. Uses clear, concise node labels
7. Creates a coherent flow that represents the entire document

The final mindmap should give readers a complete visual understanding of the document's structure and key concepts using proper Mermaid syntax.`;
    },
    
    fallback: (shortExcerpt: string) => {
      return `Create a simple Mermaid mindmap from this PDF excerpt:\n\n${shortExcerpt}`;
    }
  }
};
