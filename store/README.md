# YO'LDA — Play Market'ga chiqarish

Bu papkada do'kon uchun kerak bo'ladigan hamma narsa bor. Tartib
bo'yicha yuring: har bir qadam o'zidan oldingisiga tayanadi.

| Fayl | Nima |
|---|---|
| `listing.md` | Nom, qisqa va to'liq tavsif — uz / ru / en |
| `data-safety.md` | Data safety formasining tayyor javoblari |
| `feature-graphic.png` | 1024×500, do'kon sahifasining tepasiga |
| `screenshots/` | 6 ta telefon rasmi, 1080×2340 |

Rasmlarni qayta yasash kerak bo'lsa:

```bash
# oddiy statik server (loyiha papkasidan)
npx serve . -l 8942     # yoki boshqa server, muhimi 8942-portda

node tools/storeShots.mjs      # ekran rasmlari
node tools/storeGraphic.mjs    # feature graphic
```

---

## 0. Oldindan bilib qo'ying

**Shaxsiy hisob bilan ochsangiz**, Google 2023-yildan beri qo'shimcha
shart qo'yadi: ilovani **12 ta tester 14 kun davomida** sinab
chiqishi kerak, keyin ishlab chiqarishga chiqarish uchun ariza
beriladi. Tashkilot (company) hisobida bu talab yo'q, lekin D-U-N-S
raqami so'raladi.

Bu YO'LDA'ning kamchiligi emas — Google'ning hisob turi bo'yicha
qoidasi. Rejani shunga qarab tuzing.

---

## 1. Play Console hisobi

1. https://play.google.com/console → hisob oching ($25, bir martalik).
2. Hisob turini tanlang: **Personal** yoki **Organization**.
3. Shaxsni tasdiqlash (hujjat) — bir necha kun ketishi mumkin.

---

## 2. Ilovani yarating va paket nomini oling

Console'da **Create app**:

| Maydon | Qiymat |
|---|---|
| App name | `YO'LDA — Yuk bozori` |
| Default language | O'zbek / Uzbek |
| App or game | App |
| Free or paid | Free |

Keyin **Setup → App signing** bo'limiga kiring va
**App signing key certificate → SHA-256 certificate fingerprint**
ni ko'chirib oling.

### 2.1. SHA-256 ni tekshirish — BUNI O'TKAZIB YUBORMANG

Loyihadagi `.well-known/assetlinks.json` da hozir shu barmoq izi
turibdi:

```
93:6C:6D:53:01:62:6A:B9:48:D7:F5:22:E5:C9:D7:98:CA:C3:6E:91:1F:C7:CC:6E:5A:B3:3E:D0:E1:1B:EA:28
```

**Uning qayerdan kelgani noma'lum.** Agar Play Console'dagi barmoq
izi bundan boshqa bo'lsa, `.well-known/assetlinks.json` ni
almashtiring va qayta deploy qiling.

Mos kelmasa nima bo'ladi: ilova ochilganda tepada **brauzerning
manzil qatori** ko'rinib turadi. Ilova ishlaydi, lekin "ilova"ga
o'xshamaydi — veb-sahifaga o'xshaydi.

Deploydan keyin tekshiring:

```bash
curl https://yolda-web.vercel.app/.well-known/assetlinks.json
```

---

## 3. AAB yasash (Bubblewrap) — o'z kompyuteringizda

Bu qadamni men bajara olmayman: konteynerimda Android SDK va Java
yo'q, Google serverlariga chiqish ham yopiq.

Kerak bo'ladi: **Node.js 18+** va **JDK 17**.

```bash
npm install -g @bubblewrap/cli

# Birinchi marta: Bubblewrap JDK va Android SDK ni o'zi yuklab oladi
bubblewrap init --manifest https://yolda-web.vercel.app/manifest.webmanifest
```

`init` savollar beradi. Javoblari:

