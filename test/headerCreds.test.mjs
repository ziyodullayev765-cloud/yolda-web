/**
 * Kirish ma'lumoti sarlavhada ketadi, manzilda emas.
 *
 *     node test/headerCreds.test.mjs      (yoki npm test)
 *
 * MUAMMO NIMA EDI. GET so'rovlarda token manzilning o'zida
 * ketardi:
 *
 *   /api/chat?action=thread&googleIdToken=...&phoneToken=...
 *
 * Yozishma har 1,5 soniyada shu manzilga so'rov yuboradi.
 * Manzil esa server loglariga, CDN loglariga va brauzer
 * tarixiga tushadi. Telefon tokeni eng xavflisi — u 30 kun
 * yashaydi.
 *
 * Endi mijoz ularni SARLAVHADA yuboradi. Sarlavha loglarda
 * saqlanmaydi va manzilning bir qismi emas.
 *
 * ESKI SAHIFALAR. Keshdan ochilgan sahifa hali manzilda
 * yuborishi mumkin, shuning uchun manzil ham o'qilaveradi.
 * Bu teshikni ochiq qoldirmaydi: muammo tokenning manzilga
 * YOZILISHI edi, uni o'qish emas.
 *
 * ENG MUHIM TEKSHIRUV eng oxirida: keshlanadigan javoblar
 * kirish ma'lumotini umuman o'qimasligi kerak. Aks holda bitta
 * manzilga kelgan ikki odamning javobi chalkashib ketardi —
 * manzilda endi ularni ajratadigan hech narsa yo'q.
 */
import { credsFrom, CRED_HEADERS } from '../lib/identity.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};
const flow = (name) => console.log('\n── ' + name);

const req = (headers, query) => ({ headers: headers || {}, query: query || {} });

/* ---------------------------------------------------------- */
flow('Sarlavhadan o\'qiladi');
{
  const c = credsFrom(req({
    'x-yolda-google': 'aziz%40example.com',
    'x-yolda-telegram': 'user%3D%7B%22id%22%3A1%7D%26hash%3Dabc',
    'x-yolda-phone': 'v1.aaa.bbb',
  }));
  check('google o‘qildi', c.googleIdToken === 'aziz@example.com', c.googleIdToken);
  check('telegram ochildi', c.telegramInitData === 'user={"id":1}&hash=abc', c.telegramInitData);
  check('telefon tokeni o‘qildi', c.phoneToken === 'v1.aaa.bbb', c.phoneToken);

  /* Sarlavha faqat ASCII qabul qiladi, `initData` da esa lotin
     bo'lmagan belgilar bo'ladi — shuning uchun kodlangan holda
     yuboriladi va shu yerda ochiladi. */
  const kirill = credsFrom(req({ 'x-yolda-telegram': encodeURIComponent('user={"first_name":"Азиз"}') }));
  check('LOTIN BO‘LMAGAN BELGILAR BUZILMAYDI',
    kirill.telegramInitData === 'user={"first_name":"Азиз"}', kirill.telegramInitData);
}

flow('Eski sahifa — manzildan o\'qiladi');
{
  const c = credsFrom(req({}, { googleIdToken: 'eski@example.com', phoneToken: 'v1.x.y' }));
  check('manzildagi google ishlaydi', c.googleIdToken === 'eski@example.com');
  check('manzildagi telefon tokeni ham', c.phoneToken === 'v1.x.y');
}

flow('Sarlavha manzildan ustun');
{
  /* Ikkalasi kelsa, sarlavha olinadi: yangi mijoz manzilni
     tozalaydi, ya'ni ikkalasi birga kelishi faqat o'tish
     davrida bo'ladi va sarlavha ishonchliroq. */
  const c = credsFrom(req(
    { 'x-yolda-google': 'yangi%40example.com' },
    { googleIdToken: 'eski@example.com' },
  ));
  check('SARLAVHA USTUN', c.googleIdToken === 'yangi@example.com', c.googleIdToken);
}

flow('POST tanasi');
{
  const c = credsFrom(req({}), { googleIdToken: 'tana@example.com', phoneToken: 'v1.t.t' });
  check('tanadagi ma’lumot o‘qiladi', c.googleIdToken === 'tana@example.com');
  /* Tartib: sarlavha → tana → manzil. */
  const c2 = credsFrom(req({ 'x-yolda-google': 'bosh%40example.com' }, { googleIdToken: 'manzil@example.com' }),
    { googleIdToken: 'tana@example.com' });
  check('sarlavha hammasidan ustun', c2.googleIdToken === 'bosh@example.com', c2.googleIdToken);
  const c3 = credsFrom(req({}, { googleIdToken: 'manzil@example.com' }), { googleIdToken: 'tana@example.com' });
  check('tana manzildan ustun', c3.googleIdToken === 'tana@example.com', c3.googleIdToken);
}

