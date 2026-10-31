# Xavfsizlik auditi — YO'LDA

Sana: 2026-10-31 · Tekshirilgan: `api/*.js`, `lib/*.js`, `index.html`,
`admin.html`, `vercel.json` va Vercel'dagi muhit o'zgaruvchilari
ro'yxati (nomlar, qiymatlar emas).

Audit bosqichida **hech qanday fayl o'zgartirilmadi**. Tuzatishlar
keyingi commit'da qilindi — har bir band ostida nima qilingani
yozilgan.

Maxfiy kalitlarning qiymatlari bu hujjatda yo'q va bo'lmaydi.

## Holat

| № | Nima | Holat |
|---|------|-------|
| 1 | Telegram webhook siri ixtiyoriy | ✅ tuzatildi |
| 2 | Admin cookie kaliti bo'sh bo'lishi mumkin | ✅ tuzatildi |
| 3 | Kirish tokenlari URL ichida | ✅ tuzatildi |
| 4 | Suhbatdoshning pochta manzili ko'rinadi | ✅ tuzatildi |
| 5 | `/api/support` cheklanmagan | ✅ tuzatildi |
| 6 | `GET /api/admin-login` daftarni o'qimaydi | ✅ tuzatildi |
| 7 | `markPaid` atomik emas | ✅ tuzatildi |
| 8 | Pul qaytarilsa premium qoladi | ✅ tuzatildi |
| 9 | Iframe himoyasi yo'q | ✅ tuzatildi |
| 10 | Raqamni tekshirib chiqish (IP chegarasi yo'q) | ✅ tuzatildi |
| 11 | Ochiq GET'larda chegara yo'q | 👤 Vercel Firewall (sozlama) |
| 12 | `lib/staff.js` dagi izoh yolg'on | ✅ tuzatildi |
| 13 | Avatar zaxira yo'li bazaga yoziladi | ✅ productionda ishlamaydi |
| 14 | Vercel izohida parolga o'xshash matn | 👤 faqat siz |
| + | Moderator pasport rasmini ko'ra olardi | ✅ tuzatildi |
| + | Buzuq cookie 500 qaytarardi | ✅ tuzatildi |

---

## Yaxshi ishlangan joylar (tekshirildi, muammo topilmadi)

Ro'yxat qisqa bo'lgani uchun emas, haqiqatan to'g'ri bo'lgani uchun:

- **Telegram `initData` tekshiruvi** (`lib/telegramAuth.js`) Telegram
  hujjatidagi sxemaning to'g'ri amalga oshirilishi: HMAC, `timingSafeEqual`,
  `auth_date` bo'yicha 24 soatlik takror-hujum oynasi. Mijozning
  `initDataUnsafe` iga ishonilmaydi.
- **Parol saqlash** (`lib/phoneAuth.js`): scrypt, har parolga alohida tuz,
  vaqt bo'yicha bir xil taqqoslash. Parol almashtirilganda `pv` oshadi va
  eski qurilmalardagi tokenlar darhol kuchini yo'qotadi.
- **To'lov**: summa har doim SERVERDA hisoblanadi, mijoznikiga qaralmaydi;
  Payme `Basic` sarlavhasi va Click MD5 imzosi `timingSafeEqual` bilan;
  `markPaid` ikki marta mahsulot bermaydi.
- **Admin ruxsatlari** (`lib/adminAuth.js` + `api/admin-data.js`): har bir
  `resource`/`action` uchun ruxsat jadvalga yozilgan va **dispatch'dan
  oldin** tekshiriladi. Ilova hisobi bilan kirgan odamning roli har
  so'rovda daftardan qayta o'qiladi — ro'yxatdan chiqarilsa, shu zahoti
  kira olmaydi.
- **Yozishmalar**: har bir suhbat kaliti ikkala tomon identity'sidan
  yasaladi (`pairKey`), ya'ni ruxsat kalitning o'zida — begona odamning
  yozishmasini so'rab bo'lmaydi. AI suhbatlari ham shunday
  (`aiThread:<kim>:<id>`).
- **SSRF**: `/icon/...` endpoint'i manzilni mijozdan olmaydi — domen
  sozlamadan, yo'l esa qat'iy shablon bo'yicha (`api/config.js`).
- **XSS**: `index.html` dagi `escapeHtml` va `admin.html` dagi `esc`
  hamma joyda qo'llangan. `linkifyPhones` qochirishdan KEYIN ishlaydi —
  tartib to'g'ri. Admin panelga tushadigan begona matn (shikoyat, support
  xabari) ham qochiriladi.
- **Maxfiy kalitlar**: frontendga faqat ochiq qiymatlar beriladi
  (`GOOGLE_CLIENT_ID`, `VAPID_PUBLIC_KEY`, bot `@username`). Bot tokeni,
  R2 kaliti, Gemini kaliti, KV tokeni — hech qaysi javobda yo'q.
  Gemini xato MATNI ham mijozga uzatilmaydi, faqat holat kodi.

---

## Topilganlar

### O'RTA

#### 1. Telegram webhook siri ixtiyoriy — o'chirilsa, akkaunt o'g'irlanadi

`api/telegram.js:197`

```js
if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
```

`WEBHOOK_SECRET` bo'sh bo'lsa, shart umuman ishlamaydi va endpoint
hammaga ochiq qoladi. Unda hujumchi o'zi yasagan "update" yuborib:

1. `handleContact` dagi `contact.user_id === message.from.id` tekshiruvini
   o'tadi — chunki ikkala qiymat ham o'sha soxta so'rovning ichida;
2. `phoneChat:<raqam>` ni O'ZINING chat id'siga yozadi;
3. keyin saytdan o'sha raqam uchun kod so'raydi va **kod hujumchining
   Telegramiga keladi**.

Ya'ni istalgan raqam egasining akkauntiga kirish. Hozir `TELEGRAM_WEBHOOK_SECRET`
Vercel'da **qo'yilgan**, shuning uchun bu hozir ishlamaydi — lekin bitta
o'zgaruvchi o'chirilsa, ilova jim turib eng og'ir teshikni ochadi.

**Tuzatish:** sir yo'q bo'lsa endpoint umuman javob bermasin.

#### 2. Admin cookie kaliti bo'sh bo'lib qolishi mumkin

`lib/adminAuth.js:35-36`

```js
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ADMIN_PASSWORD;
```

Ikkalasi ham yo'q bo'lsa `SECRET === ''` — imzo bo'sh kalit bilan
qo'yiladi, ya'ni uni har kim hisoblab, o'ziga `SUPER_ADMIN` cookie
yozib olishi mumkin. Hozir `ADMIN_PASSWORD` qo'yilgan, demak
ishlamaydi; lekin bu ham jim buziladigan holat.

Yana ikkita kichik gap shu yerda:
- imzo kaliti sifatida **parolning o'zi** ishlatiladi. Parol almashtirilsa
  hamma sessiya uziladi (bu yomon emas), lekin bitta sir ikki vazifani
  bajaryapti;
- `TELEGRAM_WEBHOOK_SECRET` ham ikki joyda: webhook uchun ham, cookie
  imzosi uchun ham.

**Tuzatish:** kalit bo'sh bo'lsa sessiya umuman berilmasin va
tekshirilmasin.

#### 3. Kirish tokenlari manzil (URL) ichida yuborilyapti

`api/chat.js`, `api/order.js`, `api/trucks.js`, `api/profile.js` —
hamma GET so'rovlar:

```
/api/chat?action=thread&googleIdToken=...&telegramInitData=...
```

Yozishma har **1,5 soniyada** shu manzilga so'rov yuboradi. Manzil esa
server loglariga, CDN loglariga, brauzer tarixiga va (tashqi havola
bosilsa) `Referer` sarlavhasiga tushadi. `Referrer-Policy:
strict-origin-when-cross-origin` so'rovning savol qismini kesadi, ya'ni
`Referer` tomoni yopiq — lekin **loglar** ochiq qoladi.

Bu token'lar qisqa muddatli (Google ID token ~1 soat, telefon tokeni
30 kun). Telefon tokeni eng xavflisi.

