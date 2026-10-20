import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, request }) => {
    await request.post('/__test/reset');
    await page.addInitScript(() => localStorage.setItem('suwanting-supabase', JSON.stringify({ url: 'http://127.0.0.1:4175', key: 'sb_publishable_test_browser_public_only_2026' })));
    page.errors = [];
    page.on('pageerror', error => page.errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });
async function login(page, role = 'owner', route = '') {
    await page.goto('./' + route);
    await page.getByLabel('Email', { exact: true }).fill(role + '@example.test');
    await page.getByLabel('Password', { exact: true }).fill('TestOnly!2026');
    await page.getByRole('button', { name: 'Masuk ke ruang kerja', exact: true }).click();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
async function nav(page, name) { await page.getByRole('navigation', { name: 'Menu utama', exact: true }).getByRole('link', { name, exact: true }).click(); await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); }
async function startSale(page) { await nav(page, 'Kasir'); await page.getByRole('button', { name: 'Tambah Kopi Susu Suwanting', exact: true }).click(); await page.getByRole('button', { name: 'Gunakan uang pas' }).click(); }
async function checkout(page) { await page.getByRole('button', { name: 'Periksa pembayaran', exact: true }).click(); await page.getByRole('button', { name: 'Simpan pesanan', exact: true }).click(); }

