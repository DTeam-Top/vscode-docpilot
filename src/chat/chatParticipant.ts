import * as vscode from 'vscode';
import type { ChatCommandResult } from '../types/interfaces';
import { CHAT_COMMANDS } from '../utils/constants';
import { handleChatError } from '../utils/errorHandler';
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

        case CHAT_COMMANDS.CACHE_EXPORT:
          return await this.handleCacheExport(stream);

        default:
          return this.handleUnknownCommand(request, stream);
      }
    } catch (error) {
      ChatParticipant.logger.error('Error in chat request handler', error);
      return handleChatError(error, stream, 'Chat request');
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
    stream.markdown(`- **\`/clear-cache\`** - Clear all cached summaries and mindmaps\n`);
    stream.markdown(`- **\`/cache-export\`** - Export all cached summaries and mindmaps to markdown\n\n`);
    stream.markdown(`### Examples\n\n`);
    stream.markdown(`\`\`\`\n`);
    stream.markdown(`@docpilot /summarise docs/report.pdf\n`);
    stream.markdown(`@docpilot /mindmap docs/report.pdf\n`);
    stream.markdown(`@docpilot /summarise https://example.com/whitepaper.pdf\n`);
    stream.markdown(`@docpilot /cache-stats\n`);
    stream.markdown(`@docpilot /clear-cache\n`);
    stream.markdown(`@docpilot /cache-export\n`);
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

  private async handleCacheExport(stream: vscode.ChatResponseStream): Promise<ChatCommandResult> {
    try {
      // Get cache entries from both handlers
      const summaryEntries = this.summaryHandler.getAllSummaryCacheEntries();
      const mindmapEntries = this.mindmapHandler.getAllMindmapCacheEntries();

      if (summaryEntries.length === 0 && mindmapEntries.length === 0) {
        stream.markdown(`## 📤 Cache Export\n\n`);
        stream.markdown(`No cached data found. Process some PDFs first to build cache content.\n`);
        return {
          metadata: {
            command: CHAT_COMMANDS.CACHE_EXPORT,
            empty: true,
            timestamp: Date.now(),
          },
        };
      }

      stream.markdown(`## 📤 Cache Export\n\n`);
      stream.markdown(`Found ${summaryEntries.length} summaries and ${mindmapEntries.length} mindmaps.\n\n`);

      // Show folder picker
      const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select folder to save cache export',
      });

      if (!folderUri || folderUri.length === 0) {
        stream.markdown(`Export cancelled - no folder selected.\n`);
        return {
          metadata: {
            command: CHAT_COMMANDS.CACHE_EXPORT,
            cancelled: true,
            timestamp: Date.now(),
          },
        };
      }

      // Generate markdown content
      const markdownContent = this.generateCacheExportMarkdown(summaryEntries, mindmapEntries);
      
      // Save file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `docpilot-cache-export-${timestamp}.md`;
      const filePath = vscode.Uri.joinPath(folderUri[0], fileName);

      await vscode.workspace.fs.writeFile(filePath, Buffer.from(markdownContent, 'utf8'));

      // Open the exported file
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);

      stream.markdown(`✅ Cache exported successfully!\n\n`);
      stream.markdown(`**File:** \`${fileName}\`\n`);
      stream.markdown(`**Location:** \`${folderUri[0].fsPath}\`\n`);
      stream.markdown(`**Content:** ${summaryEntries.length} summaries, ${mindmapEntries.length} mindmaps\n`);

      return {
        metadata: {
          command: CHAT_COMMANDS.CACHE_EXPORT,
          fileName,
          summaryCount: summaryEntries.length,
          mindmapCount: mindmapEntries.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      ChatParticipant.logger.error('Error exporting cache', error);
      stream.markdown(`## ❌ Cache Export Error\n\n`);
      stream.markdown(`Failed to export cache: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      
      return {
        metadata: {
          command: CHAT_COMMANDS.CACHE_EXPORT,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now(),
        },
      };
    }
  }

  private generateCacheExportMarkdown(
    summaryEntries: Array<{ filePath: string; data: string; timestamp: number }>,
    mindmapEntries: Array<{ filePath: string; data: string; timestamp: number }>
  ): string {
    const exportTime = new Date().toLocaleString();
    let markdown = `# DocPilot Cache Export\n\nExported time: ${exportTime}\n\n`;

    // Combine and group by file path
    const fileMap = new Map<string, { summary?: string; mindmap?: string }>();

    // Add summaries
    for (const entry of summaryEntries) {
      const fileName = this.getFileNameFromPath(entry.filePath);
      if (!fileMap.has(fileName)) {
        fileMap.set(fileName, {});
      }
      const fileData = fileMap.get(fileName);
      if (fileData) {
        fileData.summary = entry.data;
      }
    }

    // Add mindmaps
    for (const entry of mindmapEntries) {
      const fileName = this.getFileNameFromPath(entry.filePath);
      if (!fileMap.has(fileName)) {
        fileMap.set(fileName, {});
      }
      const fileData = fileMap.get(fileName);
      if (fileData) {
        fileData.mindmap = entry.data;
      }
    }

    // Generate content for each file
    for (const [fileName, content] of fileMap.entries()) {
      markdown += `## ${fileName}\n\n`;
      
      if (content.summary) {
        markdown += `### Summary\n\n${content.summary}\n\n`;
      }
      
      if (content.mindmap) {
        markdown += `### Mindmap\n\n\`\`\`mermaid\n${content.mindmap}\n\`\`\`\n\n`;
      }
    }

    return markdown;
  }

  private getFileNameFromPath(filePath: string): string {
    if (filePath.startsWith('http')) {
      return filePath;
    }
    return filePath.split(/[/\\]/).pop() || filePath;
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