**Tuzatildi.** Endi mijoz ularni sarlavhada yuboradi
(`x-yolda-google`, `x-yolda-telegram`, `x-yolda-phone`). Sarlavha
loglarda saqlanmaydi va manzilning bir qismi emas.

Mijoz tomonida o'zgarish BITTA joyda: `fetch` o'ramchisi
(`attachCredentials`). U GET manzilidan uchala parametrni olib
tashlaydi va sarlavhaga ko'chiradi — ya'ni ~30 ta chaqiruv joyining
birortasi tegilmadi.

Server tomonida ham bitta joyda: `lib/identity.js` dagi `credsFrom(req, body)`
— avval sarlavha, keyin tana, keyin manzil. Manzil hamon o'qilaveradi,
shuning uchun keshdan ochilgan eski sahifa ishlashda davom etadi;
bu teshikni ochiq qoldirmaydi, chunki muammo tokenning manzilga
YOZILISHI edi, uni o'qish emas.

Ikkita ehtiyot chorasi:

- Telegram `initData` sida lotin bo'lmagan belgilar bo'ladi,
  sarlavha esa faqat ASCII qabul qiladi — qiymat
  `encodeURIComponent` bilan ketadi va serverda ochiladi;
- **kesh.** Manzilda token bo'lmasa, bir xil manzilga kelgan ikki
  odamning javobi chalkashib ketmasligi kerak. Qoida:
  `credsFrom` ishlatadigan javob hech qachon `Cache-Control: public`
  qo'ymaydi. Hozir keshlanadigan uchta javob (config,
  `order?action=stats`, `profile?action=public`) kirish ma'lumotini
  umuman o'qimaydi — buni `test/headerCreds.test.mjs` qo'riqlaydi.

