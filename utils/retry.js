// utils/retry.js
// Utility functions for retry logic with exponential backoff

import { delay } from './delay.js';

/**
 * Execute a function with retry logic and exponential backoff
 * @param {Function} fn - The function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {Function} options.shouldRetry - Function to determine if error should trigger retry
 * @returns {Promise} Result of the function or throws final error
 */
export async function withRetry(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 30000,
        backoffMultiplier = 2,
        shouldRetry = defaultShouldRetry
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Check if we should retry this error
            if (!shouldRetry(error, attempt)) {
                break;
            }
            
            // Calculate delay with exponential backoff
            const delayMs = Math.min(
                initialDelay * Math.pow(backoffMultiplier, attempt),
                maxDelay
            );
            
            console.log(`⏳ Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms delay (error: ${error.message})`);
            await delay(delayMs);
        }
    }
    
    throw lastError;
}

/**
 * Default function to determine if an error should trigger a retry
 * @param {Error} error - The error that occurred
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {boolean} True if should retry
 */
function defaultShouldRetry(error) {
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
    const isNetworkError = retryableErrors.some(errCode => 
        error.code === errCode || message.includes(errCode.toLowerCase())
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
 * @param {Function} apiFn - Function that returns a fetch Response
 * @param {Object} options - Retry options (same as withRetry)
 * @returns {Promise} API response or throws error
 */
export async function withApiRetry(apiFn, options = {}) {
    return await withRetry(async () => {
        const response = await apiFn();
        
        // Handle rate limiting specifically
        if (response.status === 429) {
            // Check for Retry-After header
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
                const retryDelay = parseInt(retryAfter) * 1000; // Convert to ms
                console.log(`📡 Rate limited, waiting ${retryDelay}ms as requested by server`);
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
        ...options,
        shouldRetry: (error, attempt) => {
            // Custom retry logic for API calls
            const message = error.message.toLowerCase();
            
            // Always retry rate limiting and server errors
            if (message.includes('rate limited') || message.includes('server error')) {
                return true;
            }
            
            // Use default retry logic for other errors
            return defaultShouldRetry(error, attempt);
        }
    });
}

/**
 * Create a rate-limited function that automatically handles retries
 * @param {Function} fn - The function to wrap
 * @param {number} minInterval - Minimum interval between calls in ms
 * @param {Object} retryOptions - Retry options
 * @returns {Function} Rate-limited function
 */
export function createRateLimitedFunction(fn, minInterval = 1000, retryOptions = {}) {
    let lastCall = 0;
    
    return async function(...args) {
        const now = Date.now();
        const timeSinceLastCall = now - lastCall;
        
        if (timeSinceLastCall < minInterval) {
            const waitTime = minInterval - timeSinceLastCall;
            console.log(`⏱️  Rate limiting: waiting ${waitTime}ms`);
            await delay(waitTime);
        }
        
        lastCall = Date.now();
        
        return await withRetry(() => fn.apply(this, args), retryOptions);
    };
}
