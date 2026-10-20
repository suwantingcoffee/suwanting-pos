export function createUserHandler({ createClient, url, publicKey, serviceKey, allowedOrigins }) {
    return async request => {
        const origin = request.headers.get('Origin');
        const cors = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Vary': 'Origin' };
        if (origin && allowedOrigins.includes(origin)) cors['Access-Control-Allow-Origin'] = origin;
        const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        if (origin && !allowedOrigins.includes(origin)) return reply(403, { error: 'Origin tidak diizinkan.' });
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'POST') return reply(405, { error: 'Gunakan POST.' });
        if (!url || !publicKey || !serviceKey) return reply(503, { error: 'Konfigurasi server belum lengkap.' });
        const authorization = request.headers.get('Authorization') || '';
        if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Login diperlukan.' });
        const caller = createClient(url, publicKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
        let createdId = null;
        let admin;
        try {
            const { data: auth, error: authError } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
            if (authError || !auth.user) return reply(401, { error: 'Sesi tidak valid.' });
            const { data: bootstrap, error: accessError } = await caller.rpc('scpos_bootstrap');
            if (accessError || bootstrap?.profile?.role !== 'owner' || !bootstrap.profile.is_active) return reply(403, { error: 'Hanya owner aktif boleh membuat pengguna.' });
            if (Number(request.headers.get('Content-Length') || 0) > 8192) return reply(413, { error: 'Data terlalu besar.' });
            const raw = await request.text();
            if (raw.length > 8192) return reply(413, { error: 'Data terlalu besar.' });
            let data;
            try { data = JSON.parse(raw); } catch { return reply(400, { error: 'JSON tidak valid.' }); }
            if (!data || Array.isArray(data) || typeof data !== 'object') return reply(422, { error: 'Data pengguna tidak valid.' });
            const updating = data.operation === 'update';
            const keys = ['name', 'email', 'password', 'role', 'is_active', 'can_manage_catalog', 'can_discount', 'operation', 'id'];
            const validOperation = updating ? typeof data.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id) : !data.id && (!data.operation || data.operation === 'create');
            const validPassword = typeof data.password === 'string' && ((updating && data.password === '') || data.password.length >= 10 && data.password.length <= 128);
            if (Object.keys(data).some(key => !keys.includes(key)) || !validOperation || !validPassword || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || typeof data.email !== 'string' || data.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || !['owner', 'admin', 'cashier'].includes(data.role) || ['is_active', 'can_manage_catalog', 'can_discount'].some(key => typeof data[key] !== 'boolean')) return reply(422, { error: 'Periksa nama, email, password minimal 10 karakter, role, dan izin pengguna.' });
            admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
            if (updating) {
                const { data: target, error: targetError } = await admin.auth.admin.getUserById(data.id);
                if (targetError || !target.user) return reply(404, { error: 'Akun pengguna tidak ditemukan.' });
                const { data: profile, error: saveError } = await caller.rpc('scpos_save', { p_entity: 'profiles', p_data: { id: data.id, name: data.name.trim(), role: data.role, is_active: data.is_active, can_manage_catalog: data.can_manage_catalog, can_discount: data.can_discount } });
                if (saveError) return reply(saveError.code === '42501' ? 403 : 422, { error: 'Izin pengguna gagal disimpan. Periksa status owner dan role akun.' });
                const changes = { email: data.email.trim(), email_confirm: true, ...(data.password ? { password: data.password } : {}) };
                const { error: updateError } = await admin.auth.admin.updateUserById(data.id, changes);
                if (updateError) return reply(502, { error: 'Izin pengguna tersimpan, tetapi email/password gagal diperbarui. Periksa duplikasi email atau kebijakan password Supabase, lalu ulangi.' });
                return reply(200, { profile });
            }
            const { data: created, error: createError } = await admin.auth.admin.createUser({ email: data.email.trim(), password: data.password, email_confirm: true, user_metadata: { name: data.name.trim() } });
            if (createError || !created.user) return reply(422, { error: 'Akun gagal dibuat. Periksa email, duplikasi akun, atau kebijakan password Supabase.' });
            createdId = created.user.id;
            const { data: profile, error: saveError } = await caller.rpc('scpos_save', { p_entity: 'profiles', p_data: { id: createdId, name: data.name.trim(), role: data.role, is_active: data.is_active, can_manage_catalog: data.can_manage_catalog, can_discount: data.can_discount } });
            if (saveError) throw saveError;
            return reply(201, { profile });
        } catch {
            if (createdId) {
                try {
                    const { error } = await admin.auth.admin.deleteUser(createdId);
                    if (error) return reply(502, { error: 'Penyimpanan izin gagal. Akun mungkin sudah dibuat; periksa Authentication dan Pengguna sebelum mengulang.' });
                } catch { return reply(502, { error: 'Penyimpanan izin gagal. Periksa Authentication dan Pengguna sebelum mengulang.' }); }
            }
            return reply(500, { error: 'Pembuatan pengguna gagal. Tidak ada password yang dicatat.' });
        }
    };
}
