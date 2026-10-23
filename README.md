# Alfacom Target Marketing

Aplikasi target omzet dan laba untuk toko Kendari dan Raha. Frontend statis disajikan melalui GitHub Pages dan langsung membuka dashboard tanpa login. Pilihan toko tersedia pada dropdown. Laporan sumber berada di Supabase Postgres; Edge Function `marketing-api` hanya mengirim ringkasan bulanan yang diperlukan untuk perhitungan ke pengunjung umum. Skenario yang disimpan pengguna berada di penyimpanan browser masing-masing.

- Aplikasi: https://alfacomapp.github.io/alfacom-target-marketing/
- Repository: https://github.com/alfacomapp/alfacom-target-marketing
- Proyek Supabase: https://supabase.com/dashboard/project/wevrtmqmgnfdwnmkgydg

Proyek Supabase tersebut sudah berisi 18 laporan historis. Ringkasan bulanan pada situs publik dapat dibaca siapa saja yang membuka URL aplikasi. Rincian akun, nama file sumber, dan file `.xls` tidak dikirim oleh API publik.

## Model perhitungan

18 laporan sumber (Januari–September 2026 untuk masing-masing toko) direkonsiliasi per bulan:

```text
pendapatan − HPP akhir = laba kotor
laba kotor − total biaya + pendapatan lain − biaya lain = laba rugi laporan
laba sebelum pembayaran investor = laba rugi laporan + bagi hasil investor yang tercatat
```

Jika akun bagi hasil investor tidak ada, kolom `investor_paid` disimpan sebagai `NULL` (belum tercatat dibayar), bukan nol. Tarif atau kewajiban investor tidak dapat diturunkan dengan aman dari pembayaran historis yang waktunya mungkin berbeda. Target laba pemilik baru dihitung setelah pengguna mengisi aturan investor.

Perkiraan bulanan memakai:

```text
rasio HPP = jumlah HPP / jumlah pendapatan
rasio biaya variabel = jumlah (komisi + pengiriman) / jumlah pendapatan
biaya lain = median bulanan (total biaya − investor dibayar − komisi − pengiriman)
margin kontribusi = 1 − rasio HPP − rasio biaya variabel
target omzet = (target laba sebelum investor + biaya lain − pendapatan lain neto) / margin kontribusi
```

HPP memakai angka *total HPP akhir* pada laporan, termasuk potongan pembelian serta koreksi stok. Rasio dan biaya dipisahkan per toko. Rentang sensitivitas memakai persentil 25 dan 75 tiap driver dari observasi historis; rentang ini bukan interval keyakinan statistik. Porsi marketing hanya membagi target omzet karena laporan tidak memisahkan margin transaksi marketing dan walk-in.

Dashboard menampilkan uji silang *leave-one-month-out*: setiap bulan diprediksi memakai bulan lain sebagai dasar. Rata-rata selisih absolut historis ditampilkan agar ketidakpastian proyeksi terlihat, terutama ketika target laba kecil dibanding variasi biaya bulanan.

## Menjalankan lokal

```bash
npm ci
npm test
python -m pip install -r requirements.txt
python scripts/normalize_reports.py
npm run prepare:demo
npm run dev
```

Pratinjau lokal memakai 18 file `.xls` di folder proyek. Data pratinjau dilayani hanya oleh server pengembangan melalui `/__demo`. File laporan, JSON hasil normalisasi, data pratinjau, dan folder build diabaikan Git. `npm run build` menghasilkan frontend tanpa angka laporan.

## Pemasangan Supabase baru

1. Buat proyek Supabase baru. Jalankan migrasi `supabase/migrations/20261023000000_marketing_planner.sql` melalui CLI atau SQL Editor.
2. Deploy `supabase/functions/marketing-api` dengan `verify_jwt = false` sesuai `supabase/config.toml`. Endpoint `GET ?action=public` hanya mengirim ringkasan bulanan. Endpoint penulisan tetap memverifikasi JWT dan keanggotaan admin. Simpan service role key hanya sebagai environment server Supabase; jangan masukkan ke frontend atau GitHub.
3. Di mesin yang memiliki 18 laporan sumber, jalankan `python scripts/normalize_reports.py`. Set `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` hanya pada shell lokal, lalu jalankan `node scripts/import-reports.mjs`. Script memverifikasi seluruh 18 laporan sebelum mengimpor dan memastikan 18 baris diterima. Jangan mengunggah laporan sumber atau kunci ke repository.
4. Buat repository variables `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di GitHub. Nilai kedua adalah publishable/anon key, bukan service role key. Pilih **GitHub Actions** sebagai sumber GitHub Pages. Workflow akan menguji, membangun, dan menerbitkan frontend.

File `.env.example` dapat disalin ke `.env.local` untuk menguji frontend terhadap Supabase secara lokal. Pembaruan laporan selanjutnya dilakukan melalui proses impor backend. Situs publik tidak menyediakan formulir perubahan laporan.

Untuk memeriksa layanan yang sudah terpasang, set tiga variabel `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY` pada shell lokal, lalu jalankan `node scripts/smoke-backend.mjs`. Pemeriksaan ini membuat pengguna dan laporan sementara, menguji alur akses, lalu menghapus keduanya. Jangan menyimpan service role key di file proyek.

## Audit sumber

`scripts/normalize_reports.py` menggunakan label dan posisi subtotal di setiap laporan, bukan nomor baris tetap. Script menghentikan proses bila `pendapatan − HPP akhir` atau `laba rugi` berbeda lebih dari Rp2 dari angka laporan. Dua laporan dengan laba rugi persis nol memiliki baris hasil kosong pada ekspor; script menyimpan `net_reported = NULL` sambil menghitung hasil nol dari komponen. Pada Kendari Agustus, terdapat akun `BIAYA` negatif di bagian pendapatan; angka itu tetap dihormati sebagai pengurang pendapatan sesuai laporan dan ditandai pada ringkasan tanpa mempublikasikan rincian akunnya.

## Keterbatasan

Ini perkiraan untuk perencanaan, bukan jaminan laba. Model tidak dapat meramalkan perubahan harga beli, campuran barang/jasa, biaya satu kali, pajak, atau bagi hasil investor yang belum ditentukan. Saat laporan baru dimasukkan, kalibrasi menggunakan semua bulan yang tersedia dan harus ditinjau kembali bila struktur usaha berubah.