| Savol | Javob |
|---|---|
| Domain | `yolda-web.vercel.app` |
| URL path | `/` |
| Application name | `YO'LDA — Yuk bozori` |
| Short name | `YO'LDA` |
| Application ID | `uz.yolda.app` ← **aynan shu**, assetlinks shunga yozilgan |
| Display mode | `standalone` |
| Orientation | `portrait` |
| Status bar color | `#0A9F5B` |
| Splash screen color | `#061D13` |
| Icon URL | `https://yolda-web.vercel.app/icons/icon-512.png` |
| Maskable icon URL | `https://yolda-web.vercel.app/icons/icon-maskable-512.png` |
| Include support for Play Billing? | **No** (to'lov yo'q) |
| Request geolocation permission? | **No** (ilova joylashuv so'ramaydi) |

So'ng:

```bash
bubblewrap build
```

Natijada `app-release-bundle.aab` chiqadi — Console'ga shuni
yuklaysiz.

> **Kalitni yo'qotmang.** `bubblewrap init` yasagan
> `android.keystore` fayli va uning paroli — ilovani keyin
> yangilashning yagona yo'li. Yo'qotsangiz, ilovani yangilay
> olmaysiz. Zaxira nusxasini xavfsiz joyda saqlang.

---

## 4. Console'da to'ldiriladigan bo'limlar

### Main store listing

`listing.md` dan ko'chiring. Uchala tilni ham qo'shing:
**Grow → Store presence → Main store listing → Manage translations**.

Rasmlar:

- **App icon** — `icons/icon-512.png`
- **Feature graphic** — `store/feature-graphic.png`
- **Phone screenshots** — `store/screenshots/` ichidagi 6 ta fayl
  (eng kamida 2 tasi kerak, 6 tasi bor)

### App content

| Bo'lim | Javob |
|---|---|
| **Privacy policy** | `https://yolda-web.vercel.app/maxfiylik` |
| **Data safety** | `data-safety.md` dagi javoblar |
| **Data deletion** | `https://yolda-web.vercel.app/hisob-ochirish` |
| **Ads** | No, ilovada reklama yo'q |
| **App access** | Pastga qarang — **MUHIM** |
| **Content rating** | Pastga qarang |
| **Target audience** | 18+ (ilova 18 yoshdan kichiklar uchun emas) |
| **News app** | No |
| **COVID-19 apps** | No |
| **Data safety → financial features** | None |
| **Government apps** | No |

### App access — buni to'g'ri to'ldirmasangiz rad etiladi

Ilovaning asosiy qismi (yuk joylash, taklif yuborish, xabarlar)
kirishni talab qiladi. Google tekshiruvchisi kira olmasa, ilovani
ko'ra olmaydi va rad etadi.

**All or some functionality is restricted** ni tanlang va quyidagini
yozing:

```
Demo account is not required.

The app supports three sign-in methods. The reviewer can use Google
Sign-In with any Google account — it works in the app and creates a
profile immediately, with no approval step and no invitation.

The other two methods (Telegram, and a phone number with a code sent
by a Telegram bot) require a Telegram account and are offered only as
an alternative for local users.

Browsing open loads, the vehicle marketplace and all three legal
pages works without signing in at all.
```

> Agar Google Sign-In tekshiruvchida ishlamasa, o'zingiz telefon
> raqami bilan hisob ochib, uning ma'lumotlarini bu yerga yozing.
> Lekin birinchi urinishda Google yo'li yetarli bo'lishi kerak.

### Content rating

So'rovnomaga javoblar (hammasi **No**, bittasidan tashqari):

| Savol | Javob |
|---|---|
| Violence | No |
| Sexuality | No |
| Language | No |
| Controlled substances | No |
| **Users can interact / communicate with each other** | **Yes** — ilovada xabarlashuv bor |
| Users can share their location with others | No |
| App allows purchase of digital goods | No |
| App contains user-generated content | **Yes** — e'lonlar va xabarlar |

Natija odatda **PEGI 3 / Everyone** bo'ladi.

---

## 5. Chiqarishdan oldingi oxirgi tekshiruv

```bash
npm test                 # hamma server testlari
node tools/buildPrivacy.mjs && node tools/buildDeletion.mjs   # sahifalar yangimi
```

Jonli saytda:

```bash
curl -I https://yolda-web.vercel.app/maxfiylik          # 200
curl -I https://yolda-web.vercel.app/hisob-ochirish     # 200
curl https://yolda-web.vercel.app/.well-known/assetlinks.json
```

Telefonda:

- [ ] Ilova o'rnatiladi va ochiladi
- [ ] Tepada brauzer manzil qatori **yo'q** (assetlinks to'g'ri)
- [ ] Internetsiz ham ochiladi, oq ekran chiqmaydi
- [ ] Google bilan kirish ishlaydi
- [ ] Telefon raqami bilan kirish ishlaydi (kod Telegram'dan keladi)
- [ ] Yuk joylash, taklif yuborish, "Mening yukim" ishlaydi
- [ ] Profil → Akkauntni o'chirish ishlaydi

---

## 6. Vercel sozlamalari

Ilova ishlashi uchun Vercel'da quyidagilar turishi kerak:

| O'zgaruvchi | Nega |
|---|---|
| `APP_URL` | Bildirishnomadagi "Ilovada ochish" tugmasi shu manzilga olib boradi |
| `TELEGRAM_BOT_TOKEN` | Tasdiqlash kodi va bildirishnomalar. **Faqat serverda** |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook'ga faqat Telegram kira olishi uchun |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Ma'lumotlar bazasi (Upstash) |
| `R2_*` | Rasmlar saqlagichi (Cloudflare R2) |
| `ADMIN_*` | Admin paneli |

`APP_URL` hozir `https://yolda-web.vercel.app`. O'z domeningizni
(masalan `yolda.uz`) olsangiz, uni shu yerda almashtirish kifoya —
kodga tegish kerak emas. Lekin unda `assetlinks.json` ham yangi
domenda turishi va Bubblewrap ham yangi domen bilan qayta yasalishi
kerak.
