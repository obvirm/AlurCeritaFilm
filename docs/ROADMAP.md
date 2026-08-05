# Roadmap movie2short

## Tujuan

Roadmap ini mendesain pemrosesan video berdurasi hingga sekitar 3 jam tanpa mengunggah seluruh video sekaligus. Implementasi video 3 jam **belum termasuk scope saat ini**; pipeline aktif tetap memproses input utama `C:\Users\X\Downloads\getvid.mp4`.

## Prinsip utama

- Video sumber tetap berada di penyimpanan lokal.
- Setiap MP4 chunk dibuat, diunggah, dianalisis, lalu dihapus dari cloud sebelum chunk berikutnya diproses.
- File cloud tidak boleh berada di Gemini lebih dari 30 menit.
- Cleanup eksplisit dalam `finally` tetap wajib, baik analisis sukses maupun gagal; retensi provider bukan mekanisme cleanup.
- Manifest per chunk disimpan lokal agar proses dapat dilanjutkan tanpa mengulang chunk yang sudah selesai.

## Rencana pemrosesan video 3 jam

### 1. Probe dan pembagian lokal

1. Jalankan `ffprobe` untuk memperoleh durasi, stream, frame rate, dan time base sumber.
2. Bagi timeline menjadi chunk lokal berdurasi target 10–20 menit. Tambahkan overlap 2–5 detik untuk menjaga kontinuitas adegan pada batas chunk.
3. Potong dengan FFmpeg ke direktori kerja lokal. Gunakan stream copy bila batas keyframe memadai; gunakan encode ulang hanya jika timestamp atau keyframe membuat chunk tidak valid.
4. Simpan `chunk_index.json` dengan ID, waktu global mulai/akhir, overlap, checksum, status, dan path lokal.

Contoh lifecycle status: `pending -> encoded -> uploaded -> analyzed -> cloud_deleted -> candidates_saved`.

### 2. Upload, analyze, delete secara serial

Untuk setiap chunk:

1. Validasi MP4 lokal dengan `ffprobe`.
2. Upload hanya satu chunk ke Gemini Files API.
3. Tunggu file berstatus siap, tetapi batasi keseluruhan waktu cloud hingga maksimal 30 menit sejak upload dimulai.
4. Analisis audio dan visual chunk; semua timestamp hasil model dikonversi dari waktu lokal chunk menjadi waktu global video.
5. Simpan respons mentah dan kandidat scene secara atomik ke disk lokal.
6. Dalam blok `finally`, panggil delete Files API untuk MP4 chunk, termasuk ketika upload processing, parsing, atau analisis gagal.
7. Verifikasi penghapusan. Jika delete gagal, retry dengan backoff selama masih di bawah deadline 30 menit; hentikan antrean upload baru jika cleanup belum terkonfirmasi.
8. Hapus MP4 chunk lokal hanya setelah kandidat dan status cleanup tersimpan, kecuali pengguna memilih menyimpan cache lokal.

Tidak boleh ada strategi yang mengandalkan retensi otomatis 48 jam. Batas operasional internal lebih ketat: file cloud harus terhapus secepat analisis selesai dan tidak pernah sengaja dibiarkan melewati 30 menit.

### 3. Kandidat scene per chunk

Setiap kandidat minimal menyimpan:

- `chunk_id` dan timestamp lokal/global;
- deskripsi visual dan fakta dialog/audio;
- `narration_text` bergaya storyteller Indonesia;
- skor kepentingan cerita, kejelasan visual, kebaruan, dan kualitas hook/payoff;
- embedding atau fingerprint sederhana untuk deduplikasi;
- konteks akhir chunk sebelumnya untuk kontinuitas narasi.

Scene yang hanya muncul karena overlap diberi identitas global agar tidak terpilih dua kali.

### 4. Final selection lintas seluruh video

Final selection dilakukan **setelah semua chunk selesai**, bukan dengan mengambil jumlah scene tetap dari setiap chunk:

1. Gabungkan kandidat berdasarkan timestamp global.
2. Deduplikasi overlap menggunakan jarak timestamp, kemiripan deskripsi/narasi, dan fingerprint visual.
3. Buat ringkasan hierarkis per bab/chunk agar selector memahami alur seluruh video tanpa memasukkan semua frame mentah ke satu prompt.
4. Nilai kandidat berdasarkan kontribusi terhadap hook, setup, eskalasi, payoff, kontinuitas, dan variasi visual.
5. Terapkan constraint urutan kronologis dan jarak minimum agar scene tidak tumpang tindih.
6. Pilih rangkaian final dari seluruh video dengan budget durasi yang dapat dikonfigurasi; jangan memberi kuota sama rata per chunk.
7. Jalankan pass kedua untuk menghapus repetisi, memperbaiki transisi narasi, dan memastikan fakta tetap bersumber dari kandidat terpilih.
8. Tulis `manifest_stage1.json`, `manifest.json`, dan laporan selection yang mencatat kandidat dipilih/ditolak beserta alasannya.

### 5. Resume, retry, dan failure handling

- Proses dapat dilanjutkan dari `chunk_index.json`; chunk berstatus `cloud_deleted` dan `candidates_saved` tidak dianalisis ulang.
- Retry upload/analysis dibatasi dan tidak boleh membuat dua file cloud aktif tanpa pelacakan.
- Startup recovery harus mencari entri `uploaded`/`analyzed` yang belum `cloud_deleted`, mencoba cleanup lebih dahulu, lalu baru melanjutkan.
- Jika cleanup tidak dapat dikonfirmasi sebelum 30 menit, pipeline berhenti dan melaporkan nama file cloud untuk intervensi manual.
- Semua artifact parsial diberi nama unik per run agar output sebelumnya tidak tertimpa.

## Tahapan implementasi mendatang

1. Tambahkan chunk index dan utilitas FFmpeg lokal.
2. Ubah adapter Gemini agar menerima satu chunk per lifecycle, mempertahankan delete di `finally`, dan mencatat deadline 30 menit.
3. Tambahkan normalisasi timestamp global dan deduplikasi overlap.
4. Tambahkan hierarchical final selector lintas chunk.
5. Tambahkan resume/recovery test dan simulasi kegagalan upload, analisis, parsing, serta delete.
6. Uji bertahap pada video 30 menit, 1 jam, lalu 3 jam sebelum penggunaan produksi.

## Kriteria verifikasi implementasi masa depan

- Tidak pernah ada lebih dari satu chunk aktif di cloud untuk satu worker serial.
- Setiap upload memiliki event delete terkonfirmasi, termasuk pada jalur error.
- Usia cloud file tercatat dan selalu kurang dari 30 menit.
- Timestamp manifest final berada dalam durasi sumber dan berurutan.
- Kandidat overlap tidak terduplikasi.
- Final selection mempertimbangkan kandidat dari seluruh video, bukan hanya chunk awal atau kuota rata.
- Video hasil akhir lolos `ffprobe` dan full decode FFmpeg.
