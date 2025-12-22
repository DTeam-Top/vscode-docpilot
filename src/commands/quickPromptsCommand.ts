import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { configuration } from '../utils/configuration';
import { isTestEnvironment } from '../utils/commandUtils';

interface CustomPrompt {
  name: string;
  prompt: string;
}

export class QuickPromptsCommand {
  private static readonly logger = Logger.getInstance();

  constructor(private readonly extensionContext: vscode.ExtensionContext) {}

  /**
   * Register the quick prompts command
   */
  static register(extensionContext: vscode.ExtensionContext): vscode.Disposable {
    const command = new QuickPromptsCommand(extensionContext);

    return vscode.commands.registerCommand('docpilot.quickPrompts', async () => {
      await command.execute();
    });
  }

  /**
   * Execute the quick prompts command
   */
  async execute(): Promise<void> {
    try {
      // Get the active editor and selected text
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor found. Please select some text first.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected. Please select some text to process.');
        return;
      }

      const selectedText = editor.document.getText(selection);
      if (!selectedText.trim()) {
        vscode.window.showWarningMessage(
          'Selected text is empty. Please select some text to process.'
        );
        return;
      }

      // Get configured prompts
      const prompts = configuration.quickPrompts;
      if (prompts.length === 0) {
        vscode.window.showInformationMessage(
          'No custom prompts configured. Add prompts in Settings > DocPilot > Quick Prompts.'
        );
        return;
      }

      // Show QuickPick with dynamic prompts
      const selectedPrompt = await this.showPromptPicker(prompts);
      if (!selectedPrompt) {
        return; // User cancelled
      }

      QuickPromptsCommand.logger.info(`Executing custom prompt: ${selectedPrompt.name}`, {
        promptName: selectedPrompt.name,
        selectedTextLength: selectedText.length,
      });

      // Send to chat participant (same approach as summary)
      await this.sendToChatParticipant(selectedPrompt, selectedText);
    } catch (error) {
      QuickPromptsCommand.logger.error('Error executing quick prompts command', error);
      vscode.window.showErrorMessage(
        `Failed to execute custom prompt: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Show the prompt picker with dynamic list
   */
  private async showPromptPicker(prompts: CustomPrompt[]): Promise<CustomPrompt | undefined> {
    const quickPickItems = prompts.map((prompt) => ({
      label: `$(symbol-string) ${prompt.name}`,
      description:
        prompt.prompt.length > 50 ? `${prompt.prompt.substring(0, 50)}...` : prompt.prompt,
      detail: `Process selected text with custom prompt`,
      prompt: prompt,
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: 'Select a custom prompt to apply to the selected text',
      title: 'DocPilot Quick Prompts',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    return selected?.prompt;
  }

  /**
   * Send processed prompt directly to Copilot Chat (same as normal chat)
   */
  private async sendToChatParticipant(prompt: CustomPrompt, selectedText: string): Promise<void> {
    try {
      // Process the prompt template by replacing {selectedText} with actual text
      const processedPrompt = prompt.prompt.replace('{selectedText}', selectedText);

      // In test environment, just show success message instead of opening chat
      if (isTestEnvironment()) {
        QuickPromptsCommand.logger.info('Test mode: Skipping chat commands', {
          promptName: prompt.name,
          processedPrompt,
        });

        vscode.window.showInformationMessage(
          `Test Mode: Quick prompt "${prompt.name}" executed successfully`
        );
        return;
      }

      // Open/focus Copilot Chat panel first
      await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');

      // Send the processed prompt directly to Copilot Chat (not through @docpilot)
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: processedPrompt,
      });

      QuickPromptsCommand.logger.info('Processed custom prompt sent to chat', {
        promptName: prompt.name,
        selectedTextLength: selectedText.length,
        processedPromptLength: processedPrompt.length,
      });
    } catch (error) {
      QuickPromptsCommand.logger.error('Error sending to Copilot Chat', error);

      // Fallback: Show error message
      vscode.window.showErrorMessage(
        `Failed to send to Copilot Chat. Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
