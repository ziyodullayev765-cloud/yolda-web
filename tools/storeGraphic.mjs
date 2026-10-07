/**
 * Play Market uchun "feature graphic" — 1024x500.
 *
 *     node tools/storeGraphic.mjs
 *
 * Do'kon sahifasining tepasida va tavsiya ro'yxatlarida turadigan
 * yagona rasm. Play qoidasi: aynan 1024x500 px, PNG yoki JPEG,
 * shaffof joy bo'lmasin.
 *
 * Muhim jihati: bu rasm ko'pincha KICHRAYTIRILIB ko'rsatiladi va
 * ustiga "Install" tugmasi bilan ilova nomi tushadi. Shuning uchun
 * unda mayda yozuv yo'q — faqat belgi, nom va bitta qatorli gap.
 * Chetlarda ham bo'sh joy qoldirilgan: kesilsa ham hech narsa
 * yo'qolmaydi.
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, 'store');

const html = `<!doctype html>
<html lang="uz"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{width:1024px;height:500px;overflow:hidden;}
  body{
    /* Ilovaning o'z yashili. Chapdan o'ngga qorayib boradi —
       o'ng tarafdagi oq belgi shu fonda yaxshi o'qiladi. */
    background:
      radial-gradient(900px 500px at 78% 18%, rgba(46,212,122,0.30), transparent 62%),
      linear-gradient(118deg, #04120C 0%, #06361F 46%, #0A9F5B 100%);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:#fff;display:flex;align-items:center;
    position:relative;
  }

  /* Yo'l: pastdan o'ngga ketadigan ingichka chiziq. Bu — ilovaning
     nomi ("yo'lda") va belgisidagi shaklning davomi, bezak emas. */
  .road{position:absolute;inset:0;}

  .inner{position:relative;padding:0 72px;max-width:700px;}
  .brandline{display:flex;align-items:center;gap:20px;margin-bottom:26px;}
  .mark{width:84px;height:84px;border-radius:22px;flex:none;
        box-shadow:0 14px 40px rgba(0,0,0,0.38);}
  .name{font-size:58px;font-weight:800;letter-spacing:0.01em;line-height:1;}
  .tag{
    font-size:29px;font-weight:600;line-height:1.3;color:#E6F6EC;
    max-width:600px;letter-spacing:-0.01em;
  }
  .tag b{color:#fff;font-weight:800;}
</style></head><body>

  <svg class="road" viewBox="0 0 1024 500" aria-hidden="true">
    <path d="M -60 560 C 300 470, 560 400, 1120 150"
          fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="86"/>
    <path d="M -60 560 C 300 470, 560 400, 1120 150"
          fill="none" stroke="rgba(255,255,255,0.40)" stroke-width="4"
          stroke-dasharray="30 26" stroke-linecap="round"/>
  </svg>

  <div class="inner">
    <div class="brandline">
      <svg class="mark" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="26" fill="#0A9F5B"/>
        <path d="M18 86 L42 24 H58 L82 86 Z" fill="#FFFFFF"/>
        <g fill="#0A9F5B">
          <rect x="46.4" y="68" width="7.2" height="11" rx="1.6"/>
          <rect x="47.2" y="49" width="5.6" height="9" rx="1.3"/>
          <rect x="47.8" y="33" width="4.4" height="7" rx="1"/>
        </g>
      </svg>
      <span class="name">YO'LDA</span>
    </div>
    <p class="tag">Yuk beruvchi va haydovchi<br><b>bir yo'lda uchrashadi</b></p>
  </div>

</body></html>`;

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const tmp = join(OUT, '.feature.tmp.html');
  writeFileSync(tmp, html);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.goto('file://' + tmp, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const out = join(OUT, 'feature-graphic.png');
  await page.screenshot({ path: out });
  await browser.close();
  rmSync(tmp, { force: true });
  console.log('olindi:', out);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