flow('Hech narsa yo\'q bo\'lganda');
{
  const c = credsFrom(req({}));
  check('hammasi undefined',
    c.googleIdToken === undefined && c.telegramInitData === undefined && c.phoneToken === undefined, c);
  check('bo‘sh so‘rov ham yiqitmaydi', Boolean(credsFrom({})));
  check('umuman yo‘q so‘rov ham', Boolean(credsFrom(undefined)));
  /* Buzuq %-kodlash: sarlavha e'tiborsiz qoldiriladi, lekin
     butun so'rov yiqilmaydi — pastdagi zaxira yo'l ishlashi
     mumkin. */
  const buzuq = credsFrom(req({ 'x-yolda-google': '%E0%A4%A' }, { googleIdToken: 'zaxira@example.com' }));
  check('BUZUQ SARLAVHA SO‘ROVNI YIQITMAYDI',
    buzuq.googleIdToken === 'zaxira@example.com', buzuq.googleIdToken);
  check('bo‘sh sarlavha e’tiborsiz',
    credsFrom(req({ 'x-yolda-google': '' }, { googleIdToken: 'q@example.com' })).googleIdToken === 'q@example.com');
}

flow('Endpointlar o\'sha yagona yo\'ldan o\'tadi');
{
  /* Bitta endpoint qo'lda `req.query.googleIdToken` ni o'qisa,
     o'sha joyda token yana manzilga qaytib qolardi — va buni
     hech kim sezmasdi. */
  const apiDir = join(repo, 'api');
  const files = readdirSync(apiDir).filter((f) => f.endsWith('.js'));
  const qolgan = [];
  files.forEach((f) => {
    const src = readFileSync(join(apiDir, f), 'utf8');
    if (/(req\.query|body)\.(googleIdToken|telegramInitData|phoneToken)/.test(src)) qolgan.push(f);
  });
  check('QO‘LDA O‘QIYDIGAN ENDPOINT QOLMADI', qolgan.length === 0, qolgan);

  const ishlatgan = files.filter((f) =>
    /credsFrom\(/.test(readFileSync(join(apiDir, f), 'utf8')));
  check('kirish talab qiladigan endpointlar credsFrom ishlatadi',
    ishlatgan.length >= 6, ishlatgan);
}

flow('Mijoz tokenni manzilga yozmaydi');
{
  const app = readFileSync(join(repo, 'index.html'), 'utf8');
  check('ko‘chiruvchi bor', /function attachCredentials\(\)/.test(app));
  check('sarlavha nomlari bitta joyda', /var CRED_HEADERS = \{/.test(app));
  /* Mijoz va server bir xil nomlarni bilishi kerak. */
  Object.keys(CRED_HEADERS).forEach((key) => {
    check('"' + key + '" nomi ikkala tomonda bir xil',
      app.includes(CRED_HEADERS[key]), CRED_HEADERS[key]);
  });
  check('manzildan o‘chiriladi', /params\.delete\(key\)/.test(app));
  check('kodlab yuboriladi', /encodeURIComponent\(qiymat\)/.test(app));
}

flow('KESH: keshlanadigan javob kirish ma\'lumotini o\'qimaydi');
{
  /* ENG MUHIM TEKSHIRUV. Manzilda token bo'lmasa, bir xil
     manzilga kelgan ikki odamning javobi chalkashib ketmasligi
     kerak. Shuning uchun qoida: `credsFrom` ishlatadigan javob
     HECH QACHON `Cache-Control: public` qo'ymaydi.

     Hozir keshlanadigan uchta javob bor — config, buyurtma
     raqamlari va ommaviy profil — va ular kirish ma'lumotini
     umuman o'qimaydi. Bu tekshiruv o'sha holatni qo'riqlaydi. */
  const apiDir = join(repo, 'api');
  const files = readdirSync(apiDir).filter((f) => f.endsWith('.js'));
  const xavfli = [];

  files.forEach((f) => {
    const src = readFileSync(join(apiDir, f), 'utf8');
    /* Har bir funksiyani alohida ko'ramiz: bitta faylda ham
       keshlanadigan, ham kirish talab qiladigan amal bo'lishi
       mumkin (api/profile.js aynan shunday). */
    src.split(/\nconst \w+ = async \(/).forEach((bolak) => {
      const keshlanadi = /Cache-Control'\s*,\s*'public/.test(bolak);
      const oqiydi = /credsFrom\(/.test(bolak);
      if (keshlanadi && oqiydi) xavfli.push(f);
    });
  });

  check('KESHLANADIGAN JAVOB KIRISH MA’LUMOTINI O‘QIMAYDI',
    xavfli.length === 0, xavfli);

  /* Va teskarisi: keshlanadigan uchta javob haqiqatan bor —
     tekshiruv bo'sh to'plamda "o'tib ketmasin". */
  const keshli = files.filter((f) =>
    /Cache-Control'\s*,\s*'public/.test(readFileSync(join(apiDir, f), 'utf8')));
  check('keshlanadigan javoblar hamon bor', keshli.length >= 2, keshli);
}

/* ---------------------------------------------------------- */
if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
