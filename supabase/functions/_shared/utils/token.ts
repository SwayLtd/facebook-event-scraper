// Token management utilities pour Edge Functions  
// Adaptation du système de token JavaScript local avec stockage Supabase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { logger } from './logger.ts';
import { withRetry, withApiRetry } from './retry.ts';
import { TokenConfig } from '../types/index.ts';

// Interface pour les tokens stockés
interface StoredToken {
  token: string;
  expiration: number;
  type: 'soundcloud' | 'facebook' | 'lastfm';
  created_at: string;
}

class TokenManager {
  private tokens: Map<string, StoredToken> = new Map();
  
  constructor() {}

  /**
   * Get stored token from memory cache or environment
   * @param tokenType - Type of token to retrieve
   * @returns Token string or null if not found/expired
   */
  private async getStoredToken(tokenType: string): Promise<string | null> {
    // Check memory cache first
    const cached = this.tokens.get(tokenType);
    if (cached && cached.expiration > Date.now()) {
      return cached.token;
    }

    // For Edge Functions, tokens are typically passed as environment variables
    // or stored in Supabase using the database client if needed for persistence
    
    return null;
  }

  /**
   * Store token in memory cache
   * @param tokenType - Type of token
   * @param token - Token value
   * @param expiresIn - Expiration time in seconds
   */
  private async storeToken(tokenType: string, token: string, expiresIn: number): Promise<void> {
    const expiration = Date.now() + expiresIn * 1000;
    
    const storedToken: StoredToken = {
      token,
      expiration,
      type: tokenType as any,
      created_at: new Date().toISOString()
    };

    this.tokens.set(tokenType, storedToken);
    
    logger.info(`Token stored: ${tokenType}`, {
      type: tokenType,
      expires_in_seconds: expiresIn,
      expires_at: new Date(expiration).toISOString()
    });
  }

