import * as vscode from 'vscode';

export class Logger {
  private static instance: Logger;
  private readonly channel: vscode.OutputChannel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel('DocPilot');
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  info(message: string, data?: unknown): void {
    const entry = `[INFO] ${new Date().toISOString()}: ${message}`;
    this.channel.appendLine(entry);
    if (data) {
      this.channel.appendLine(JSON.stringify(data, null, 2));
    }
    console.log(entry, data);
  }

  warn(message: string, data?: unknown): void {
    const entry = `[WARN] ${new Date().toISOString()}: ${message}`;
    this.channel.appendLine(entry);
    if (data) {
      this.channel.appendLine(JSON.stringify(data, null, 2));
    }
    console.warn(entry, data);
  }

  error(message: string, error?: Error | unknown): void {
    const entry = `[ERROR] ${new Date().toISOString()}: ${message}`;
    this.channel.appendLine(entry);

    if (error instanceof Error) {
      this.channel.appendLine(`Error: ${error.message}`);
      this.channel.appendLine(`Stack: ${error.stack}`);
      console.error(entry, error);
    } else if (error) {
      this.channel.appendLine(`Data: ${JSON.stringify(error, null, 2)}`);
      console.error(entry, error);
    }
  }

  debug(message: string, data?: unknown): void {
    const entry = `[DEBUG] ${new Date().toISOString()}: ${message}`;
    this.channel.appendLine(entry);
    if (data) {
      this.channel.appendLine(JSON.stringify(data, null, 2));
    }
    console.debug(entry, data);
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}
