/**
 * utils/retry.ts
 * 
 * Retry utilities for API calls and database operations
 * Ported from original Node.js utils/retry.js to Deno/TypeScript
 */

// Edge Functions runtime globals
declare const Deno: {
    env: {
        get(key: string): string | undefined;
    };
};

/**
 * Retry configuration interface
 */
interface RetryConfig {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    retryCondition?: (error: Error) => boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    retryCondition: (error: Error) => true
};

/**
 * Execute a function with exponential backoff retry logic
 * @param fn - Function to execute
 * @param config - Retry configuration
 */
export async function withApiRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig = {}
): Promise<T> {
    const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: Error;
    
    for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            
            // Check if we should retry based on the error
            if (!finalConfig.retryCondition(lastError)) {
                throw lastError;
            }
            
            // If this was the last attempt, throw the error
            if (attempt === finalConfig.maxRetries) {
                break;
            }
            
            // Calculate delay with exponential backoff
            const delay = Math.min(
                finalConfig.baseDelay * Math.pow(finalConfig.backoffFactor, attempt - 1),
                finalConfig.maxDelay
            );
            
            console.warn(
                `API call failed (attempt ${attempt}/${finalConfig.maxRetries}), retrying in ${delay}ms:`,
                lastError.message
            );
            
            await sleep(delay);
        }
    }
    
    throw lastError!;
}

/**
 * Retry configuration specifically for HTTP requests
 */
export async function withHttpRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig & { retryOnStatus?: number[] } = {}
): Promise<T> {
    const retryOnStatus = config.retryOnStatus || [429, 500, 502, 503, 504];
    
    return withApiRetry(fn, {
        ...config,
        retryCondition: (error: Error) => {
            // Check if it's a fetch error with status code
            if ('status' in error && typeof error.status === 'number') {
                return retryOnStatus.includes(error.status);
            }
            
            // Check error message for common retryable issues
            const message = error.message.toLowerCase();
            const retryableMessages = [
                'timeout',
                'network error',
                'connection',
                'enotfound',
                'econnreset',
                'rate limit'
            ];
            
            return retryableMessages.some(msg => message.includes(msg));
        }
    });
}

/**
 * Retry specifically for SoundCloud API calls (handles rate limiting)
 */
export async function withSoundCloudRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withHttpRetry(fn, {
        maxRetries: 5,
        baseDelay: 2000,
        maxDelay: 60000,
        backoffFactor: 2,
        retryOnStatus: [429, 500, 502, 503, 504]
    });
}

/**
 * Retry specifically for OpenAI API calls
 */
export async function withOpenAIRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withHttpRetry(fn, {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        retryOnStatus: [429, 500, 502, 503, 504]
    });
}

/**
 * Retry specifically for Last.fm API calls
 */
export async function withLastFmRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withHttpRetry(fn, {
        maxRetries: 3,
        baseDelay: 500,
        maxDelay: 5000,
        backoffFactor: 2,
        retryOnStatus: [429, 500, 502, 503, 504]
    });
}

/**
 * Retry for database operations (Supabase)
 */
export async function withDatabaseRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withApiRetry(fn, {
        maxRetries: 3,
        baseDelay: 500,
        maxDelay: 5000,
        backoffFactor: 1.5,
        retryCondition: (error: Error) => {
            const message = error.message.toLowerCase();
            
            // Retry on connection issues and temporary errors
            const retryableMessages = [
                'connection',
                'timeout',
                'temporary',
                'rate limit',
                'service unavailable',
                'internal server error'
            ];
            
            return retryableMessages.some(msg => message.includes(msg));
        }
    });
}

/**
 * Utility function for async sleep/delay
 */
export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute multiple async functions with a delay between them
 * Useful for rate-limited APIs
 */
export async function executeWithDelay<T>(
    functions: Array<() => Promise<T>>,
    delay: number
): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < functions.length; i++) {
        const result = await functions[i]();
        results.push(result);
        
        // Add delay between calls (except after the last one)
        if (i < functions.length - 1) {
            await sleep(delay);
        }
    }
    
    return results;
}

/**
 * Batch process items with retry and rate limiting
 * @param items - Items to process
 * @param processFn - Function to process each item  
 * @param batchSize - Number of items to process concurrently
 * @param delayBetweenBatches - Delay between batches in ms
 */
export async function batchProcessWithRetry<T, R>(
    items: T[],
    processFn: (item: T) => Promise<R>,
    batchSize: number = 5,
    delayBetweenBatches: number = 1000
): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        
        const batchPromises = batch.map(item => 
            withApiRetry(() => processFn(item))
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Add delay between batches to avoid rate limiting
        if (i + batchSize < items.length) {
            await sleep(delayBetweenBatches);
        }
    }
    
    return results;
}
