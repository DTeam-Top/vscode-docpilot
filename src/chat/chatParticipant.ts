import * as vscode from 'vscode';
import type { ChatCommandResult } from '../types/interfaces';
import { CHAT_COMMANDS } from '../utils/constants';
import { ChatErrorHandler } from '../utils/errorHandler';
import { Logger } from '../utils/logger';
import { MindmapHandler } from './mindmapHandler';
import { SummaryHandler } from './summaryHandler';

export class ChatParticipant {
  private static readonly logger = Logger.getInstance();
  private readonly summaryHandler: SummaryHandler;
  private readonly mindmapHandler: MindmapHandler;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.summaryHandler = new SummaryHandler(extensionContext);
    this.mindmapHandler = new MindmapHandler(extensionContext);
  }

  static register(extensionContext: vscode.ExtensionContext): vscode.ChatParticipant {
    const participantHandler = new ChatParticipant(extensionContext);

    const chatParticipant = vscode.chat.createChatParticipant(
      'docpilot.chat-participant',
      (request, context, stream, token) =>
        participantHandler.handleRequest(request, context, stream, token)
    );

    chatParticipant.iconPath = vscode.Uri.joinPath(
      extensionContext.extensionUri,
      'resources',
      'docpilot-icon.png'
    );

    chatParticipant.followupProvider = {
      provideFollowups: (result, context, token) =>
        participantHandler.provideFollowups(result, context, token),
    };

    // Note: Slash commands are automatically registered based on the commands handled in handleRequest

    ChatParticipant.logger.info('Chat participant registered successfully');
    return chatParticipant;
  }

  async handleRequest(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ChatCommandResult> {
    ChatParticipant.logger.info('Chat request received', {
      command: request.command,
      prompt: request.prompt?.substring(0, 100),
    });

    try {
      // Immediate acknowledgment
      stream.markdown('🤖 DocPilot is processing your request...\n\n');

      // Route based on command
      switch (request.command) {
        case CHAT_COMMANDS.SUMMARISE:
          return await this.summaryHandler.handle(request, stream, token);

        case CHAT_COMMANDS.MINDMAP:
          return await this.mindmapHandler.handle(request, stream, token);

        case CHAT_COMMANDS.CACHE_STATS:
          return this.handleCacheStats(stream);

        case CHAT_COMMANDS.CLEAR_CACHE:
          return await this.handleClearCache(stream);

        default:
          return this.handleUnknownCommand(request, stream);
      }
    } catch (error) {
      ChatParticipant.logger.error('Error in chat request handler', error);
      return ChatErrorHandler.handle(error, stream, 'Chat request');
    }
  }

  private handleUnknownCommand(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream
  ): ChatCommandResult {
    stream.markdown(`❓ Unknown command. Here's what I can help with:\n\n`);
    stream.markdown(`### Available Commands\n\n`);
    stream.markdown(`- **\`/summarise\`** - Summarize a PDF document\n`);
    stream.markdown(`  - \`/summarise path/to/file.pdf\` - Summarize local file\n`);
    stream.markdown(`  - \`/summarise https://example.com/doc.pdf\` - Summarize remote PDF\n`);
    stream.markdown(`  - \`/summarise\` - Open file picker\n\n`);
    stream.markdown(`- **\`/mindmap\`** - Generate a Mermaid mindmap from a PDF document\n`);
    stream.markdown(`  - \`/mindmap path/to/file.pdf\` - Generate mindmap from local file\n`);
    stream.markdown(
      `  - \`/mindmap https://example.com/doc.pdf\` - Generate mindmap from remote PDF\n`
    );
    stream.markdown(`  - \`/mindmap\` - Open file picker\n\n`);
    stream.markdown(`- **\`/cache-stats\`** - Show cache statistics for summaries and mindmaps\n`);
    stream.markdown(`- **\`/clear-cache\`** - Clear all cached summaries and mindmaps\n\n`);
    stream.markdown(`### Examples\n\n`);
    stream.markdown(`\`\`\`\n`);
    stream.markdown(`@docpilot /summarise docs/report.pdf\n`);
    stream.markdown(`@docpilot /mindmap docs/report.pdf\n`);
    stream.markdown(`@docpilot /summarise https://example.com/whitepaper.pdf\n`);
    stream.markdown(`@docpilot /cache-stats\n`);
    stream.markdown(`@docpilot /clear-cache\n`);
    stream.markdown(`\`\`\`\n\n`);
    stream.markdown(`*DocPilot uses advanced semantic chunking to process documents of any size.*`);

    return {
      metadata: {
        command: request.command || 'unknown',
        helpProvided: true,
      },
    };
  }

  private handleCacheStats(stream: vscode.ChatResponseStream): ChatCommandResult {
    try {
      const summaryStats = this.summaryHandler.getSummaryCacheStats();
      const mindmapStats = this.mindmapHandler.getMindmapCacheStats();

      // Ensure stats are valid objects with default values
      const safeStats = {
        summary: summaryStats || { totalEntries: 0, totalSizeKB: 0, oldestEntry: null },
        mindmap: mindmapStats || { totalEntries: 0, totalSizeKB: 0, oldestEntry: null }
      };

      const totalEntries = safeStats.summary.totalEntries + safeStats.mindmap.totalEntries;
      const totalSizeKB = safeStats.summary.totalSizeKB + safeStats.mindmap.totalSizeKB;

      stream.markdown(`## 📊 Document Cache Statistics\n\n`);
      stream.markdown(`### Combined Cache Stats\n`);
      stream.markdown(`- **Total Entries:** ${totalEntries}\n`);
      stream.markdown(`- **Total Size:** ${totalSizeKB} KB\n\n`);

      stream.markdown(`### Summary Cache\n`);
      stream.markdown(`- **Entries:** ${safeStats.summary.totalEntries}\n`);
      stream.markdown(`- **Size:** ${safeStats.summary.totalSizeKB} KB\n`);
      if (safeStats.summary.oldestEntry) {
        stream.markdown(`- **Oldest:** ${safeStats.summary.oldestEntry.toLocaleDateString()}\n`);
      }

      stream.markdown(`\n### Mindmap Cache\n`);
      stream.markdown(`- **Entries:** ${safeStats.mindmap.totalEntries}\n`);
      stream.markdown(`- **Size:** ${safeStats.mindmap.totalSizeKB} KB\n`);
      if (safeStats.mindmap.oldestEntry) {
        stream.markdown(`- **Oldest:** ${safeStats.mindmap.oldestEntry.toLocaleDateString()}\n`);
      }

      if (totalEntries === 0) {
        stream.markdown(`\n*Caches are empty. Results will be cached after processing PDFs.*\n`);
      } else {
        stream.markdown(
          `\n*Cached results provide instant responses for previously processed documents.*\n`
        );
      }

      return {
        metadata: {
          command: CHAT_COMMANDS.CACHE_STATS,
          cacheStats: {
            summary: safeStats.summary,
            mindmap: safeStats.mindmap,
            combined: { totalEntries, totalSizeKB, oldestEntry: null }
          },
        },
      };
    } catch (error) {
      ChatParticipant.logger.error('Error handling cache stats', error);
      stream.markdown(`## ❌ Cache Stats Error\n\n`);
      stream.markdown(`Failed to retrieve cache statistics: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      
      return {
        metadata: {
          command: CHAT_COMMANDS.CACHE_STATS,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  private async handleClearCache(stream: vscode.ChatResponseStream): Promise<ChatCommandResult> {
    try {
      await this.summaryHandler.clearSummaryCache();
      await this.mindmapHandler.clearMindmapCache();

      stream.markdown(`## 🗑️ Caches Cleared\n\n`);
      stream.markdown(
        `All cached summaries and mindmaps have been removed. Future PDF processing will generate fresh results and cache them for faster subsequent access.\n`
      );

      return {
        metadata: {
          command: CHAT_COMMANDS.CLEAR_CACHE,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      ChatParticipant.logger.error('Error clearing caches', error);
      stream.markdown(`## ❌ Cache Clear Error\n\n`);
      stream.markdown(`Failed to clear caches: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      
      return {
        metadata: {
          command: CHAT_COMMANDS.CLEAR_CACHE,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      };
    }
  }

  provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken
  ): vscode.ChatFollowup[] {
    const followups: vscode.ChatFollowup[] = [];

    // Check if the last result was a successful summary or mindmap
    if (result.metadata?.command === CHAT_COMMANDS.SUMMARISE && !result.metadata.error) {
      followups.push({
        prompt: '',
        label: '📄 Summarize Another PDF',
        command: CHAT_COMMANDS.SUMMARISE,
      });
      followups.push({
        prompt: '',
        label: '🗺️ Generate Mindmap',
        command: CHAT_COMMANDS.MINDMAP,
      });
    }

    if (result.metadata?.command === CHAT_COMMANDS.MINDMAP && !result.metadata.error) {
      followups.push({
        prompt: '',
        label: '🗺️ Generate Another Mindmap',
        command: CHAT_COMMANDS.MINDMAP,
      });
      followups.push({
        prompt: '',
        label: '📄 Summarize PDF',
        command: CHAT_COMMANDS.SUMMARISE,
      });
    }

    return followups;
  }
}
