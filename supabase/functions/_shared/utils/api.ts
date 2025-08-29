// API utilities pour Edge Functions
// Utilitaires génériques pour les appels API

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { logger } from './logger.ts';
import { withApiRetry } from './retry.ts';
import { tokenManager } from './token.ts';
import { API_ENDPOINTS, TIMEOUTS } from './constants.ts';

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | FormData | URLSearchParams;
  timeout?: number;
  requiresAuth?: boolean;
  authToken?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
  headers?: Headers;
}

/**
 * Generic API call wrapper with error handling and retries
 * @param url - API endpoint URL
 * @param options - Request options
 * @returns Promise with API response
 */
export async function makeApiCall<T = any>(url: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 5000,
    requiresAuth = false,
    authToken
  } = options;

  const timer = logger.startTimer('api_call');
  
  try {
    // Add default headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'FacebookEventScrapperEdgeFunction/1.0',
      ...headers
    };

    // Add authentication if required
    if (requiresAuth && authToken) {
      requestHeaders['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await withApiRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        return await fetch(url, {
          method,
          headers: requestHeaders,
          body,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
    });

    const duration = timer();
    const urlObj = new URL(url);
    
    logger.logApiCall(
      urlObj.hostname, 
      urlObj.pathname, 
      method, 
      response.status, 
      duration
    );

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
        headers: response.headers
      };
    }

    // Handle different response types
    const contentType = response.headers.get('content-type') || '';
    let data: T;
    
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else if (contentType.includes('text/')) {
      data = await response.text() as T;
    } else {
      data = await response.blob() as T;
    }

    return {
      success: true,
      data,
      status: response.status,
      headers: response.headers
    };

  } catch (error) {
    const duration = timer();
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error(`API call failed: ${method} ${url}`, error, {
      duration_ms: duration,
      url,
      method
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * SoundCloud API call wrapper
 * @param endpoint - SoundCloud API endpoint (without base URL)
 * @param options - Request options
 * @returns Promise with API response
 */
export async function soundCloudApi<T = any>(endpoint: string, options: Omit<ApiRequestOptions, 'requiresAuth' | 'authToken'> = {}): Promise<ApiResponse<T>> {
  const token = await tokenManager.getSoundCloudToken();
  if (!token) {
    return {
      success: false,
      error: 'SoundCloud access token not available'
    };
  }

  const url = `${API_ENDPOINTS.SOUNDCLOUD_BASE}${endpoint}`;
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  return makeApiCall<T>(url, {
    ...options,
    headers: authHeaders,
    timeout: TIMEOUTS.SOUNDCLOUD_MS
  });
}

/**
 * MusicBrainz API call wrapper
 * @param endpoint - MusicBrainz API endpoint (without base URL)
 * @param options - Request options
 * @returns Promise with API response
 */
export async function musicBrainzApi<T = any>(endpoint: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const url = `${API_ENDPOINTS.MUSICBRAINZ_BASE}${endpoint}`;
  
  return makeApiCall<T>(url, {
    ...options,
    headers: {
      'User-Agent': 'FacebookEventScrapperEdgeFunction/1.0 (contact@sway-app.com)',
      ...options.headers
    },
    timeout: TIMEOUTS.MUSICBRAINZ_MS
  });
}

/**
 * Last.fm API call wrapper
 * @param endpoint - Last.fm API endpoint (without base URL)
 * @param params - API parameters
 * @param options - Request options
 * @returns Promise with API response
 */
export async function lastFmApi<T = any>(endpoint: string, params: Record<string, string> = {}, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const apiKey = await tokenManager.getLastFmApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'Last.fm API key not available'
    };
  }

  const searchParams = new URLSearchParams({
    api_key: apiKey,
    format: 'json',
    ...params
  });

  const url = `${API_ENDPOINTS.LASTFM_BASE}${endpoint}?${searchParams}`;
  
  return makeApiCall<T>(url, {
    ...options,
    timeout: TIMEOUTS.LASTFM_MS
  });
}

/**
 * Facebook Graph API call wrapper
 * @param endpoint - Facebook Graph API endpoint (without base URL)
 * @param options - Request options
 * @returns Promise with API response
 */
export async function facebookApi<T = any>(endpoint: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const token = await tokenManager.getFacebookToken();
  if (!token) {
    return {
      success: false,
      error: 'Facebook access token not available'
    };
  }

  const url = `${API_ENDPOINTS.FACEBOOK_GRAPH}${endpoint}`;
  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  return makeApiCall<T>(url, {
    ...options,
    headers: authHeaders,
    timeout: TIMEOUTS.FACEBOOK_MS
  });
}

/**
 * OpenAI API call wrapper
 * @param endpoint - OpenAI API endpoint (without base URL)
 * @param options - Request options
 * @returns Promise with API response
 */
export async function openAiApi<T = any>(endpoint: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const apiKey = await tokenManager.getOpenAiApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'OpenAI API key not available'
    };
  }

  const url = `${API_ENDPOINTS.OPENAI_BASE}${endpoint}`;
  const authHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    ...options.headers
  };

  return makeApiCall<T>(url, {
    ...options,
    headers: authHeaders,
    timeout: TIMEOUTS.OPENAI_MS
  });
}

/**
 * Google Places API call wrapper
 * @param endpoint - Google Places API endpoint (without base URL)
 * @param params - API parameters
 * @param options - Request options
 * @returns Promise with API response
 */
export async function googlePlacesApi<T = any>(endpoint: string, params: Record<string, string> = {}, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
  const apiKey = await tokenManager.getGooglePlacesApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: 'Google Places API key not available'
    };
  }

  const searchParams = new URLSearchParams({
    key: apiKey,
    ...params
  });

  const url = `${API_ENDPOINTS.GOOGLE_PLACES}${endpoint}?${searchParams}`;
  
  return makeApiCall<T>(url, {
    ...options,
    timeout: TIMEOUTS.GOOGLE_MS
  });
}

export default {
  makeApiCall,
  soundCloudApi,
  musicBrainzApi,
  lastFmApi,
  facebookApi,
  openAiApi,
  googlePlacesApi
};
