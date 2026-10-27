# LekiMapO

Peta 3D interaktif untuk mencari dan menjelajahi tempat di seluruh dunia. Pilih nama tempat pada hasil pencarian atau label peta untuk membuka detail, ringkasan dan foto Wikipedia yang dicocokkan secara ketat, kuliner sekitar, cuaca lokal, serta opsi simpan dan bagikan.

## Jalankan

1. Pasang Node.js 20.19+ atau 22.12+.
2. Dari PowerShell, buka folder ini lalu jalankan `npm.cmd install` dan `npm.cmd run dev`.
3. Buka URL lokal yang dicetak Vite.

Build produksi dijalankan dengan `npm.cmd run build`. Setiap push ke cabang `main` otomatis membangun dan menerbitkan situs melalui GitHub Pages. URL situs proyek adalah `https://rafieakila-cloud.github.io/LekiMapO/`. Repositori harus publik untuk menggunakan GitHub Pages pada paket gratis.

Untuk memasang situs di Microsoft Edge, buka URL publik lalu pilih **… → Apps → Install this site as an app**. Setelah terpasang, klik kanan ikonnya di taskbar dan pilih **Pin to taskbar**.

## Data dan batasan

- Peta jalan, label tempat, dan jejak gedung berasal dari OpenStreetMap melalui OpenFreeMap; cakupan bangunan 3D berbeda-beda menurut kota dan **bukan data real-time**.
- Pencarian dan tempat makan sekitar memakai Photon. Ringkasan, foto, dan bacaan kuliner memakai Wikipedia; lokasi artikel diverifikasi sebelum ditampilkan agar tidak tertukar dengan tempat bernama mirip. Cuaca terkini memakai Open-Meteo.
- Layanan peta dan informasi memerlukan internet. Peta ini **bukan** citra satelit langsung, pelacak lalu lintas, atau feed real-time. Favorit disimpan di penyimpanan browser perangkat. Tombol lokasi memakai posisi perangkat hanya setelah izin diberikan.
- Foto dan artikel mengikuti sumber dan lisensi masing-masing; buka tautan sumber pada panel lokasi untuk konteks dan atribusi.
