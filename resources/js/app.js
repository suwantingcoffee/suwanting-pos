import Alpine from 'alpinejs';
import { createIcons, Coffee, Croissant, LayoutDashboard, ShoppingBag, ReceiptText, UserPlus, Package, Tags, Warehouse, ChartNoAxesCombined, Users, History, Settings, LogOut, Menu, SunMoon, Plus, Search, ShoppingBasket, ArrowRight, Printer } from 'lucide';
import '../css/app.css';
import { backend, rpc, uploadPhoto, photoUrls } from './backend.js';
import { getConfig, validateConfig } from './config.js';
import { money, dateTime, today, quantity, cartTotals, csv, routeFromHash, definitiveFailure, decimalUnits } from './domain.js';
import { schemas, navigation, columns } from './schema.js';
import shell from '../views/static/shell.html?raw';
import auth from '../views/static/auth.html?raw';
import dashboard from '../views/static/dashboard.html?raw';
import pos from '../views/static/pos.html?raw';
import table from '../views/static/table.html?raw';
import settings from '../views/static/settings.html?raw';
import transaction from '../views/static/transaction.html?raw';
import reports from '../views/static/reports.html?raw';
import dialogs from '../views/static/dialogs.html?raw';
import receipt from '../views/static/receipt.html?raw';

const clone = value => JSON.parse(JSON.stringify(value));
const icons = { Coffee, Croissant, LayoutDashboard, ShoppingBag, ReceiptText, UserPlus, Package, Tags, Warehouse, ChartNoAxesCombined, Users, History, Settings, LogOut, Menu, SunMoon, Plus, Search, ShoppingBasket, ArrowRight, Printer };
const emptyCart = () => ({ lines: [], customer: '', selectedCustomer: null, discount: '0', received: '', method: 'cash', confirmed: false });
const emptyFilters = () => ({ q: '', status: '', from: '', to: '', ingredient_id: '' });
const defaults = { shop_name: 'Suwanting Coffee', shop_address: '', shop_phone: '', shop_email: '', tax_enabled: false, tax_rate: '11.00', receipt_header: '', receipt_footer: 'Terima kasih. Sampai bertemu kembali.', receipt_paper: '80', receipt_show_cashier: true, receipt_show_customer: true, receipt_show_sku: false, receipt_auto_print: false, simulate_payments: true };
const view = shell.replace('<!-- AUTH -->', auth).replace('<!-- DASHBOARD -->', dashboard).replace('<!-- POS -->', pos).replace('<!-- TABLE -->', table).replace('<!-- SETTINGS -->', settings).replace('<!-- TRANSACTION -->', transaction).replace('<!-- REPORTS -->', reports).replace('<!-- DIALOGS -->', dialogs).replaceAll('<!-- RECEIPT -->', receipt);
document.querySelector('#app').innerHTML = view;

