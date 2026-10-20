import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createUserHandler } from '../_shared/create-user.js';

Deno.serve(createUserHandler({
    createClient,
    url: Deno.env.get('SUPABASE_URL'),
    publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') || 'https://suwantingcoffee.github.io,http://127.0.0.1:5173,http://localhost:5173').split(',').map(value => value.trim()),
}));
