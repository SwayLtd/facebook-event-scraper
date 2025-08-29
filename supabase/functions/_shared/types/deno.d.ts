/// <reference types="https://deno.land/x/types/index.d.ts" />

// Global Deno types pour Edge Functions
declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

export {};