#### 4. Suhbatdoshning haqiqiy pochta manzili ko'rinadi

`api/chat.js` — `getInbox` javobida `email: otherEmail`. Google bilan
kirgan odam uchun bu uning **haqiqiy Gmail manzili**.

Yo'li: `?action=search` bilan istalgan `@username` ni topish →
unga bitta xabar yozish → `?action=inbox` dan uning pochtasini olish.

Kodning o'zi bu xavfni boshqa joyda tan olgan ("Google bilan kirganlarda
u — haqiqiy pochta manzili") va uni ISM sifatida ko'rsatmaydi, lekin
javobning ichida baribir yuboradi.

**Tuzatish:** suhbatni `username` bo'yicha adreslash yoki identity
o'rniga qaytarilmaydigan belgi (hash) berish. Bu ham mijoz+server
o'zgarishi, shuning uchun alohida bosqich.

#### 5. `api/support.js` — kirishsiz, cheksiz yozish

Endpoint ataylab ochiq (kira olmagan odam ham yoza olsin) va bu to'g'ri.
Lekin:

- `kvPush('support_messages', ...)` da **hech qanday chegara yo'q** —
  ro'yxat cheksiz o'sadi (Upstash bepul tarifi: 256 MB);
- throttle `Map` da, ya'ni har bir lambda nusxasida alohida, va
  `x-forwarded-for` bo'yicha — uni so'rovda yozib yuborish mumkin.

Natija: bir kishi admin panelining "Xabarlar" bo'limini ham, bazani ham
to'ldirib tashlashi mumkin.

**Tuzatish:** ro'yxatni `LTRIM` bilan cheklash (masalan oxirgi 500 ta) va
raqamni bazadagi hisoblagich bilan cheklash.

