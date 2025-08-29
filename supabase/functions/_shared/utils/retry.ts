// Retry utilities avec exponential backoff pour Edge Functions
// Adaptation complète du système de retry JavaScript local

import { delay } from './delay.ts';
import { logger } from './logger.ts';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

export interface ApiRetryOptions extends RetryOptions {
  onAuthFailure?: () => Promise<void>;
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param fn - The function to retry
 * @param options - Retry options
 * @returns Result of the function or throws final error
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = defaultShouldRetry
  } = options;

  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }
      
      // Check if we should retry this error
      if (!shouldRetry(lastError, attempt)) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delayMs = Math.min(
        initialDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );
      
      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms delay`, {
        attempt: attempt + 1,
        maxRetries,
        delay_ms: delayMs,
        error: lastError.message
      });
      
      await delay(delayMs);
    }
  }
  
  throw lastError || new Error('Retry failed without specific error');
}

/**
 * Default function to determine if an error should trigger a retry
 * @param error - The error that occurred
 * @param attempt - Current attempt number (0-based)
 * @returns True if should retry
 */
function defaultShouldRetry(error: Error): boolean {
  // Retry on network errors, timeouts, and rate limiting
  const retryableErrors = [
    'ENOTFOUND',
    'ECONNRESET', 
    'ETIMEDOUT',
    'ECONNREFUSED',
    'NETWORK_ERROR'
  ];
  
  // Check error message for common patterns
  const message = error.message.toLowerCase();
  const errorCode = (error as any).code;
  
  const isNetworkError = retryableErrors.some(errCode => 
    errorCode === errCode || message.includes(errCode.toLowerCase())
  );
  
  // Check for rate limiting (HTTP 429 or related messages)
  const isRateLimited = message.includes('429') || 
                        message.includes('rate limit') || 
                        message.includes('too many requests');
  
  // Check for temporary server errors (5xx)
  const isServerError = message.includes('500') || 
                        message.includes('502') || 
                        message.includes('503') || 
                        message.includes('504');
  
  return isNetworkError || isRateLimited || isServerError;
}

/**
 * Retry wrapper specifically for API calls with response status handling
 * @param apiFn - Function that returns a fetch Response
 * @param options - Retry options with auth failure handler
 * @returns API response or throws error
 */
export async function withApiRetry(
  apiFn: () => Promise<Response>, 
  options: ApiRetryOptions = {}
): Promise<Response> {
  const { onAuthFailure, ...retryOptions } = options;
  
  return await withRetry(async () => {
    const response = await apiFn();
    
    // Handle authentication failures (401)
    if (response.status === 401 && onAuthFailure) {
      logger.warn('Authentication failed (401), attempting token refresh');
      await onAuthFailure();
      throw new Error(`Authentication failed (401): ${response.statusText} - Token refreshed, retrying`);
    }
    
    // Handle rate limiting specifically
    if (response.status === 429) {
      // Check for Retry-After header
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const retryDelay = parseInt(retryAfter) * 1000; // Convert to ms
        logger.info(`Rate limited, waiting ${retryDelay}ms as requested by server`);
        await delay(retryDelay);
      }
      throw new Error(`Rate limited (429): ${response.statusText}`);
    }
    
    // Handle server errors
    if (response.status >= 500) {
      throw new Error(`Server error (${response.status}): ${response.statusText}`);
    }
    
    return response;
  }, {
    ...retryOptions,
    shouldRetry: (error: Error, attempt: number) => {
      const message = error.message.toLowerCase();
      
      // Always retry auth failures (with token refresh), rate limiting and server errors
      if (message.includes('authentication failed') || 
          message.includes('rate limited') || 
          message.includes('server error')) {
        return true;
      }
      
      // Use default retry logic for other errors
      return defaultShouldRetry(error);
    }
  });
}

/**
 * Create a rate-limited function that automatically handles retries
 * @param fn - The function to wrap
 * @param minInterval - Minimum interval between calls in ms
 * @param retryOptions - Retry options
 * @returns Rate-limited function
 */
export function createRateLimitedFunction<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  minInterval = 1000,
  retryOptions: RetryOptions = {}
): (...args: TArgs) => Promise<TReturn> {
  let lastCall = 0;
  
  return async function(...args: TArgs): Promise<TReturn> {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall < minInterval) {
      const waitTime = minInterval - timeSinceLastCall;
      logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await delay(waitTime);
    }
    
    lastCall = Date.now();
    
    return await withRetry(() => fn(...args), retryOptions);
  };
}

// Helper pour créer des fonctions avec retry spécifiques aux différentes APIs
export const createSoundCloudApiCall = <T>(fn: () => Promise<T>) =>
  () => withRetry(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  });

export const createMusicBrainzApiCall = <T>(fn: () => Promise<T>) =>
  createRateLimitedFunction(fn, 1000, {
    maxRetries: 2,
    initialDelay: 2000,
    maxDelay: 8000
  });

export const createLastFmApiCall = <T>(fn: () => Promise<T>) =>
  createRateLimitedFunction(fn, 200, {
    maxRetries: 3,
    initialDelay: 500,
    maxDelay: 5000
  });

export default withRetry;
