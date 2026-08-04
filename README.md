# YO'LDA — sayt + Telegram

Sayt orqali buyurtma qabul qilish, haydovchilar guruhiga yuborish va tugma
orqali qabul qildirish tizimi. Ma'lumotlar bazasi kerak emas.

## Qanday ishlaydi

```
Mijoz saytda formani to'ldiradi
        ↓
   /api/order  ← narxni qayta hisoblaydi, bot tokenini yashiradi
        ↓
Telegram guruhi: yuk ma'lumotlari + [✅ Men olaman] tugmasi
        ↓
Haydovchi tugmani bosadi
        ↓
  /api/telegram ← xabarni tahrirlaydi, mijoz raqamini ochadi
        ↓
Haydovchi mijozga qo'ng'iroq qiladi
```

Kim qaysi yukni olgani **Telegram xabarining o'zida** saqlanadi — tugma
o'chadi, o'rniga "OLINDI + haydovchi ismi + mijoz raqami" yoziladi. Shu sababli
baza ham, server ham kerak emas.

---

## O'rnatish — 6 qadam

### 1. Bot yarating

Telegramda [@BotFather](https://t.me/BotFather) ga yozing:

```
/newbot
```

Bot nomini va username'ini kiriting. BotFather sizga **token** beradi —
`1234567890:AAxx...` ko'rinishida. Uni saqlab qo'ying.

### 2. Haydovchilar guruhini yarating

1. Telegramda yangi **guruh** oching (masalan "YO'LDA — Haydovchilar")
2. Botni guruhga qo'shing
3. Botni guruhda **admin** qiling (xabarlarni tahrirlash uchun shart)
4. Guruhda `/id` deb yozing — bot `chat_id` ni qaytaradi (`-100...` bilan boshlanadi)

> Bot guruhda buyruqlarni ko'rishi uchun BotFather'da `/setprivacy` → **Disable**
> qilib qo'ying, aks holda `/id` ishlamaydi.

### 3. Kodni GitHub'ga yuklang

```bash
cd yolda-web
git init
git add .
git commit -m "YO'LDA"
git remote add origin https://github.com/SIZNING-USERNAME/yolda.git
git push -u origin main
```

### 4. Vercel'ga joylang

1. [vercel.com](https://vercel.com) da GitHub bilan kiring
2. **Add New → Project** → repozitoriyni tanlang → **Deploy**
3. Deploy tugagach, **Settings → Environment Variables** bo'limiga o'ting va
   quyidagilarni qo'shing:

| Nomi | Qiymati |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather bergan token |
| `TELEGRAM_GROUP_ID` | `-100...` guruh id'si |
| `TELEGRAM_WEBHOOK_SECRET` | ixtiyoriy tasodifiy so'z, masalan `yolda-2026-xyz` |

4. **Deployments → ⋯ → Redeploy** bosing (o'zgaruvchilar kuchga kirishi uchun)

Saytingiz `https://yolda-xxx.vercel.app` manzilida ochiladi.

### 5. Webhook'ni ulang

Brauzerda quyidagi manzilni oching (o'zingiznikini qo'yib):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://SIZNING-SAYT.vercel.app/api/telegram&secret_token=<WEBHOOK_SECRET>
```

`{"ok":true,...}` javobi kelsa — tayyor.

### 6. Guruh havolasini saytga qo'ying

Guruhda: **Guruh nomi → Edit → Invite Links → havolani nusxalang.**

`index.html` faylida qidiring:

```js
var DRIVER_GROUP_URL = "https://t.me/";
```

va o'z havolangizni qo'ying. Keyin `git commit` + `git push` — Vercel o'zi
qayta joylaydi.

---

## Tekshirish

1. Saytni oching, formani to'ldiring, **Haydovchilarga yuborish** bosing
2. Guruhda yuk e'loni paydo bo'lishi kerak
3. **✅ Men olaman** tugmasini bosing
4. Xabar o'zgaradi: tugma yo'qoladi, mijoz raqami ko'rinadi

Agar ishlamasa:
- **Guruhga xabar kelmadi** → `TELEGRAM_GROUP_ID` noto'g'ri yoki bot guruhda emas
- **Tugma bosilganda hech narsa bo'lmadi** → webhook ulanmagan (5-qadam) yoki bot admin emas
- **Vercel → Logs** bo'limida aniq xato ko'rinadi

---

## Xavfsizlik haqida ochiq gap

Bu tizim kichik boshlanish uchun mo'ljallangan. Bilib qo'yish kerak bo'lgan
cheklovlar:

- **Guruhdagi har kim yukni ola oladi.** Guruhga faqat tanigan haydovchilaringizni
  qo'shing. Haydovchilarni tekshirish tizimi yo'q.
- **Spam himoyasi zaif.** Bir raqamdan daqiqasiga bitta buyurtma cheklovi bor,
  lekin u serverless muhitda to'liq ishonchli emas. Ko'p spam kelsa, formaga
  SMS tasdiqlash qo'shish kerak bo'ladi.
- **Buyurtmalar tarixi saqlanmaydi.** Faqat Telegramdagi xabarlar qoladi.
  Statistika, hisobot yoki "kim qancha yuk tashidi" kerak bo'lsa — baza kerak.

Bular jiddiy muammoga aylansa, avval yozilgan to'liq backend (`yolda-api`)
shu ehtiyojlarni qoplaydi.

---

## Narxni o'zgartirish

Vercel'dagi Environment Variables orqali:

| O'zgaruvchi | Standart | Ma'nosi |
| --- | --- | --- |
| `PRICE_PER_KM` | 2500 | 1 km uchun so'm |
| `PRICE_PER_KG` | 300 | 1 kg uchun so'm |
| `PRICE_MINIMUM` | 150000 | Minimal narx |

Saytdagi ko'rsatiladigan narx ham shu formulaga mos bo'lishi uchun
`index.html` ichidagi `BASE_PER_KM`, `BASE_PER_KG`, `MIN_PRICE`
qiymatlarini ham birga o'zgartiring.

## Fayllar

```
yolda-web/
├── index.html        sayt (dizayn + buyurtma formasi)
├── api/
│   ├── order.js      sayt → Telegram guruh
│   └── telegram.js   tugma bosilishi → xabarni yangilash
├── vercel.json
└── .env.example
```
