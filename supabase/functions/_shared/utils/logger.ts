// Logger structuré pour les Edge Functions Supabase
// Adaptation du logger JavaScript local avec support console et persistance

import { LogEntry } from '../types/index.ts';

class Logger {
  private context: Record<string, any> = {};

  constructor(context?: Record<string, any>) {
    this.context = context || {};
  }

  private createLogEntry(level: LogEntry['level'], message: string, data?: any, error?: Error): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.context, ...data }
    };

    if (error) {
      entry.error = error;
    }

    return entry;
  }

  private formatConsoleOutput(entry: LogEntry): string {
    const timestamp = entry.timestamp.substring(11, 19); // Extract HH:mm:ss
    const level = entry.level.toUpperCase().padEnd(5);
    const context = entry.context && Object.keys(entry.context).length > 0 
      ? ` | ${JSON.stringify(entry.context)}` 
      : '';
    const error = entry.error ? ` | ERROR: ${entry.error.message}` : '';
    
    return `[${timestamp}] ${level} | ${entry.message}${context}${error}`;
  }

  debug(message: string, data?: any): void {
    const entry = this.createLogEntry('debug', message, data);
    console.log(this.formatConsoleOutput(entry));
  }

  info(message: string, data?: any): void {
    const entry = this.createLogEntry('info', message, data);
    console.info(this.formatConsoleOutput(entry));
  }

  warn(message: string, data?: any): void {
    const entry = this.createLogEntry('warn', message, data);
    console.warn(this.formatConsoleOutput(entry));
  }

  error(message: string, error?: Error | any, data?: any): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const entry = this.createLogEntry('error', message, data, errorObj);
    console.error(this.formatConsoleOutput(entry));
  }

  // Méthodes spécifiques pour le tracking des performances
  startTimer(label: string): () => number {
    const startTime = Date.now();
    this.debug(`Timer started: ${label}`);
    
    return () => {
      const duration = Date.now() - startTime;
      this.info(`Timer completed: ${label}`, { duration_ms: duration });
      return duration;
    };
  }

  // Helper pour logger les réponses API
  logApiCall(service: string, endpoint: string, method: string, status: number, duration: number, error?: Error): void {
    const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info';
    const message = `${service} API call: ${method} ${endpoint}`;
    
    this.createLogEntry(level, message, {
      service,
      endpoint,
      method,
      status,
      duration_ms: duration
    });

    if (level === 'error') {
      console.error(this.formatConsoleOutput(this.createLogEntry('error', message, {
        service, endpoint, method, status, duration_ms: duration
      }, error)));
    } else if (level === 'warn') {
      console.warn(this.formatConsoleOutput(this.createLogEntry('warn', message, {
        service, endpoint, method, status, duration_ms: duration
      })));
    } else {
      console.info(this.formatConsoleOutput(this.createLogEntry('info', message, {
        service, endpoint, method, status, duration_ms: duration
      })));
    }
  }

  // Helper pour logger l'enrichissement des artistes
  logEnrichment(artistName: string, source: string, success: boolean, score?: number, error?: Error): void {
    const message = `Artist enrichment: ${artistName} from ${source}`;
    const data = { artist: artistName, source, success, score };
    
    if (success) {
      this.info(message, data);
    } else {
      this.error(message, error, data);
    }
  }

  // Helper pour logger les opérations de base de données
  logDbOperation(operation: string, table: string, success: boolean, recordsAffected?: number, error?: Error): void {
    const message = `DB ${operation}: ${table}`;
    const data = { operation, table, success, records_affected: recordsAffected };
    
    if (success) {
      this.info(message, data);
    } else {
      this.error(message, error, data);
    }
  }

  // Créer un sous-logger avec contexte additionnel
  withContext(additionalContext: Record<string, any>): Logger {
    return new Logger({ ...this.context, ...additionalContext });
  }

  // Helper pour les structures de log compatibles Supabase
  logEdgeFunctionStart(functionName: string, action?: string, requestId?: string): void {
    this.info(`Edge Function started: ${functionName}`, {
      function: functionName,
      action,
      request_id: requestId,
      timestamp: new Date().toISOString()
    });
  }

  logEdgeFunctionEnd(functionName: string, success: boolean, duration: number, action?: string, requestId?: string): void {
    const level = success ? 'info' : 'error';
    const message = `Edge Function completed: ${functionName}`;
    const data = {
      function: functionName,
      action,
      request_id: requestId,
      success,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    };

    if (success) {
      this.info(message, data);
    } else {
      this.error(message, undefined, data);
    }
  }
}

// Export d'une instance par défaut
export const logger = new Logger();

// Export de la classe pour créer des loggers avec contexte
export { Logger };

// Helpers pour créer des loggers spécifiques
export const createLogger = (context: Record<string, any>) => new Logger(context);

export const createEdgeFunctionLogger = (functionName: string, action?: string) => 
  new Logger({ function: functionName, action });

export default logger;
