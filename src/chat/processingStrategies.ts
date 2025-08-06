import { Prompts } from './prompts';

export interface ProcessingStrategy {
  getPrompt(type: 'singleChunk' | 'chunk' | 'consolidation' | 'fallback', ...args: any[]): string;
  formatResult(result: string, type: 'mindmap' | 'summary'): string;
}

export class SummarizationStrategy implements ProcessingStrategy {
  getPrompt(type: 'singleChunk' | 'chunk' | 'consolidation' | 'fallback', ...args: any[]): string {
    switch (type) {
      case 'singleChunk':
        return Prompts.summarize.singleChunk(args[0], args[1]);
      case 'chunk':
        return Prompts.summarize.chunk(args[0], args[1]);
      case 'consolidation':
        return Prompts.summarize.consolidation(args[0], args[1], args[2]);
      case 'fallback':
        return Prompts.summarize.fallback(args[0]);
    }
  }

  formatResult(result: string): string {
    return result.trim();
  }
}

export class MindmapStrategy implements ProcessingStrategy {
  getPrompt(type: 'singleChunk' | 'chunk' | 'consolidation' | 'fallback', ...args: any[]): string {
    switch (type) {
      case 'singleChunk':
        return Prompts.mindmap.singleChunk(args[0], args[1]);
      case 'chunk':
        return Prompts.mindmap.chunk(args[0], args[1]);
      case 'consolidation':
        return Prompts.mindmap.consolidation(args[0], args[1], args[2]);
      case 'fallback':
        return Prompts.mindmap.fallback(args[0]);
    }
  }

  formatResult(result: string): string {
    const match = result.match(/```mermaid([\s\S]*?)```/);
    return match ? match[1].trim() : result.trim();
  }
}
