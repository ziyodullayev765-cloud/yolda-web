# Ishonch darajasi

## Nima bu

Odamning profilida turadigan daraja: **Yangi → Boshlang'ich →
Ishonchli → Tasdiqlangan** (va alohida — **Cheklangan**).

Bu **"bu odam halol" degan kafolat emas** va shunday deb
ko'rsatilmaydi ham. Hech qanday raqam odamning niyatini bilmaydi.
Yolg'on kafolat esa kafolatsizlikdan battar: odam unga ishonib
ehtiyotkorligini yo'qotadi.

Bu — **odam o'zi tekshirib oladigan narsalarning yig'indisi**:
nimasi tasdiqlangan, nechta yuk yetkazgan, qanday baho olgan.

Shuning uchun daraja hech qachon yakka ko'rsatilmaydi — doim
tarkibi bilan birga. «72 ball» hech narsa demaydi; «telefoni va
pasporti tasdiqlangan, 14 ta yuk yetkazgan, 9 ta bahodan 4,8» —
buni odam o'zi o'qiydi va o'zi qaror qiladi.

Profilda, eng ostida, shu qator turadi:

> Bu daraja — tekshirib bo'ladigan narsalarning yig'indisi,
> kafolat emas. YO'LDA tomonlar o'rtasidagi kelishuvga javob
> bermaydi.

## Nimadan hisoblanadi

Hammasi profildagi **haqiqiy** ma'lumotdan. Hech narsa o'ylab
topilmaydi va hech qanday «namuna» qiymat yo'q.

| Nima | Ball | Qayerdan |
|------|------|----------|
| Shaxs hujjati tasdiqlangan | 25 | moderator ko'rgan (`lib/verification.js`) |
| Telefon raqami tasdiqlangan | 20 | Telegram bot tasdiqlagan |
| Yetkazilgan yuklar | 20 | `deliveredCount` — buyurtma DELIVERED bo'lganda oshadi |
| Baho | 15 | `ratingCount/Sum` va `ownerRating*` |
| Haydovchilik guvohnomasi | 10 | moderator ko'rgan |
| Texnik pasport | 10 | moderator ko'rgan |

Jami **100**.

**Darajalar:** 0–19 Yangi · 20–44 Boshlang'ich · 45–69 Ishonchli ·
70+ Tasdiqlangan.

Chegaralar ataylab baland: «Tasdiqlangan» degan so'z hujjatlarsiz
va ish tarixisiz chiqmasligi kerak. To'rtala hujjat tasdiqlangan
odam ham (65 ball) hali «Ishonchli» — unga ish tarixi yoki baho
kerak.

## Qasddan qo'yilgan cheklovlar

**Yetkazishlar 10 tadan keyin to'ladi.** 100 ta yuk 10 tadan
«o'n barobar ishonchli» degani emas.

**Baho kamida 3 ta ovozdan keyin sanaladi.** Bitta beshlik hech
narsa demaydi. Lekin ovozlar soni baribir ko'rsatiladi: «2 ta
baho — o'rtacha uchun hali kam». «Hali yo'q» deb ko'rsatib,
aslida ikkitasi borligini yashirish odamni chalg'itardi.

**Faqat tasdiqlangani sanaladi.** Kutilayotgan yoki rad etilgan
so'rov ball bermaydi — aks holda «so'rov yuboraman» degan bitta
harakat ishonch yasab berardi.

**A'zolik muddati ballga kirmaydi.** Uzoq turish o'zi ishonch
bermaydi. Lekin ko'rsatiladi — odam o'zi hisobga olsin.

**Cheklangan hisob uchun daraja umuman hisoblanmaydi.** Bu admin
chiqargan qaror va u hamma narsadan ustun turadi: hujjatlari
to'liq bo'lsa ham daraja «Cheklangan» bo'lib qoladi.

## Nega shikoyatlar hisobga olinmaydi

Shikoyat bor, lekin uning holatlari (NEW, INVESTIGATING,
CONTACTED, RESOLVED, BANNED) «shikoyat **o'rinli** edimi» degan
savolga javob bermaydi: RESOLVED ham «tasdiqlandi», ham «asossiz
ekan» degani bo'lishi mumkin.

Shuning uchun ularni ballga aylantirish — mavjud bo'lmagan hukmni
o'ylab topish bo'lardi. Odamga shikoyat tushgani uchun ball
tushirish esa eng og'ir xato: shikoyatni istalgan kishi yoza
oladi.

Agar keyinroq shikoyatga «o'rinli / asossiz» degan aniq holat
qo'shilsa, uni hisobga qo'shish mumkin bo'ladi.

## Qayerda ko'rinadi

1. **Ilovada** — odamning ommaviy profilida (`@username` ni
   bosganda). Eski «Tasdiqlangan» ro'yxatining o'rnida turadi:
   u faqat **bor** narsani ko'rsatardi, bu esa to'liq —
   tasdiqlanmagani ham o'z qatorida, bo'sh doira bilan.

2. **Admin panelda** — foydalanuvchilar jadvalida ustun bo'lib va
   foydalanuvchi sahifasida to'liq tarkibi bilan.

## Qayerda hisoblanadi

Faqat **serverda**: `lib/trust.js`. Ilova ham, panel ham uni
qaytadan hisoblamaydi — aks holda moderator ko'rgan daraja
foydalanuvchi ko'rgan daraja bilan bir kuni albatta ajralib
ketardi.

Bazada alohida saqlanmaydi: profilning o'zidan hisoblanadi.
Shuning uchun u eskirib qolmaydi va «qachon qayta hisoblash
kerak» degan savol umuman tug'ilmaydi.

## Tekshirilgan

- `test/trust.test.mjs` — 76 ta (hisob, chekka holatlar, buzuq
  yozuvlar, ikkala ekrandagi ko'rinish).
- Brauzerda: ilovadagi profil 25 ta, admin panel 11 ta —
  yorug' va qorong'i mavzuda.