### PAST

#### 6. `GET /api/admin-login` daftarni qayta o'qimaydi

`api/admin-login.js:94` — `readAdminSession` (faqat cookie), `resolveAdmin`
emas. Ro'yxatdan chiqarilgan xodimga panel "kirgansiz" deb ko'rsatadi.
**Ma'lumot bermaydi** — hamma `resource`/`action` to'g'ri tekshiradi va
401 qaytaradi — ya'ni bu faqat chalkash ko'rinish.

#### 7. `markPaid` atomik emas

`lib/payments.js:168`. Ikkita `PerformTransaction` ayni paytda kelsa,
ikkalasi ham `state !== 'PAID'` ni ko'rib, premiumni ikki marta
qo'shishi mumkin. Ehtimoli past (to'lov tizimlari so'rovni ketma-ket
yuboradi), lekin qulf yo'q.

#### 8. Pul qaytarilsa premium qolib ketadi

`markCancelled` premiumni bekor qilmaydi. To'langandan keyin bekor
qilingan hisobda (Payme holati −2) odam pulni ham, premiumni ham olib
qoladi.

#### 9. Sahifani boshqa saytga joylashdan himoya yo'q

`vercel.json` da faqat `X-Content-Type-Options` va `Referrer-Policy` bor.
Yo'q: `X-Frame-Options` / `frame-ancestors`, `Strict-Transport-Security`,
`Permissions-Policy`.

Eng muhimi — **`/admin`** ni begona sayt iframe ichiga olib, ustiga
shaffof tugma qo'yib bosdirishi mumkin (clickjacking). Ilovaning o'zi
uchun `DENY` qo'yib bo'lmaydi: u Telegram Mini App ichida, ya'ni
iframe'da ishlaydi. Shuning uchun faqat `/admin` ga.

#### 10. Raqamni tekshirib chiqish (enumeration)

`register-start` ro'yxatdan o'tgan raqamga 409, `login-start`
o'tmaganiga 404 qaytaradi — demak forma "bu raqam bizda bormi" degan
savolga javob beradigan vositaga aylanadi. `login` ning o'zi bunday
qilmaydi (atayin, izohda yozilgan), lekin boshqa ikkitasi qiladi.

Raqam bo'yicha chegara bor (soatiga 5 ta), **IP bo'yicha yo'q**. Har bir
urinish, agar raqam botga ulangan bo'lsa, egasiga haqiqiy Telegram
xabari yuboradi — ya'ni begonani bezovta qilish vositasi ham.

#### 11. Ochiq GET'larda chegara yo'q

`?action=detail`, `?resource=life`, ommaviy profil — hammasi kirishsiz
va chegarasiz, har biri bir nechta KV buyrug'i sarflaydi. Upstash bepul
tarifida oyiga 500 000 buyruq. Buni tashqaridan tugatib qo'yish mumkin.

**Kodda tuzatilmadi va buning sababi bor.**

Birinchi o'yga keladigan yechim — IP bo'yicha hisoblagich — bu yerda
ishlamaydi: hisoblagichning o'zi KV buyrug'i sarflaydi, `x-forwarded-for`
esa so'rovda yoziladi, ya'ni har bir soxta manzil YANGI kalit yasaydi.
Natijada himoya hujumning o'zidan ko'ra ko'proq sarflaydi.

