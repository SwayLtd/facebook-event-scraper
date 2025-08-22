/// <reference types="https://deno.land/x/deno@v1.0.0/lib/lib.deno.d.ts" />

// Minimal Deno declarations for Edge Functions
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};
