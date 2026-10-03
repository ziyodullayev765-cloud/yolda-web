/**
 * Fayl saqlash (lib/storage.js) — Cloudflare R2.
 *
 * Run with:  npm test
 *
 * Imzo (AWS SigV4) shu yerda mustaqil ravishda, Python bilan qaytadan
 * hisoblanadi va taqqoslanadi. Bir xil kodni ikki marta yozib "to'g'ri"
 * deb qo'yishning ma'nosi yo'q: xatoni faqat boshqa til, boshqa
 * amalga oshirish ochib beradi. Python AWS hujjatidagi bayonga
 * qarab yozilgan.
 *
 * Hech qanday so'rov tashqariga chiqmaydi — global.fetch yozib
 * oluvchiga almashtiriladi.
 */
import { execFileSync } from 'child_process';

process.env.R2_ACCOUNT_ID = 'acc123';
process.env.R2_ACCESS_KEY_ID = 'AKIAEXAMPLE';
process.env.R2_SECRET_ACCESS_KEY = 'secretExampleKey';
process.env.R2_BUCKET = 'yolda';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev/';

const storage = await import('../lib/storage.js');

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
};

/* --- fetch recorder --- */
let sent = [];
let nextStatus = 200;
globalThis.fetch = async (url, init) => {
  sent.push({ url, method: init.method, headers: init.headers, body: init.body });
  return { ok: nextStatus < 400, status: nextStatus, text: async () => 'xato', json: async () => ({}) };
};
const reset = () => { sent = []; nextStatus = 200; };

/* ---------------------------------------------------------- */
console.log('\n== sozlash ==');
check('sozlangan deb tanildi', storage.storageConfigured() === true);
check('ochiq havola oxiridagi / olib tashlanadi',
  storage.publicUrlFor('a/b.jpg') === 'https://pub-test.r2.dev/a/b.jpg', storage.publicUrlFor('a/b.jpg'));
check('o\'z havolasi tanildi', storage.isOwnUrl('https://pub-test.r2.dev/x/y.png'));
check('begona havola tanilmaydi', !storage.isOwnUrl('https://example.com/x.png'));
check('havoladan kalit ajratiladi', storage.keyFromUrl('https://pub-test.r2.dev/a/b c.jpg') === 'a/b c.jpg');
check('begona havoladan kalit chiqmaydi', storage.keyFromUrl('https://example.com/a.jpg') === null);

/* ---------------------------------------------------------- */
console.log('\n== imzo (AWS SigV4) ==');
{
  const now = new Date('2026-03-04T05:06:07.000Z');
  const payload = Buffer.from('salom dunyo');
  const signed = storage.signRequest({
    method: 'PUT', key: 'avatar/2026-03/abc.jpg', payload, contentType: 'image/jpeg', now,
  });

  check('manzil to\'g\'ri',
    signed.url === 'https://acc123.r2.cloudflarestorage.com/yolda/avatar/2026-03/abc.jpg', signed.url);
  check('sana sarlavhasi to\'g\'ri', signed.headers['x-amz-date'] === '20260304T050607Z', signed.headers);

  const python = `
import hashlib, hmac, sys
secret, date, region, service = 'secretExampleKey', '20260304', 'auto', 's3'
stamp = '20260304T050607Z'
host = 'acc123.r2.cloudflarestorage.com'
uri = '/yolda/avatar/2026-03/abc.jpg'
payload_hash = hashlib.sha256(b'salom dunyo').hexdigest()
canonical_headers = (
    'content-type:image/jpeg\\n'
    'host:' + host + '\\n'
    'x-amz-content-sha256:' + payload_hash + '\\n'
    'x-amz-date:' + stamp + '\\n')
signed_headers = 'content-type;host;x-amz-content-sha256;x-amz-date'
canonical_request = '\\n'.join(['PUT', uri, '', canonical_headers, signed_headers, payload_hash])
scope = '/'.join([date, region, service, 'aws4_request'])
string_to_sign = '\\n'.join([
    'AWS4-HMAC-SHA256', stamp, scope,
    hashlib.sha256(canonical_request.encode()).hexdigest()])
k = ('AWS4' + secret).encode()
for part in [date, region, service, 'aws4_request']:
    k = hmac.new(k, part.encode(), hashlib.sha256).digest()
sys.stdout.write(hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest())
`;
  const expected = execFileSync('python3', ['-c', python], { encoding: 'utf8' }).trim();
  const got = /Signature=([0-9a-f]+)/.exec(signed.headers.Authorization);
  check('imzo mustaqil hisoblangani bilan bir xil', got && got[1] === expected, { got: got && got[1], expected });
  check('kalit (Credential) to\'g\'ri yozilgan',
    signed.headers.Authorization.includes('Credential=AKIAEXAMPLE/20260304/auto/s3/aws4_request'),
    signed.headers.Authorization);
  check('imzolangan sarlavhalar sanab o\'tilgan',
    signed.headers.Authorization.includes('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date'));

  // Boshqa payload — boshqa imzo. Imzo haqiqatan ham mazmunga bog'liqmi.
  const other = storage.signRequest({
    method: 'PUT', key: 'avatar/2026-03/abc.jpg', payload: Buffer.from('boshqa'), contentType: 'image/jpeg', now,
  });
  check('mazmun o\'zgarsa imzo ham o\'zgaradi', other.headers.Authorization !== signed.headers.Authorization);
}

