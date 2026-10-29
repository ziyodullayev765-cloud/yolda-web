# YO'LDA — Liquid Glass sinovi (7 kunlik)

Bu papka **saytning bir qismi emas**. U bitta ish uchun: iOS 26 ning
haqiqiy Liquid Glass panelini o'z telefoningizda ko'rish.

Ichidagi ekran — `yolda.uz` ning o'zi. Pastdagi panel esa veb emas,
**tizimniki**: uni iOS chizadi. Shuning uchun unda nur sinishi ham,
telefonni qimirlatganda yaltirashi ham bor — CSS bera olmaydigan
narsalar.

---

## Nima kerak

| Narsa | Nega |
|---|---|
| **Mac** | Xcode faqat macOS da ishlaydi. Bundan boshqa yo'l yo'q. |
| **Xcode 26** | Liquid Glass iOS 26 SDK bilan yig'ilganda chiqadi. |
| **iPhone, iOS 26** | Eski iOS da panel eski ko'rinishda bo'ladi. |
| **Oddiy Apple ID** | Pullik Developer Program **shart emas**. |
| **USB kabel** | Birinchi marta telefonni Mac ga ulash uchun. |

> **7 kun.** Bepul Apple ID bilan o'rnatilgan ilova yetti kundan
> keyin ochilmay qoladi. Unda Xcode'ni ochib, yana **Run** bosasiz —
> muddati qaytadan boshlanadi. Bu Apple'ning qoidasi, ilovaning
> kamchiligi emas.

---

## Qadamlar

### 1. Loyiha yasash

Xcode → **File ▸ New ▸ Project** → **iOS ▸ App** → **Next**.

| Maydon | Qiymat |
|---|---|
| Product Name | `YoldaGlass` |
| Interface | **SwiftUI** |
| Language | **Swift** |
| Organization Identifier | `uz.yolda` (istalgan narsa, lekin o'zingizniki) |

**Next** → papkani tanlang → **Create**.

### 2. Fayllarni qo'yish

Shu papkadagi uchta faylni loyihaga ko'chiring:

- `YoldaGlassApp.swift` — Xcode yasagan shu nomli faylning
  **ustiga yozing** (ichidagini almashtiring);
- `RootView.swift` — yangi fayl sifatida qo'shing;
- `VebKorinish.swift` — yangi fayl sifatida qo'shing.

> Qo'shish: chapdagi ro'yxatda papka ustiga sudrab tashlang va
> **"Copy items if needed"** ni belgilang.

### 3. Hisobni ulash

Xcode → **Settings ▸ Accounts ▸ +** → **Apple ID** → o'z Apple ID
ingiz bilan kiring. Pul so'ramaydi.

Keyin loyiha sozlamalarida (chapdagi ko'k belgi) → **Signing &
Capabilities**:

- **Automatically manage signing** — yoqilgan bo'lsin;
- **Team** — o'z ismingiz (`Personal Team`);
- **Bundle Identifier** — dunyoda yagona bo'lishi kerak. Masalan
  `uz.yolda.glass.ismingiz`. Qizil xato chiqsa, oxiriga raqam
  qo'shing.

### 4. Telefonni ulash

1. iPhone ni Mac ga kabel bilan ulang, telefonda **"Trust"** bosing.
2. iPhone: **Settings ▸ Privacy & Security ▸ Developer Mode** —
   yoqing (telefon qayta yuklanadi).
3. Xcode tepasida qurilma sifatida **o'z iPhone ingizni** tanlang
   (simulyator emas — simulyatorda ham ko'rinadi, lekin shisha
   haqiqiy telefonda chiroyliroq).

### 5. Ishga tushirish

**▶ Run** (yoki `⌘R`).

Birinchi marta telefonda ogohlantirish chiqadi — **"Untrusted
Developer"**. Unda:

**Settings ▸ General ▸ VPN & Device Management** → o'z Apple ID
ingizni tanlang → **Trust**.

Keyin ilovani telefondan oching.

---

## Nimani ko'rasiz

- Pastdagi panel — **haqiqiy Liquid Glass**. Ro'yxatni surib ko'ring:
  ortidagi narsa shisha ichida egiladi va rang beradi.
- Telefonni qiya tutsangiz, yaltirash joyi siljiydi.
- Bo'lim almashganda tanlangan katak shisha ichida "oqib" o'tadi.

Taqqoslash uchun: Safari'da `yolda.uz` ni oching va hozirgi
veb paneliga qarang. Farq aynan **nur sinishi** da — veb uni
qila olmaydi.

---

## Ogohlantirish

- Bu ilovani **App Store'ga qo'yib bo'lmaydi**: Apple shunchaki
  saytni o'rab qo'ygan ilovani rad etadi (4.2-qoida). Uning
  vazifasi — ko'rib, qaror qabul qilish.
- Agar keyinroq haqiqiy native ilova qilmoqchi bo'lsangiz,
  ekranlarni Swift'da qaytadan yozish kerak bo'ladi va tarqatish
  uchun yiliga $99 to'lanadi.
- Papka `.vercelignore` da — saytga chiqmaydi, hajmga ta'sir
  qilmaydi.