Ikkinchi fikr — javobni CDN'da keshlash — `?action=detail` uchun
**xavfli**: uning javobida `driverContact` bor va u faqat yuk egasiga
beriladi. Kirish ma'lumoti endi sarlavhada ketgani uchun manzil hamma
uchun bir xil, ya'ni `public` kesh qo'yilsa, CDN haydovchining telefonini
begonaga ham berib yuborardi. (Shu sababli `credsFrom` ishlatadigan
javobga `Cache-Control: public` qo'yish taqiqlangan — `test/headerCreds.test.mjs`
buni qo'riqlaydi.)

**Haqiqiy yechim — platformada:** Vercel → Firewall → Rate Limiting.
U so'rovni chekkada, lambda ishga tushishidan oldin to'xtatadi, ya'ni
na KV buyrug'i, na funksiya vaqti sarflanadi. Bu kod bilan emas,
sozlama bilan qilinadi.

#### 12. `lib/staff.js` dagi izoh endi YOLG'ON

Fayl boshida:

> **MUHIM — BU KIRISH HUQUQI EMAS.** Daftarga yozilgani hech kimga
> panelga kirish imkonini bermaydi...

Bu `api/admin-login.js` yozilgunga qadar to'g'ri edi. Endi daftardagi
yozuv **aynan kirish huquqi**. Admin panelning o'zida matn to'g'ri
("Bu panelga kirish huquqini ham beradi", `admin.html:5324`), ya'ni
foydalanuvchi adashmaydi — lekin kodni keyin o'qiydigan odam adashadi.

#### 13. Avatar zaxira yo'li bazaga yoziladi

`api/profile.js` — R2 ishlamasa, 400 KB gacha `data:` matn Redis'ga
yoziladi.

**Tekshirildi: productionda bu yo'l umuman ishlamaydi.** R2 ning to'rtala
kaliti (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`) Vercel'da qo'yilgan, ya'ni rasm doim omborga
tushadi. Bu zaxira yo'l faqat mahalliy ishga tushirishda (R2 siz)
ishlaydi va o'sha yerda u foydali — avatar umuman saqlanmasligidan
yaxshiroq.

Shuning uchun kod o'zgartirilmadi: ishlayotgan va zarari yo'q yo'lni
sababsiz buzishning ma'nosi yo'q. Hajm chegarasi (400 KB) allaqachon
bor.

#### 14. Vercel'da izoh maydonida parolga o'xshash matn

`TELEGRAM_BOT_TOKEN` o'zgaruvchisining **izoh (comment)** maydonida
parolga o'xshash so'z turibdi. Qiymatning o'zi shifrlangan, izoh esa
shifrlanmagan va API orqali ochiq ko'rinadi. Qiymatini bu yerda
yozmayman — Vercel → Settings → Environment Variables da o'sha izohni
tozalash kerak.

---

## Muammo emas, lekin bilib turish kerak

- **Baho hamma uchun ochiq.** Buyurtmasiz ham baho berish mumkin —
  bu egasining o'z qarori (`api/profile.js:741` dagi izoh). Uchta to'siq
  qolgan: kirish shart, bir juftlikka bir ovoz, o'ziga bo'lmaydi.
  Tavsiya: bir odam bir kunda nechta baho bera olishini cheklash,
  shunda yangi yasalgan akkauntlar bilan birovni "ko'mib" bo'lmaydi.
- **Xotiradagi throttle'lar** (`chat`, `support`, `admin-login`) har bir
  lambda nusxasida alohida — bu kodda ochiq yozilgan va to'g'ri
  tushunilgan: ular tezlik to'sig'i, haqiqiy chegara emas.
- **`AUTH_SECRET` qo'yilmagan**, shuning uchun telefon tokenlarining
  imzosi bot tokenidan hosil qilinadi. Ishlaydi, lekin bot tokeni
  almashtirilsa hamma telefon foydalanuvchisi chiqib ketadi.
- **`ADMIN_PASSWORD_ACCOUNTANT` yo'q**, ya'ni Hisobchi roli parol bilan
  kira olmaydi (xodimlar daftari orqali kiradi).
- **Payme/Click kalitlari qo'yilmagan**, shuning uchun `/api/pay`
  ikkala tizim uchun ham "sozlanmagan" deb rad etadi — to'lov
  ishlayotgandek ko'rinmaydi. Bu to'g'ri xatti-harakat.