test('static build runs at GitHub project subpath, hash deep links reload, theme persists', async ({ page }) => {
    await login(page, 'owner', '#/pos');
    await expect(page.getByRole('heading', { name: 'Racik pesanan hari ini.' })).toBeVisible();
    await page.getByRole('button', { name: 'Ganti tema', exact: true }).last().click();
    await expect(page.locator('html')).toHaveClass('dark');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Racik pesanan hari ini.' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass('dark');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: '.test-artifacts/pos-desktop-dark.png', fullPage: true });
});
test('registered customer and variant checkout writes one paid sale and recipe deduction', async ({ page, request }) => {
    await login(page); await nav(page, 'Kasir');
    await page.getByLabel('Varian Kopi Susu Suwanting').selectOption('1');
    await page.getByRole('button', { name: 'Tambah Kopi Susu Suwanting', exact: true }).click();
    await page.getByRole('button', { name: 'Pilih pelanggan terdaftar' }).click();
    await page.getByLabel('Cari nama atau telepon').fill('081200');
    await page.getByRole('button', { name: 'Pelanggan Uji 081200000000' }).click();
    await page.getByRole('button', { name: 'Gunakan uang pas' }).click(); await checkout(page);
    await expect(page).toHaveURL(/#\/sale\/\d+$/);
    const receipt = page.locator('main .receipt-paper');
    await expect(receipt).toContainText('Pelanggan Uji'); await expect(receipt).toContainText('Iced'); await expect(receipt).toContainText('28.860');
    expect(await (await request.get('/__test/state')).json()).toEqual({ stock: '79.875', sales: 1, movements: 1 });
});
test('lost response after commit survives reload; immutable retry returns original invoice', async ({ page, request }) => {
    await login(page); await startSale(page); await request.post('/__test/lose-checkout'); await checkout(page);
    await expect(page.getByRole('button', { name: 'Ulangi checkout', exact: true }).first()).toBeVisible();
    await expect(page.locator('main [role="alert"]')).toContainText('Hasil checkout belum pasti');
    await expect(page.getByRole('button', { name: 'Tambah Kopi Susu Suwanting', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ulangi checkout', exact: true }).first()).toBeVisible();
    await request.post('/__test/restore-response');
    await page.getByRole('button', { name: 'Ulangi checkout', exact: true }).first().click();
    await expect(page).toHaveURL(/#\/sale\/\d+$/);
    expect(await (await request.get('/__test/state')).json()).toEqual({ stock: '81.875', sales: 1, movements: 1 });
});
test('customer CRUD renders user text safely and archive removes lookup candidate', async ({ page }) => {
    await login(page); await nav(page, 'Pelanggan');
    await page.getByRole('button', { name: 'Tambah Pelanggan', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Nama pelanggan', { exact: true }).fill('<img src=x onerror=alert(1)>');
    await dialog.getByLabel('Telepon', { exact: true }).fill('080099');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.locator('main tr').filter({ hasText: '<img src=x onerror=alert(1)>' });
    await expect(row).toBeVisible(); await expect(row.locator('img')).toHaveCount(0);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('dialog[open]').getByLabel('Nama pelanggan', { exact: true }).fill('Pelanggan Baru');
    await page.locator('dialog[open]').getByRole('button', { name: 'Simpan', exact: true }).click();
    await page.locator('main tr').filter({ hasText: 'Pelanggan Baru' }).getByRole('button', { name: 'Arsipkan' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Lanjutkan' }).click();
    await expect(page.locator('main tr').filter({ hasText: 'Pelanggan Baru' })).toHaveCount(0);
});
test('settings persist tax toggle, text receipt template, preview without writes and connection check', async ({ page, request }) => {
    await login(page); await nav(page, 'Pengaturan');
    await page.getByLabel('Aktifkan pajak', { exact: true }).uncheck();
    await page.getByLabel('Teks header', { exact: true }).fill('<script>alert(1)</script>');
    await page.getByLabel('Lebar kertas').selectOption('58');
    await page.getByRole('button', { name: 'Pratinjau struk', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog).toContainText('<script>alert(1)</script>'); await expect(dialog.locator('script')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
    expect((await (await request.get('/__test/state')).json()).sales).toBe(0);
    await page.getByRole('button', { name: 'Simpan pengaturan', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pengaturan disimpan.');
    await page.getByRole('button', { name: 'Cek koneksi', exact: true }).click(); await expect(page.locator('main')).toContainText('Supabase terhubung');
    await startSale(page); await expect(page.locator('.cart-panel')).toContainText('Pajak nonaktif'); await checkout(page);
    await expect(page.locator('main .receipt-paper')).toContainText('24.000');
    await expect(page.locator('main .receipt-paper')).toHaveCSS('width', /188/);
});
test('inventory manual stock, recipe editing, movements and usage use real database', async ({ page, request }) => {
    await login(page); await nav(page, 'Inventori & resep');
    await page.getByRole('button', { name: 'Mutasi', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Jumlah (satuan dasar)', { exact: true }).fill('25.125');
    await dialog.getByLabel('Referensi penerimaan / penyesuaian').fill('PO-BROWSER');
    await dialog.getByLabel('Alasan', { exact: true }).fill('Penerimaan bahan uji');
    await dialog.getByRole('button', { name: 'Simpan mutasi', exact: true }).click();
    await expect(page.locator('main')).toContainText('125,125');
    await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Resep', exact: true }).click();
    await page.locator('main tr').filter({ hasText: '18,125' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('dialog[open]').getByLabel('Takaran', { exact: true }).fill('20');
    await page.locator('dialog[open]').getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await startSale(page); await checkout(page); await expect(page).toHaveURL(/#\/sale\/\d+$/);
    expect(await (await request.get('/__test/state')).json()).toEqual({ stock: '105.125', sales: 1, movements: 2 });
    await nav(page, 'Inventori & resep');
    await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Riwayat stok', exact: true }).click();
    await expect(page.locator('main')).toContainText('PO-BROWSER');
    await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Pemakaian bahan', exact: true }).click();
    await expect(page.locator('main tbody:visible')).toContainText('20');
});
test('cashier role hides management and direct management hash is denied', async ({ page }) => {
    await login(page, 'cashier');
    await expect(page.getByRole('navigation', { name: 'Menu utama', exact: true }).getByRole('link', { name: 'Pengaturan', exact: true })).toHaveCount(0);
    await page.goto('./#/settings'); await expect(page).toHaveURL(/#\/dashboard$/);
    await nav(page, 'Pelanggan'); await expect(page.getByRole('button', { name: 'Tambah Pelanggan', exact: true })).toBeHidden();
    await startSale(page); await checkout(page); await expect(page).toHaveURL(/#\/sale\/\d+$/);
});
test('new product preserves cost/description/variants; new ingredient recipe integrates checkout', async ({ page }) => {
    await login(page); await nav(page, 'Produk & menu');
    await page.getByRole('button', { name: 'Tambah Produk', exact: true }).click();
    let dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Nama produk', { exact: true }).fill('Menu Uji Baru');
    await dialog.getByLabel('SKU', { exact: true }).fill('BROWSER-NEW');
    await dialog.getByLabel('Kategori', { exact: true }).selectOption('1');
    await dialog.getByLabel('Harga jual (Rp)', { exact: true }).fill('10000');
    await dialog.getByLabel('Harga modal (Rp)', { exact: true }).fill('4000.29');
    await dialog.getByLabel('Deskripsi', { exact: true }).fill('Deskripsi racikan uji');
    await dialog.getByRole('button', { name: 'Tambah varian', exact: true }).click();
    await dialog.getByLabel('Nama', { exact: true }).fill('Large');
    await dialog.getByLabel('SKU', { exact: true }).last().fill('BROWSER-LARGE');
    await dialog.getByLabel('Tambahan harga', { exact: true }).fill('2000');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.locator('main tr').filter({ hasText: 'Menu Uji Baru' }).getByRole('button', { name: 'Edit', exact: true }).click();
    dialog = page.locator('dialog[open]');
    await expect(dialog.getByLabel('Harga modal (Rp)', { exact: true })).toHaveValue('4000.29');
    await expect(dialog.getByLabel('Deskripsi', { exact: true })).toHaveValue('Deskripsi racikan uji');
    await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
    await nav(page, 'Inventori & resep');
    await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Satuan dasar', exact: true }).click();
    await page.getByRole('button', { name: 'Tambah Satuan dasar', exact: true }).click(); dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Nama satuan', { exact: true }).fill('Buah'); await dialog.getByLabel('Simbol', { exact: true }).fill('pcs');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Bahan baku', exact: true }).click();
    await page.getByRole('button', { name: 'Tambah Bahan baku', exact: true }).click(); dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Nama bahan', { exact: true }).fill('Bahan Baru'); await dialog.getByLabel('SKU bahan', { exact: true }).fill('BROWSER-BAHAN');
    await dialog.getByLabel('Satuan dasar', { exact: true }).selectOption({ label: 'Buah' });
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.locator('main tr').filter({ hasText: 'Bahan Baru' }).getByRole('button', { name: 'Mutasi', exact: true }).click(); dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Jumlah (satuan dasar)', { exact: true }).fill('30'); await dialog.getByLabel('Referensi penerimaan / penyesuaian').fill('PO-NEW'); await dialog.getByLabel('Alasan', { exact: true }).fill('Saldo uji');
    await dialog.getByRole('button', { name: 'Simpan mutasi', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Resep', exact: true }).click();
    await page.getByRole('button', { name: 'Tambah Resep', exact: true }).click(); dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Produk', { exact: true }).selectOption({ label: 'Menu Uji Baru' });
    await dialog.getByLabel('Bahan', { exact: true }).selectOption({ label: 'Bahan Baru (pcs)' }); await dialog.getByLabel('Takaran', { exact: true }).fill('3');
    await dialog.getByRole('button', { name: 'Simpan', exact: true }).click(); await expect(dialog).toHaveCount(0);
    await nav(page, 'Kasir'); await page.getByLabel('Varian Menu Uji Baru').selectOption({ label: 'Large (Rp 2.000)' });
    await page.getByRole('button', { name: 'Tambah Menu Uji Baru', exact: true }).click(); await page.getByRole('button', { name: 'Gunakan uang pas' }).click();
    await checkout(page); await expect(page).toHaveURL(/#\/sale\/\d+$/);
    await expect(page.locator('main .receipt-paper')).toContainText('13.320');
    await nav(page, 'Inventori & resep'); await page.getByRole('navigation', { name: 'Modul inventori' }).getByRole('button', { name: 'Bahan baku', exact: true }).click();
    await expect(page.locator('main tr').filter({ hasText: 'Bahan Baru' })).toContainText('27');
});
test('mobile navigation and cart work without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await login(page);
    await page.getByRole('navigation', { name: 'Navigasi cepat' }).getByRole('link', { name: 'Kasir', exact: true }).click();
    await page.getByRole('button', { name: 'Tambah Kopi Susu Suwanting', exact: true }).click();
    await page.getByRole('button', { name: /Lihat keranjang/ }).click(); await expect(page.locator('.cart-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Gunakan uang pas' }).click();
    await page.screenshot({ path: '.test-artifacts/pos-mobile-cart.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkout(page); await expect(page).toHaveURL(/#\/sale\/\d+$/);
});
