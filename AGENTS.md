# Suwanting Coffee POS

Static Vite 8, Alpine.js 3, Tailwind CSS 4 application deployed to GitHub Pages. Supabase Auth, PostgreSQL RPC and private Storage provide the backend. PHP, Laravel and Composer are not used. Original Laravel implementation is preserved in Git branch `backup/laravel-20261020`.

- Keep Poppins, #F28500, existing component classes, responsive layout and dark mode.
- Frontend lives in `resources/js`, `resources/css`, `resources/views/static`. Use hash routes for project subpaths.
- Never trust client prices, totals, stock, role claims or owner metadata. Enforce validation and current active-profile permissions in database RPC.
- Keep schema `suwanting_pos` private with RLS and no direct browser table grants. Only explicitly granted `public.scpos_*` RPC may access it.
- Checkout and stock mutations must remain atomic and idempotent. Preserve immutable retry payloads on unknown network failures; lock ingredients in stable ID order. Never replace historical price/recipe snapshots with current catalog values.
- Use `x-text` for user text; receipt templates are plain text. Never interpolate untrusted HTML.
- Public Supabase URL and publishable/anon key may be bundled. Service keys and passwords belong only in server-side Supabase environment, never `VITE_*`, logs or Git.
- Do not modify existing unrelated Supabase schemas or operational data. Database tests use isolated databases ending `_test`.
- Read relevant local Tailwind/testing skills when changing those areas; PHP-specific guidance applies only to archived PHP work.
- Run meaningful tests: `npm test`, `npm run build`, `npm run test:browser`. Browser harness uses real PostgreSQL RPC with an Auth HTTP test double; report hosted verification separately.
- Update existing README for changed setup or limitations. Keep changes scoped; do not create extra documentation without request.
