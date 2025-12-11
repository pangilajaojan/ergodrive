# Panduan Melihat Data di Firebase

## 📍 Lokasi Data di Firebase

Data disimpan di **Firebase Realtime Database** dengan struktur berikut:

### 1. **Test History** (Riwayat Test)
```
testHistory/
  └── {userId}/
      └── {testId}/
          ├── timestamp: 1234567890
          ├── averageEAR: 0.25
          ├── duration: "05:30"
          ├── status: "Mulai Mengantuk"
          ├── userId: "user_xxx"
          └── testId: "test_xxx"
```

**Path lengkap:** `testHistory/{userId}/{testId}`

### 2. **EAR Data** (Data Grafik EAR)
```
earData/
  └── {userId}/
      └── {earDataId}/
          ├── timestamp: 1234567890
          ├── earValue: 0.25
          ├── testId: "test_xxx"
          └── userId: "user_xxx"
```

**Path lengkap:** `earData/{userId}/{earDataId}`

### 3. **User ID**
- User ID disimpan di `localStorage` dengan key: `drowsiness_user_id`
- Format: `user_{timestamp}_{randomString}`
- Contoh: `user_1234567890_abc123xyz`

---

## 🔍 Cara Melihat Data di Firebase Console

### Langkah 1: Buka Firebase Console
1. Buka browser dan kunjungi: **https://console.firebase.google.com/**
2. Login dengan akun Google yang memiliki akses ke project **ergodrivee**

### Langkah 2: Pilih Project
1. Klik pada project **"ergodrivee"**
2. Di sidebar kiri, klik **"Realtime Database"**

### Langkah 3: Lihat Data
1. Anda akan melihat struktur data seperti ini:
   ```
   ergodrivee-default-rtdb
   ├── testHistory
   │   └── user_xxx
   │       └── test_xxx
   │           ├── timestamp
   │           ├── averageEAR
   │           ├── duration
   │           ├── status
   │           └── testId
   └── earData
       └── user_xxx
           └── earData_xxx
               ├── timestamp
               ├── earValue
               ├── testId
               └── userId
   ```

2. Klik pada node untuk melihat detail data
3. Data akan ter-update secara real-time saat aplikasi menyimpan data

---

## 🔑 Cara Mengetahui User ID Anda

### Metode 1: Dari Browser Console
1. Buka aplikasi di browser
2. Tekan `F12` untuk membuka Developer Tools
3. Buka tab **Console**
4. Ketik: `localStorage.getItem('drowsiness_user_id')`
5. Tekan Enter, akan muncul User ID Anda

### Metode 2: Dari Firebase Console
1. Buka Firebase Console → Realtime Database
2. Lihat di bawah `testHistory` atau `earData`
3. User ID adalah nama folder pertama yang muncul

---

## 📊 Contoh Data yang Tersimpan

### Test History Entry
```json
{
  "testHistory": {
    "user_1234567890_abc123": {
      "test_1234567890_xyz789": {
        "timestamp": 1703123456789,
        "averageEAR": 0.245,
        "duration": "05:30",
        "status": "Mulai Mengantuk",
        "userId": "user_1234567890_abc123",
        "testId": "test_1234567890_xyz789"
      }
    }
  }
}
```

### EAR Data Entry
```json
{
  "earData": {
    "user_1234567890_abc123": {
      "earData_001": {
        "timestamp": 1703123456789,
        "earValue": 0.245,
        "testId": "test_1234567890_xyz789",
        "userId": "user_1234567890_abc123"
      },
      "earData_002": {
        "timestamp": 1703123456790,
        "earValue": 0.250,
        "testId": "test_1234567890_xyz789",
        "userId": "user_1234567890_abc123"
      }
    }
  }
}
```

---

## 🔗 Link Langsung ke Firebase Console

**Realtime Database:**
https://console.firebase.google.com/project/ergodrivee/database/ergodrivee-default-rtdb/data

**Project Overview:**
https://console.firebase.google.com/project/ergodrivee/overview

---

## 💡 Tips

1. **Filter Data**: Gunakan fitur search di Firebase Console untuk mencari data tertentu
2. **Export Data**: Klik menu (⋮) di Firebase Console untuk export data sebagai JSON
3. **Real-time Updates**: Data akan ter-update otomatis di console saat aplikasi menyimpan data
4. **Delete Data**: Klik pada node dan tekan Delete untuk menghapus data (hati-hati!)

---

## 🛠️ Troubleshooting

### Data tidak muncul?
1. Pastikan aplikasi sudah menyimpan data (cek console browser untuk error)
2. Pastikan Anda login dengan akun yang benar di Firebase Console
3. Refresh halaman Firebase Console

### Tidak bisa akses Firebase Console?
1. Pastikan Anda memiliki akses ke project **ergodrivee**
2. Hubungi admin project untuk memberikan akses

---

## 📝 Catatan Penting

- **User ID** unik per browser/device (disimpan di localStorage)
- **Test ID** unik per test session
- **EAR Data** disimpan setiap 5 detik (batch save)
- Data **EAR** dihapus otomatis saat **Test History** dihapus dari aplikasi

