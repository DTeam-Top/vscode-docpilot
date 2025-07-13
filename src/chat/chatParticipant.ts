import * as vscode from 'vscode';
import type { ChatCommandResult } from '../types/interfaces';
import { CHAT_COMMANDS } from '../utils/constants';
import { ChatErrorHandler } from '../utils/errorHandler';
import { Logger } from '../utils/logger';
import { SummaryHandler } from './summaryHandler';

export class ChatParticipant {
  private static readonly logger = Logger.getInstance();
  private readonly summaryHandler: SummaryHandler;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.summaryHandler = new SummaryHandler(extensionContext);
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
    stream.markdown(`### Examples\n\n`);
    stream.markdown(`\`\`\`\n`);
    stream.markdown(`@docpilot /summarise docs/report.pdf\n`);
    stream.markdown(`@docpilot /summarise https://example.com/whitepaper.pdf\n`);
    stream.markdown(`\`\`\`\n\n`);
    stream.markdown(`*DocPilot uses advanced semantic chunking to process documents of any size.*`);

    return {
      metadata: {
        command: request.command || 'unknown',
        helpProvided: true,
      },
    };
  }

  provideFollowups(
    result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken
  ): vscode.ChatFollowup[] {
    const followups: vscode.ChatFollowup[] = [];

    // Check if the last result was a successful summary
    if (result.metadata?.command === CHAT_COMMANDS.SUMMARISE && !result.metadata.error) {
      followups.push(
        {
          prompt: 'Summarize another PDF',
          label: '📄 Summarize Another PDF',
          command: CHAT_COMMANDS.SUMMARISE,
        },
        {
          prompt: 'How does semantic chunking work?',
          label: '🧠 About Semantic Chunking',
        }
      );
    }

    // Always provide help option
    if (result.metadata?.command !== 'help') {
      followups.push({
        prompt: 'What can DocPilot do?',
        label: '❓ Help & Commands',
      });
    }

    return followups;
  }
}