/* ---------------------------------------------------------- */
console.log('\n== rasm yuklash ==');
{
  reset();
  const png = Buffer.from('fake-png-bytes');
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const result = await storage.uploadImage(dataUrl, 'avatar', 400 * 1024);

  check('yuklandi va havola qaytdi', Boolean(result && result.url), result);
  check('havola ochiq manzildan boshlanadi', result.url.startsWith('https://pub-test.r2.dev/avatar/'), result.url);
  check('kengaytma turidan olinadi', result.url.endsWith('.png'), result.url);
  check('kalit taxmin qilib bo\'lmaydi', /\/[0-9a-f]{32}\.png$/.test(result.url), result.url);
  check('bitta PUT so\'rov ketdi', sent.length === 1 && sent[0].method === 'PUT', sent.length);
  check('fayl o\'zi yuborildi', Buffer.compare(sent[0].body, png) === 0);
  check('turi ko\'rsatildi', sent[0].headers['content-type'] === 'image/png', sent[0].headers);

  reset();
  const big = await storage.uploadImage(`data:image/png;base64,${Buffer.alloc(900).toString('base64')}`, 'avatar', 500);
  check('katta fayl rad etiladi', Boolean(big.error), big);
  check('rad etilganda so\'rov ketmaydi', sent.length === 0);

  reset();
  check('noto\'g\'ri format rad etiladi', Boolean((await storage.uploadImage('salom', 'avatar', 1000)).error));
  check('zararli turdagi fayl rad etiladi',
    Boolean((await storage.uploadImage('data:text/html;base64,PHNjcmlwdD4=', 'avatar', 1000)).error));

  reset();
  const already = await storage.uploadImage('https://pub-test.r2.dev/avatar/2026-03/x.png', 'avatar', 1000);
  check('yuklangan rasm ikkinchi marta yuklanmaydi', already.unchanged === true && sent.length === 0, already);

  reset();
  nextStatus = 500;
  const broken = await storage.uploadImage(dataUrl, 'avatar', 400 * 1024);
  check('R2 javob bermasa xato qaytadi', Boolean(broken.error), broken);
}

/* ---------------------------------------------------------- */
console.log('\n== o\'chirish ==');
{
  reset();
  check('fayl o\'chiriladi', (await storage.deleteObject('avatar/2026-03/abc.jpg')) === true);
  check('DELETE so\'rovi ketdi', sent.length === 1 && sent[0].method === 'DELETE', sent);
  reset();
  nextStatus = 404;
  check('yo\'q fayl xato hisoblanmaydi', (await storage.deleteObject('yo-q.jpg')) === true);
  reset();
  check('kalitsiz o\'chirish so\'rov yubormaydi',
    (await storage.deleteObject('')) === false && sent.length === 0);
}

/* ---------------------------------------------------------- */
console.log('\n== sozlanmagan holat ==');
{
  // Sozlamalar yo'q bo'lsa ilova avvalgidek ishlashi kerak: xato ham
  // emas, yolg'on "saqlandi" ham emas — shunchaki "men yo'qman".
  const clean = { ...process.env };
  delete process.env.R2_ACCOUNT_ID;
  const fresh = await import('../lib/storage.js?no-config');
  check('sozlanmagan deb tanildi', fresh.storageConfigured() === false);
  check('yuklash null qaytaradi (eski yo\'l qoladi)',
    (await fresh.uploadImage('data:image/png;base64,AAAA', 'avatar', 1000)) === null);
  check('o\'chirish ham jim o\'tadi', (await fresh.deleteObject('a.jpg')) === false);
  Object.assign(process.env, clean);
}


console.log('\n== R2 xatosi sababni aytadi ==');
{
  // R2 xato sababini XML <Code> bo'lagida aytadi — admin panelda
  // aynan shu ko'rinishi kerak, aks holda nima qilish noma'lum.
  const withBody = (status, body) => {
    globalThis.fetch = async () => ({ ok: false, status, text: async () => body, json: async () => ({}) });
  };

  withBody(401, '<?xml version="1.0"?><Error><Code>InvalidAccessKeyId</Code>'
    + '<Message>The Access Key Id you provided does not exist</Message></Error>');
  let r = await storage.putObject('icon/a.png', Buffer.from('x'), 'image/png');
  check('401 javobida holat raqami ko\'rsatiladi', /401/.test(r.error), r.error);
  check('401 javobida R2 ning xato kodi ko\'rsatiladi', /InvalidAccessKeyId/.test(r.error), r.error);

  withBody(403, '<Error><Code>SignatureDoesNotMatch</Code></Error>');
  r = await storage.putObject('icon/a.png', Buffer.from('x'), 'image/png');
  check('imzo xatosi ajratib ko\'rsatiladi', /SignatureDoesNotMatch/.test(r.error), r.error);

  withBody(500, 'oddiy matn, XML emas');
  r = await storage.putObject('icon/a.png', Buffer.from('x'), 'image/png');
  check('kod topilmasa ham holat raqami qoladi', /500/.test(r.error), r.error);

  withBody(403, '<Error><Code>' + 'x'.repeat(200) + '</Code></Error>');
  r = await storage.putObject('icon/a.png', Buffer.from('x'), 'image/png');
  check('uzun kod javobga tushmaydi', r.error.length < 120, r.error.length);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
