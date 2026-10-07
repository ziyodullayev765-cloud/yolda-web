# Data safety — Play Console javoblari

Play Console → **App content → Data safety** bo'limiga kiritiladigan
javoblar. Har biri kodga qarab yozilgan; qaysi fayldan olingani
qavsda ko'rsatilgan.

Google formadagi nomlarni inglizcha ko'rsatadi, shuning uchun bu
yerda ham inglizcha nomlar qoldirilgan — Console'da aynan shularni
topasiz.

> **Diqqat.** Bu deklaratsiyani siz imzolaysiz. Quyidagilar kodning
> hozirgi holatiga to'g'ri keladi. Ilovaga yangi narsa qo'shilsa
> (masalan to'lov yoki joylashuv), shu faylni ham yangilash kerak,
> aks holda deklaratsiya yolg'on bo'lib qoladi.

---

## 1. Boshlang'ich uchta savol

| Savol | Javob | Nega |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Ism, telefon, pochta, rasm va xabarlar yig'iladi |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Sayt faqat HTTPS orqali ishlaydi; `vercel.json` da HSTS |
| Do you provide a way for users to request that their data is deleted? | **Yes** | Ilova ichida (`lib/deleteAccount.js`) va ochiq sahifada |

**Data deletion URL:** `https://yolda-web.vercel.app/hisob-ochirish`

---

## 2. Yig'iladigan ma'lumotlar

Quyidagi jadvalda:

- **Collected** — serverda saqlanadimi
- **Shared** — uchinchi tomonga yoki boshqa foydalanuvchilarga
  ko'rinadimi
- **Required** — majburiymi yoki ixtiyoriy
- **Purposes** — Google formasidagi maqsad belgilari

### Personal info

| Data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| **Name** | Yes | Yes | Required | App functionality, Account management |
| **Email address** | Yes | **No** | Required\* | Account management, App functionality |
| **User IDs** | Yes | Yes | Required | App functionality, Account management |
| **Phone number** | Yes | Yes | Required\* | App functionality, Account management |
| **Other info** (hujjat rasmlari) | Yes | **No** | Optional | Fraud prevention, security, and compliance |

\* Google orqali kirganda pochta majburiy, telefon orqali kirganda
raqam majburiy — kirish usuliga bog'liq. Formada "Required" deb
belgilang: ikkala holatda ham bittasisiz hisob ochilmaydi.

**Izohlar:**

- **Name** ommaviy profilda ko'rinadi (`api/profile.js`).
- **Email address** hech qachon ommaviy emas va boshqa
  foydalanuvchiga berilmaydi — buni `api/order.js` dagi
  `getLoadDetail` da ko'rish mumkin: javobda pochta yo'q.
- **User IDs** — username va Telegram ID. Username ommaviy.
- **Phone number** yuk e'lonida ko'rsatilmaydi; faqat yuk beruvchi
  haydovchini tanlagandan keyin, faqat shu ikki tomonga ochiladi
  (`api/order.js`, `decideOfferCore`). Mashina e'lonida esa
  ataylab ochiq — e'lonning maqsadi shu.
- **Other info** — tasdiqlash hujjati (pasport, guvohnoma yoki
  texpasport rasmi). Faqat moderator ko'radi va **qaror
  chiqarilgandan keyin darhol o'chiriladi** (`lib/verification.js`).
  Google formasida "Data is deleted after processing" ni belgilang.

### Photos and videos

| Data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| **Photos** | Yes | Yes | Optional | App functionality |

Avatar va mashina e'loni rasmlari — ommaviy. Tasdiqlash hujjati
rasmi esa **Personal info → Other info** da yuqorida alohida
belgilangan, chunki u ommaviy emas va o'chiriladi.

### Messages

| Data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| **Other in-app messages** | Yes | **No** | Optional | App functionality |

Xabarlar faqat ikki suhbatdoshga ko'rinadi (`api/chat.js`).

### App activity

| Data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| **App interactions** | Yes | No | Optional | App functionality, Personalization |

Saqlangan qidiruvlar, saralangan e'lonlar, saqlangan haydovchilar,
buyurtma tarixi va baholar. Baholar ommaviy — ular **Shared: Yes**
bo'lishi kerak deb hisoblasangiz, shunday belgilang; biz ularni
"App activity" emas, foydalanuvchi profilining bir qismi deb
qaraymiz.

### App info and performance

| Data type | Collected | Shared | Required | Purposes |
|---|---|---|---|---|
| **Crash logs** | No | — | — | — |
| **Diagnostics** | Yes | No | Required | Fraud prevention, security, and compliance |

Sayt joylashgan xizmat (Vercel) so'rovlar jurnalida IP manzil va
brauzer satrini saqlaydi. Biz uni o'qimaymiz va tahlil uchun
ishlatmaymiz, lekin jurnal mavjud — shuning uchun "Yes".

---

## 3. YIG'ILMAYDIGAN ma'lumotlar

Bularning hammasiga **No** deb javob bering. Har biri kodda
tekshirilgan:

| Data type | Nega yo'q |
|---|---|
| **Location** (Approximate, Precise) | `navigator.geolocation` kodda umuman chaqirilmaydi. Xaritada shaharlar orasidagi taxminiy yo'nalish ko'rsatiladi, foydalanuvchining joylashuvi emas |
| **Financial info** | To'lov tizimi yo'q. Ilova pulni ushlab turmaydi, tomonlar o'zaro hisoblashadi |
| **Health and fitness** | Yo'q |
| **Contacts** | Telefon kitobiga murojaat yo'q |
| **Calendar** | Yo'q |
| **Audio** | Mikrofon ishlatilmaydi |
| **Files and docs** | Faqat rasm tanlash (`accept="image/*"`), boshqa fayl olinmaydi |
| **Device or other IDs** | Reklama identifikatori ishlatilmaydi |
| **Web browsing history** | Yo'q |
| **Search history** | Saqlangan qidiruv — bu foydalanuvchi o'zi tuzgan filtr, veb tarixi emas. **App interactions** ichida hisobga olingan |

---

## 4. Reklama va kuzatuv

| Savol | Javob |
|---|---|
| Does your app contain ads? | **No** |
| Is any data used for advertising or marketing? | **No** |
| Is any data shared with third parties for advertising? | **No** |

Saytda reklama tarmoqlari, analitika skriptlari va kuzatuv
piksellari yo'q — buni `index.html` ni qidirib tekshirish mumkin
(`gtag`, `fbq`, `googletagmanager`, `metrika` — hech biri yo'q).

---

## 5. Uchinchi tomon xizmatlari

Ilova quyidagilarga tayanadi. "Shared" savoliga javob berishda
shularni hisobga oling:

| Xizmat | Nima o'tadi | Nega |
|---|---|---|
| **Google** | Kirish (OAuth) paytida pochta va ism | Hisobga kirish |
| **Telegram** | Tasdiqlash kodi va bildirishnoma matni (buyurtma kodi, yo'nalish, tanlovdan keyin telefon raqam) | Kod yuborish va xabar berish |
| **Vercel** | So'rov jurnallari (IP, brauzer) | Sayt joylashuvi |
| **Upstash** | Barcha saqlanadigan ma'lumot | Ma'lumotlar bazasi |
| **Cloudflare R2** | Rasmlar | Fayl saqlagich |
| **OpenStreetMap** | Xarita plitkalari so'ralganda IP | Xarita |

Telegram, Vercel, Upstash va R2 — xizmat ko'rsatuvchilar (service
providers). Google formasi ularni odatda "sharing" deb hisoblamaydi.
Telegram esa alohida: bildirishnoma matni uning serverlaridan o'tadi
va bu foydalanuvchining o'zi yoqadigan narsa. Biz buni maxfiylik
siyosatining 4- va 7-bandlarida ochiq yozganmiz.

---

## 6. Bu javoblar qayerda tekshiriladi

| Da'vo | Fayl |
|---|---|
| Faqat HTTPS | `vercel.json` (HSTS), Vercel sozlamasi |
| Pochta ommaviy emas | `api/order.js` → `getLoadDetail` javobida pochta yo'q |
| Telefon faqat tanlovdan keyin | `api/order.js` → `decideOfferCore`, `getMyLoad` |
| Hujjat qaror chiqarilgach o'chadi | `lib/verification.js`, `api/admin-data.js` |
| O'chirish haqiqatan o'chiradi | `lib/deleteAccount.js`, `test/deleteAccount.test.mjs` |
| Joylashuv olinmaydi | `index.html` da `navigator.geolocation` yo'q |
| Reklama va analitika yo'q | `index.html` da tashqi skript yo'q |