  /**
   * Get SoundCloud access token (OAuth client credentials flow)
   * @param clientId - SoundCloud client ID
   * @param clientSecret - SoundCloud client secret
   * @returns Access token or null
   */
  async getSoundCloudToken(clientId?: string, clientSecret?: string): Promise<string | null> {
    // Try to get from stored tokens first
    let token = await this.getStoredToken('soundcloud');
    if (token) {
      logger.debug('Using cached SoundCloud token');
      return token;
    }

    // Get credentials from environment if not provided
    const actualClientId = clientId || Deno.env.get('SOUNDCLOUD_CLIENT_ID');
    const actualClientSecret = clientSecret || Deno.env.get('SOUNDCLOUD_CLIENT_SECRET');

    if (!actualClientId || !actualClientSecret) {
      logger.warn('SoundCloud credentials not available');
      return null;
    }

    try {
      logger.info('Requesting new SoundCloud access token');
      
      const response = await withApiRetry(async () => {
        const TOKEN_URL = 'https://api.soundcloud.com/oauth2/token';
        return await fetch(`${TOKEN_URL}?client_id=${actualClientId}&client_secret=${actualClientSecret}&grant_type=client_credentials`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      }, {
        maxRetries: 3,
        initialDelay: 1000
      });

      if (!response.ok) {
        throw new Error(`SoundCloud token request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      token = data.access_token;
      const expiresIn = data.expires_in || 3600;

      if (!token) {
        throw new Error('No access token in SoundCloud response');
      }

      logger.info('SoundCloud access token obtained successfully');
      await this.storeToken('soundcloud', token, expiresIn);
      
      return token;
    } catch (error) {
      logger.error('Error obtaining SoundCloud access token', error);
      return null;
    }
  }

  /**
   * Get Facebook access token from environment
   * @returns Facebook access token or null
   */
  async getFacebookToken(): Promise<string | null> {
    const token = Deno.env.get('FACEBOOK_ACCESS_TOKEN');
    if (!token) {
      logger.warn('Facebook access token not found in environment');
      return null;
    }
    return token;
  }

  /**
   * Get Last.fm API key from environment
   * @returns Last.fm API key or null
   */
  async getLastFmApiKey(): Promise<string | null> {
    const apiKey = Deno.env.get('LASTFM_API_KEY');
    if (!apiKey) {
      logger.warn('Last.fm API key not found in environment');
      return null;
    }
    return apiKey;
  }

  /**
   * Get OpenAI API key from environment
   * @returns OpenAI API key or null
   */
  async getOpenAiApiKey(): Promise<string | null> {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      logger.warn('OpenAI API key not found in environment');
      return null;
    }
    return apiKey;
  }

  /**
   * Get Google Places API key from environment
   * @returns Google Places API key or null
   */
  async getGooglePlacesApiKey(): Promise<string | null> {
    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!apiKey) {
      logger.warn('Google Places API key not found in environment');
      return null;
    }
    return apiKey;
  }

  /**
   * Get all available token configuration
   * @returns Token configuration object
   */
  async getTokenConfig(): Promise<TokenConfig> {
    return {
      soundcloud_client_id: Deno.env.get('SOUNDCLOUD_CLIENT_ID'),
      soundcloud_client_secret: Deno.env.get('SOUNDCLOUD_CLIENT_SECRET'),
      facebook_access_token: await this.getFacebookToken() || undefined,
      lastfm_api_key: await this.getLastFmApiKey() || undefined,
      openai_api_key: await this.getOpenAiApiKey() || undefined,
      google_places_api_key: await this.getGooglePlacesApiKey() || undefined,
      musicbrainz_user_agent: Deno.env.get('MUSICBRAINZ_USER_AGENT') || 'FacebookEventScraper/1.0'
    };
  }

  /**
   * Validate that required tokens are available
   * @param requiredTokens - Array of required token types
   * @returns Validation result with missing tokens
   */
  async validateTokens(requiredTokens: string[]): Promise<{valid: boolean, missing: string[]}> {
    const missing: string[] = [];
    
    for (const tokenType of requiredTokens) {
      let hasToken = false;
      
      switch (tokenType) {
        case 'soundcloud':
          const soundcloudClientId = Deno.env.get('SOUNDCLOUD_CLIENT_ID');
          const soundcloudClientSecret = Deno.env.get('SOUNDCLOUD_CLIENT_SECRET');
          hasToken = !!(soundcloudClientId && soundcloudClientSecret);
          break;
        case 'facebook':
          hasToken = !!(await this.getFacebookToken());
          break;
        case 'lastfm':
          hasToken = !!(await this.getLastFmApiKey());
          break;
        case 'openai':
          hasToken = !!(await this.getOpenAiApiKey());
          break;
        case 'google':
          hasToken = !!(await this.getGooglePlacesApiKey());
          break;
        default:
          hasToken = false;
      }
      
      if (!hasToken) {
        missing.push(tokenType);
      }
    }

    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Clear cached tokens (useful for testing)
   */
  clearCache(): void {
    this.tokens.clear();
    logger.debug('Token cache cleared');
  }

  /**
   * Get cached token info for debugging
   */
  getCacheInfo(): Array<{type: string, hasToken: boolean, expiresAt?: string}> {
    const info: Array<{type: string, hasToken: boolean, expiresAt?: string}> = [];
    for (const [type, token] of this.tokens) {
      info.push({
        type,
        hasToken: true,
        expiresAt: new Date(token.expiration).toISOString()
      });
    }
    return info;
  }
}

// Export singleton instance
export const tokenManager = new TokenManager();

// Export class for testing
export { TokenManager };

// Convenience functions for backward compatibility
export const getAccessToken = (clientId?: string, clientSecret?: string) => 
  tokenManager.getSoundCloudToken(clientId, clientSecret);

export const getSoundCloudToken = () => tokenManager.getSoundCloudToken();
export const getFacebookToken = () => tokenManager.getFacebookToken();
export const getLastFmApiKey = () => tokenManager.getLastFmApiKey();
export const getOpenAiApiKey = () => tokenManager.getOpenAiApiKey();
export const getGooglePlacesApiKey = () => tokenManager.getGooglePlacesApiKey();

export default tokenManager;