Alpine.data('workspace', () => ({
    screen: 'loading', profile: null, page: 'dashboard', sidebar: false, loading: false, busy: false,
    error: '', notice: '', setupRequired: false, upgradeRequired: false, hasOwner: true, configOpen: false, publicConfig: { url: '', key: '' },
    credentials: { email: '', password: '' }, newPassword: '', setupEmail: '', authMessage: '',
    settings: { ...defaults }, settingsDraft: { ...defaults }, products: [], categories: [], images: {}, options: {},
    dashboard: { weekly: [], methods: [], recent: [] }, report: { products: [], methods: [] },
    table: { rows: [], total: 0, page: 1, per_page: 20 }, filters: emptyFilters(), inventoryTab: 'ingredients',
    editor: null, editorError: '', stockForm: null, stockPending: null, stockError: '',
    sale: null, receiptPreview: false, previewSale: null, connection: null, connectionBusy: false,
    modal: '', confirmation: null, reviewOpen: false, pendingPayload: null, requestVersion: 0,
    ...emptyCart(), search: '', category: 'all', selectedVariants: {}, cartOpen: false,
    customerPicker: false, customerQuery: '', customerResults: [], customersBusy: false, customerError: '', customerVersion: 0,
    money, dateTime, quantity, today, schemas, navigation, columns,

    get allowedNavigation() { return navigation.filter(item => !item.capability || this.can(item.capability)); },
    get title() { return this.page === 'sale' ? 'Detail transaksi' : navigation.find(item => item.page === this.page)?.label || 'Dashboard'; },
    get entity() { return ({ inventory: this.inventoryTab, transactions: 'sales', users: 'profiles' })[this.page] || this.page; },
    get tableColumns() { return columns[this.entity] || []; },
    get editable() { return schemas[this.entity] && this.can(schemas[this.entity].capability); },
    get dated() { return ['sales', 'movements', 'usage', 'audit'].includes(this.entity); },
    get totals() { try { return cartTotals(this.lines, this.discount, this.settings); } catch { return { subtotal: 0, discount: 0, tax: 0, total: 0 }; } },
    get count() { return this.lines.reduce((sum, line) => sum + line.quantity, 0); },
    get cartLocked() { return this.busy || !!this.pendingPayload; },
    get filteredProducts() { const query = this.search.trim().toLocaleLowerCase(); return this.products.filter(product => (this.category === 'all' || String(product.category_id) === String(this.category)) && (product.name + ' ' + product.sku).toLocaleLowerCase().includes(query)); },
    get editorSchema() { return schemas[this.editor?.entity] || { fields: [] }; },
    get receiptSettings() { return this.receiptPreview ? this.settingsDraft : this.settings; },
    get receiptSale() { return this.receiptPreview ? this.previewSale : this.sale; },
    get ownerSql() { return "update suwanting_pos.profiles set role = 'owner', is_active = true where lower(email) = lower('" + this.setupEmail.trim().replaceAll("'", "''") + "');"; },
    get statusOptions() {
        if (this.entity === 'sales') return [{ id: 'paid', name: 'Lunas' }, { id: 'pending', name: 'Menunggu' }];
        if (this.entity === 'movements') return [{ id: 'receipt', name: 'Stok masuk' }, { id: 'adjustment', name: 'Penyesuaian' }, { id: 'consumption', name: 'Pemakaian' }];
        if (!schemas[this.entity] || this.entity === 'units') return [];
        return [{ id: 'active', name: 'Aktif' }, { id: 'inactive', name: 'Nonaktif' }, ...(this.entity === 'ingredients' ? [{ id: 'low', name: 'Stok minimum' }] : [])];
    },
    can(capability) {
        const user = this.profile;
        if (!user) return false;
        if (user.role === 'owner') return true;
        if (capability === 'customers') return user.role === 'admin';
        return user.role === 'admin' && ((capability === 'catalog' && user.can_manage_catalog) || (capability === 'discount' && user.can_discount));
    },
    async init() {
        try { this.publicConfig = getConfig(); } catch (error) { this.error = error.message; this.configOpen = true; this.screen = 'login'; return; }
        window.addEventListener('hashchange', () => this.screen === 'workspace' && this.navigate());
        backend().auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') { this.screen = 'password'; return; }
            if (event === 'SIGNED_OUT') { this.clearSession(); return; }
            if (event === 'SIGNED_IN' && this.screen === 'login' && session) queueMicrotask(() => this.enter());
        });
        await this.connect();
    },
    async connect() {
        this.error = ''; this.setupRequired = false; this.upgradeRequired = false;
        try {
            const status = await rpc('status'); this.hasOwner = status.has_owner;
            if (status.version < 2) { this.upgradeRequired = true; this.screen = 'login'; this.error = 'Pembaruan database tersedia. Jalankan SQL pembaruan di bawah, lalu periksa lagi.'; return; }
            const { data, error } = await backend().auth.getSession();
            if (error) throw error;
            if (new URLSearchParams(location.search).has('recovery') && data.session) { this.screen = 'password'; return; }
            if (data.session) await this.enter(); else this.screen = 'login';
        } catch (error) {
            this.setupRequired = error.code === 'PGRST202' || error.code === '42883';
            this.error = this.setupRequired ? 'Database POS belum disiapkan. Jalankan setup SQL, lalu periksa lagi.' : error.message;
            this.screen = 'login';
        }
    },
    saveConfig() {
        try { const config = validateConfig(this.publicConfig.url, this.publicConfig.key); localStorage.setItem('suwanting-supabase', JSON.stringify(config)); location.reload(); }
        catch (error) { this.error = error.message; }
    },
    async login() {
        if (this.busy) return; this.busy = true; this.error = ''; this.authMessage = '';
        try {
            const { error } = await backend().auth.signInWithPassword(this.credentials);
            if (error) throw error;
            await this.enter();
        } catch (error) { this.error = error.message; }
        finally { this.credentials.password = ''; this.busy = false; }
    },
    async enter() {
        if (this.entering) return;
        this.entering = true;
        try {
            await this.bootstrap(); this.restorePending(); this.screen = 'workspace'; this.error = ''; await this.navigate();
        } catch (error) { this.clearSession(); this.error = error.message; }
        finally { this.entering = false; }
    },
    async bootstrap() {
        const data = await rpc('bootstrap');
        this.profile = data.profile; this.settings = data.settings; this.settingsDraft = clone(data.settings);
        this.categories = data.categories; this.products = data.products;
        try { this.images = await photoUrls(data.products); } catch { this.images = {}; }
    },
    clearSession() {
        this.requestVersion++; this.customerVersion++; this.profile = null; this.screen = 'login'; this.sidebar = false;
        this.products = []; this.categories = []; this.images = {}; this.options = {}; this.table.rows = [];
        this.dashboard = { weekly: [], methods: [], recent: [] }; this.report = { products: [], methods: [] };
        this.sale = null; this.editor = null; this.stockForm = null; this.stockPending = null; this.modal = ''; this.pendingPayload = null;
        this.customerResults = []; this.settings = { ...defaults }; this.settingsDraft = { ...defaults }; Object.assign(this, emptyCart());
    },
    async logout() {
        const { error } = await backend().auth.signOut({ scope: 'local' });
        if (error) { this.error = error.message; return; }
        this.clearSession();
    },
    async resetPassword() {
        if (this.busy) return; this.busy = true; this.error = '';
        try {
            if (!this.credentials.email) throw new Error('Isi email akun terlebih dahulu.');
            const { error } = await backend().auth.resetPasswordForEmail(this.credentials.email, { redirectTo: location.origin + location.pathname + '?recovery=1' });
            if (error) throw error;
            this.authMessage = 'Jika email terdaftar, tautan pemulihan akan dikirim. Periksa kotak masuk dan spam.';
        } catch (error) { this.error = error.message; } finally { this.busy = false; }
    },
    async changePassword() {
        if (this.busy) return; this.busy = true; this.error = '';
        try {
            if (this.newPassword.length < 10) throw new Error('Password minimal 10 karakter.');
            const { error } = await backend().auth.updateUser({ password: this.newPassword }); if (error) throw error;
            this.newPassword = ''; history.replaceState(null, '', location.pathname + location.hash); this.screen = 'login';
            await this.enter(); this.notice = 'Password diperbarui.';
        } catch (error) { this.error = error.message; } finally { this.busy = false; }
    },
    go(page) { if (location.hash === '#/' + page) this.navigate(); else location.hash = '#/' + page; },
    async navigate() {
        const route = routeFromHash(location.hash);
        const item = navigation.find(item => item.page === route.page);
        if (!item && route.page !== 'sale' || item?.capability && !this.can(item.capability)) { this.go('dashboard'); return; }
        this.page = route.page; this.sidebar = false; this.error = ''; this.filters = emptyFilters();
        document.title = this.title + ' · Suwanting Coffee POS';
        document.body.classList.toggle('receipt-mode', this.page === 'sale' && route.query.has('print'));
        await this.loadPage(route.id);
    },
    async loadPage(id = null) {
        const version = ++this.requestVersion; this.loading = true;
        try {
            if (this.page === 'dashboard') { const data = await rpc('dashboard'); if (version === this.requestVersion) this.dashboard = data; }
            else if (this.page === 'sale') { const data = await rpc('sale', { p_id: id || this.sale?.id }); if (version === this.requestVersion) this.sale = data; }
            else if (this.page === 'pos') { await this.bootstrap(); }
            else if (this.page === 'reports') { const data = await rpc('report', { p_filters: { from: this.filters.from, to: this.filters.to } }); if (version === this.requestVersion) this.report = data; }
            else if (this.page === 'settings') { await this.bootstrap(); }
            else {
                if (this.can('catalog')) this.options = await rpc('options');
                await this.loadTable(1, version);
            }
        } catch (error) { if (version === this.requestVersion) this.error = error.message; }
        finally { if (version === this.requestVersion) { this.loading = false; this.$nextTick(() => { if (this.page === 'sale' && routeFromHash(location.hash).query.has('print')) window.print(); }); } }
    },
    async loadTable(page = 1, version = null) {
        version ??= ++this.requestVersion; this.loading = true;
        try {
            const data = await rpc('list', { p_entity: this.entity, p_filters: { ...this.filters, page, per_page: 20 } });
            if (version === this.requestVersion) this.table = data;
        } catch (error) { if (version === this.requestVersion) this.error = error.message; }
        finally { if (version === this.requestVersion) this.loading = false; }
    },
    async inventory(tab) { this.inventoryTab = tab; this.filters = emptyFilters(); await this.loadTable(); },
    cell(row, column) {
        const value = row[column.key];
        if (column.type === 'money') return money(value);
        if (column.type === 'date') return dateTime(value);
        if (column.type === 'quantity' || column.type === 'stock') return quantity(value);
        if (column.type === 'status') return value ? 'Aktif' : 'Nonaktif';
        if (column.type === 'payment') return value === 'paid' ? 'Lunas' : 'Menunggu';
        if (column.type === 'recipe') return value?.map(item => quantity(item.quantity) + ' ' + item.unit_symbol + ' ' + item.ingredient_name).join(', ') || '—';
        return value || '—';
    },
    choices(source) {
        if (source === 'productTypes') return [{ id: 'drink', name: 'Minuman' }, { id: 'beans', name: 'Kopi kemasan' }, { id: 'food', name: 'Makanan' }];
        if (source === 'roles') return ['cashier', 'admin', 'owner'].map(id => ({ id, name: id }));
        if (source === 'recipeVariants') return this.options.products?.find(product => String(product.id) === String(this.editor?.data.product_id))?.variants || [];
        return this.options[source] || [];
    },
    async edit(row = null) {
        this.error = ''; this.editorError = '';
        try {
            if (this.can('catalog')) this.options = await rpc('options');
            const data = {};
            for (const field of schemas[this.entity].fields) data[field.key] = row?.[field.key] ?? field.value ?? '';
            if (row) data.id = row.id;
            if (this.entity === 'products') { data.variants = clone(row?.variants || []); data.photo_path = row?.photo_path || null; }
            if (this.entity === 'recipes') data.items = (row?.items || [{ ingredient_id: '', quantity: '1' }]).map(item => ({ ingredient_id: item.ingredient_id, quantity: String(item.quantity) }));
            this.editor = { entity: this.entity, data, originalEmail: row?.email || '', photo: null, password: '' }; this.modal = 'editor';
            this.$nextTick(() => this.$refs.editorDialog.showModal());
        } catch (error) { this.error = error.message; }
    },
    async saveEditor() {
        if (this.busy) return; this.busy = true; this.editorError = '';
        try {
            const { entity, data } = this.editor; const payload = clone(data);
            if (entity === 'profiles') {
                if (!data.id || data.email !== this.editor.originalEmail || this.editor.password) {
                    const { data: result, error } = await backend().functions.invoke('scpos-create-user', { body: { ...payload, ...(data.id ? { operation: 'update' } : {}), password: this.editor.password } });
                    let detail = result?.error;
                    if (!detail && error?.context instanceof Response) { try { detail = (await error.context.json()).error; } catch {} }
                    if (error || detail) throw new Error(detail || 'Pengguna gagal disimpan. Pastikan Edge Function scpos-create-user sudah dipasang.');
                } else { delete payload.email; await rpc('save', { p_entity: entity, p_data: payload }); }
            } else {
                if (entity === 'products') {
                    payload.variants = payload.variants.map(variant => ({ ...(variant.id ? { id: variant.id } : {}), name: variant.name, sku: variant.sku, price_adjustment: String(variant.price_adjustment), is_active: !!variant.is_active }));
                    if (this.editor.photo) payload.photo_path = await uploadPhoto(this.editor.photo, this.profile.id);
                }
                if (entity === 'recipes') payload.product_variant_id ||= null;
                await rpc('save', { p_entity: entity, p_data: payload });
            }
            this.$refs.editorDialog.close(); this.modal = ''; this.notice = 'Data disimpan.'; await this.bootstrap(); await this.loadTable(this.table.page);
        } catch (error) { this.editorError = error.message; } finally { this.busy = false; }
    },
    closeDialog(ref) { if (this.busy) return; this.$refs[ref]?.close(); this.modal = ''; },
    async ask(message, action) {
        this.confirmation = { message, action }; this.modal = 'confirm'; this.$nextTick(() => this.$refs.confirmDialog.showModal());
    },
    async accept() {
        if (this.busy) return; this.busy = true;
        try { await this.confirmation.action(); this.$refs.confirmDialog.close(); this.modal = ''; }
        catch (error) { this.error = error.message; }
        finally { this.busy = false; }
    },
    archive(row) { this.ask('Arsipkan ' + (row.name || row.product_name) + '? Riwayat transaksi tetap tersimpan.', async () => { await rpc('archive', { p_entity: this.entity, p_id: row.id }); await this.bootstrap(); await this.loadTable(this.table.page); this.notice = 'Data diarsipkan.'; }); },
    showAudit(row) { this.confirmation = { message: JSON.stringify({ sebelum: row.before_data, sesudah: row.after_data }, null, 2), action: null }; this.modal = 'audit'; this.$nextTick(() => this.$refs.auditDialog.showModal()); },
    openStock(row) {
        this.stockForm = { ingredient_id: row.id, ingredient_name: row.name, type: 'receipt', direction: 'add', quantity: '', reason: '', reference: '' };
        this.stockPending = null; this.stockError = ''; this.modal = 'stock'; this.$nextTick(() => this.$refs.stockDialog.showModal());
    },
    async saveStock() {
        if (this.busy) return; this.busy = true; this.stockError = '';
        try {
            if (!this.stockPending) {
                const { ingredient_name, ...payload } = this.stockForm;
                payload.idempotency_key = crypto.randomUUID(); this.stockPending = payload;
                sessionStorage.setItem('scpos-stock-' + this.profile.id, JSON.stringify({ payload, form: this.stockForm }));
            }
            await rpc('stock', { p_data: clone(this.stockPending) }); this.stockPending = null;
            sessionStorage.removeItem('scpos-stock-' + this.profile.id); this.$refs.stockDialog.close(); this.modal = '';
            this.notice = 'Perubahan stok disimpan.'; await this.loadTable();
        } catch (error) {
            if (definitiveFailure(error)) { this.stockPending = null; sessionStorage.removeItem('scpos-stock-' + this.profile.id); }
            this.stockError = error.message + (this.stockPending ? ' Hasil belum pasti. Ulangi penyimpanan dengan data yang sama.' : '');
        } finally { this.busy = false; }
    },
    async saveSettings() {
        if (this.busy) return; this.busy = true; this.error = '';
        try { this.settings = await rpc('save', { p_entity: 'settings', p_data: clone(this.settingsDraft) }); this.settingsDraft = clone(this.settings); this.notice = 'Pengaturan disimpan.'; }
        catch (error) { this.error = error.message; } finally { this.busy = false; }
    },
    previewReceipt() {
        this.previewSale = { invoice_number: 'CONTOH-STRUK', created_at: new Date().toISOString(), cashier_name: this.profile.name, customer_name: 'Pelanggan contoh', status: 'paid', payment_method: 'cash', subtotal: 24000, discount: 0, tax_amount: 0, total: 24000, amount_received: 25000, change_amount: 1000, items: [{ id: 0, product_name: 'Kopi Susu Suwanting', sku: 'CONTOH-KSS', quantity: 1, unit_price: 24000, subtotal: 24000, variant_name: 'Iced', notes: '' }] };
        this.receiptPreview = true; this.modal = 'receipt'; this.$nextTick(() => this.$refs.receiptDialog.showModal());
    },
    async checkConnection() {
        this.connectionBusy = true; const start = performance.now();
        try { await rpc('status', {}, 4000); this.connection = { ok: true, message: 'Supabase terhubung · ' + Math.round(performance.now() - start) + ' ms', at: new Date().toISOString() }; }
        catch { this.connection = { ok: false, message: 'Supabase tidak dapat dihubungi. Periksa jaringan atau konfigurasi.', at: new Date().toISOString() }; }
        finally { this.connectionBusy = false; }
    },
    seedDemo() { this.ask('Isi katalog kosong dengan data dan stok SIMULASI? Gunakan hanya untuk latihan, bukan stok operasional.', async () => { await rpc('seed_demo', { p_confirm: true }); await this.bootstrap(); this.notice = 'Katalog simulasi ditambahkan.'; }); },
    theme() { const dark = document.documentElement.classList.toggle('dark'); try { localStorage.setItem('suwanting-theme', dark ? 'dark' : 'light'); } catch {} },
    add(product) {
        if (this.cartLocked) return;
        const variant = product.variants.find(item => String(item.id) === String(this.selectedVariants[product.id]));
        const key = product.id + ':' + (variant?.id || 'base'); const existing = this.lines.find(line => line.key === key);
        if (existing) { if (existing.quantity < 99) existing.quantity++; return; }
        if (this.lines.length >= 50) { this.error = 'Maksimal 50 baris pesanan.'; return; }
        this.lines.push({ key, product_id: product.id, variant_id: variant?.id || null, name: product.name, variant_name: variant?.name || '', unit_price: ((decimalUnits(product.selling_price) + decimalUnits(variant?.price_adjustment || '0')) / 100).toFixed(2), quantity: 1, notes: '' });
    },
    change(index, amount) { if (this.cartLocked) return; const line = this.lines[index]; line.quantity = Math.min(99, line.quantity + amount); if (!line.quantity) this.lines.splice(index, 1); },
    clearCart() { if (this.cartLocked) return; this.ask('Kosongkan keranjang pesanan?', async () => { Object.assign(this, emptyCart()); }); },
    async findCustomers() {
        const version = ++this.customerVersion; this.customersBusy = true; this.customerError = '';
        try { const rows = await rpc('customer_lookup', { p_query: this.customerQuery }); if (version === this.customerVersion) this.customerResults = rows; }
        catch (error) { if (version === this.customerVersion) this.customerError = error.message; }
        finally { if (version === this.customerVersion) this.customersBusy = false; }
    },
    chooseCustomer(person) { if (this.cartLocked) return; this.selectedCustomer = person; this.customerPicker = false; },
    clearCustomer() { if (!this.cartLocked) this.selectedCustomer = null; },
    review() {
        this.error = '';
        try {
            if (!this.lines.length) return;
            const totals = cartTotals(this.lines, this.discount, this.settings);
            if (this.method === 'cash' && decimalUnits(this.received || '0') < Math.round(totals.total * 100)) throw new Error('Nominal diterima belum cukup.');
            if (this.method !== 'cash' && !this.settings.simulate_payments) throw new Error('Pembayaran non-tunai dinonaktifkan.');
            this.reviewOpen = true; this.$refs.checkoutDialog.showModal();
        } catch (error) { this.error = error.message; }
    },
    async checkout() {
        if (this.busy) return; this.busy = true; this.error = '';
        try {
            if (!this.pendingPayload) {
                const payload = { idempotency_key: crypto.randomUUID(), customer_id: this.selectedCustomer?.id || null, customer_name: this.customer, items: this.lines.map(line => ({ product_id: line.product_id, variant_id: line.variant_id, quantity: line.quantity, notes: line.notes })), discount: String(this.discount || '0'), payment_method: this.method, amount_received: String(this.received || '0'), payment_confirmed: this.confirmed };
                const saved = { payload, cart: { lines: clone(this.lines), customer: this.customer, selectedCustomer: this.selectedCustomer, discount: this.discount, method: this.method, received: this.received, confirmed: this.confirmed } };
                sessionStorage.setItem('scpos-checkout-' + this.profile.id, JSON.stringify(saved)); this.pendingPayload = payload;
            }
            const sale = await rpc('checkout', { p_data: clone(this.pendingPayload) });
            sessionStorage.removeItem('scpos-checkout-' + this.profile.id); this.pendingPayload = null;
            Object.assign(this, emptyCart()); this.$refs.checkoutDialog.close(); this.reviewOpen = false; this.cartOpen = false; this.sale = sale;
            this.notice = 'Pesanan disimpan.'; this.go('sale/' + sale.id + (this.settings.receipt_auto_print ? '?print=1' : ''));
        } catch (error) {
            if (definitiveFailure(error)) { this.pendingPayload = null; sessionStorage.removeItem('scpos-checkout-' + this.profile.id); }
            this.error = error.message + (this.pendingPayload ? ' Hasil checkout belum pasti. Tekan “Ulangi checkout” agar invoice yang sama diperiksa.' : '');
            this.$refs.checkoutDialog.close(); this.reviewOpen = false;
        } finally { this.busy = false; }
    },
    restorePending() {
        try {
            const saved = JSON.parse(sessionStorage.getItem('scpos-checkout-' + this.profile.id) || 'null');
            if (saved?.payload?.idempotency_key && Array.isArray(saved.cart?.lines) && saved.cart.lines.length <= 50) { Object.assign(this, saved.cart); this.pendingPayload = saved.payload; this.notice = 'Ada checkout yang perlu diperiksa ulang. Buka Kasir lalu ulangi checkout.'; }
            const stock = JSON.parse(sessionStorage.getItem('scpos-stock-' + this.profile.id) || 'null');
            if (stock?.payload?.idempotency_key) { this.stockPending = stock.payload; this.stockForm = stock.form; }
        } catch { this.notice = 'Penyimpanan sesi tidak tersedia. Izinkan penyimpanan browser agar checkout aman diulang.'; }
    },
    resumeStock() { this.modal = 'stock'; this.$nextTick(() => this.$refs.stockDialog.showModal()); },
    confirmPayment() { this.ask('Konfirmasi pembayaran simulasi diterima? Stok resep dipotong saat konfirmasi berhasil.', async () => { this.sale = await rpc('confirm_payment', { p_id: this.sale.id }); this.notice = 'Pembayaran simulasi dikonfirmasi.'; }); },
    printReceipt() { this.receiptPreview = false; const url = new URL(location.href); url.hash = '#/sale/' + this.sale.id + '?print=1'; window.open(url.href, '_blank', 'noopener'); },
    async exportCsv() {
        if (this.busy) return; this.busy = true; this.error = '';
        try {
            let rows = []; let page = 1; let total = Infinity;
            while (rows.length < total) { const data = await rpc('list', { p_entity: this.entity, p_filters: { ...this.filters, page, per_page: 100 } }); rows.push(...data.rows); total = data.total; page++; if (!data.rows.length) break; }
            this.download(csv(rows, this.tableColumns), this.entity + '-' + today() + '.csv', 'text/csv;charset=utf-8');
        } catch (error) { this.error = error.message; } finally { this.busy = false; }
    },
    exportReport() { this.download(csv(this.report.products, [{ key: 'product_name', label: 'Produk' }, { key: 'variant_name', label: 'Varian' }, { key: 'quantity', label: 'Jumlah' }, { key: 'subtotal', label: 'Subtotal sebelum diskon/pajak' }]), 'penjualan-' + today() + '.csv', 'text/csv;charset=utf-8'); },
    download(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); },
}));

let iconScheduled = false;
const refreshIcons = () => { if (iconScheduled) return; iconScheduled = true; queueMicrotask(() => { iconScheduled = false; createIcons({ icons }); }); };
new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches('i[data-lucide]') || node.querySelector('i[data-lucide]'))))) refreshIcons(); }).observe(document.querySelector('#app'), { childList: true, subtree: true });
window.Alpine = Alpine;
Alpine.start();
refreshIcons();
