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
    stream.markdown(`- **\`/cache-stats\`** - Show summary cache statistics\n`);
    stream.markdown(`- **\`/clear-cache\`** - Clear all cached summaries\n\n`);
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
    const stats = this.summaryHandler.getCacheStats();

    stream.markdown(`## 📊 Summary Cache Statistics\n\n`);
    stream.markdown(`- **Total Entries:** ${stats.totalEntries}\n`);
    stream.markdown(`- **Total Size:** ${stats.totalSizeKB} KB\n`);

    if (stats.oldestEntry) {
      stream.markdown(`- **Oldest Entry:** ${stats.oldestEntry.toLocaleDateString()}\n`);
    }

    if (stats.totalEntries === 0) {
      stream.markdown(`\n*Cache is empty. Summaries will be cached after processing PDFs.*\n`);
    } else {
      stream.markdown(
        `\n*Cached summaries provide instant results for previously processed documents.*\n`
      );
    }

    return {
      metadata: {
        command: CHAT_COMMANDS.CACHE_STATS,
        cacheStats: stats,
      },
    };
  }

  private async handleClearCache(stream: vscode.ChatResponseStream): Promise<ChatCommandResult> {
    await this.summaryHandler.clearCache();

    stream.markdown(`## 🗑️ Cache Cleared\n\n`);
    stream.markdown(
      `All cached summaries have been removed. Future PDF summarizations will process documents fresh and cache new results.\n`
    );

    return {
      metadata: {
        command: CHAT_COMMANDS.CLEAR_CACHE,
        timestamp: Date.now(),
      },
    };
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
