/**
 * Ochiq hujjat sahifasining qolipi.
 *
 * Play Market ikkita sahifani ochiq manzilda talab qiladi:
 * maxfiylik siyosati va akkauntni o'chirish. Ikkalasi ham bir xil
 * ishlaydi — uchta tildagi matn, tepada til tanlovi, kirish yo'q —
 * shuning uchun qolip bitta joyda turadi.
 *
 * Sahifa ataylab o'zi yetarli: tashqaridan na shrift, na skript
 * yuklanadi. Tekshiruvchi uni sekin internetda, boshqa mamlakatdan
 * va hech qayerga kirmasdan ocha olishi kerak. Skript ishlamasa ham
 * hujjat o'qiladi: birinchi til boshidanoq ochiq turadi.
 */

export const LANGS = ['uz', 'ru', 'en'];

/** Til tanlash tugmalaridagi yozuvlar. */
export const LANG_NAMES = { uz: "O'zbekcha", ru: 'Русский', en: 'English' };

const LOGO = `<svg class="mark" viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="26" fill="#0A9F5B"/>
      <path d="M18 86 L42 24 H58 L82 86 Z" fill="#FFFFFF"/>
      <g fill="#0A9F5B">
        <rect x="46.4" y="68" width="7.2" height="11" rx="1.6"/>
        <rect x="47.2" y="49" width="5.6" height="9" rx="1.3"/>
        <rect x="47.8" y="33" width="4.4" height="7" rx="1"/>
      </g>
    </svg>`;

/**
 * @param {object} o
 * @param {string} o.slug        xotirada saqlanadigan til kaliti uchun
 * @param {string} o.title       <title> va sahifa tavsifi uchun
 * @param {string} o.description <meta description>
 * @param {object} o.headings    {uz,ru,en} — har tildagi <h1>
 * @param {object} o.bodies      {uz,ru,en} — har tildagi HTML matn
 */
export const renderPage = ({ slug, title, description, headings, bodies }) => {
  const sections = LANGS.map((lang) => (
    `<article id="doc-${lang}" lang="${lang}"${lang === 'uz' ? '' : ' hidden'}>\n`
    + `  <h1>${headings[lang]}</h1>\n`
    + `  ${bodies[lang]}\n`
    + '</article>'
  )).join('\n');

  const tabs = LANGS.map((lang) => (
    `<button type="button" data-lang="${lang}"${lang === 'uz' ? ' class="on" aria-current="true"' : ''}>`
    + `${LANG_NAMES[lang]}</button>`
  )).join('');

  return `<!doctype html>
<html lang="uz">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="index, follow">
<meta name="theme-color" content="#0A9F5B">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
  /* Sahifa o'zi yetarli: tashqaridan shrift ham, skript ham
     yuklanmaydi. Play Market tekshiruvchisi uni sekin internetda,
     kirmasdan va har qanday qurilmada ocha olishi kerak. */
  :root{
    color-scheme:light dark;
    --bg:#FFFFFF; --ink:#0F172A; --soft:#334155; --muted:#64748B;
    --line:#E2E8F0; --brand:#0A9F5B; --tint:#F1F5F9;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#061D13; --ink:#E8EEF2; --soft:#C3CDD6; --muted:#8FA0AD;
      --line:#15372A; --brand:#2ED47A; --tint:#0C2A1D;
    }
  }
  *{box-sizing:border-box;}
  body{
    margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-text-size-adjust:100%;
  }
  .wrap{max-width:720px;margin:0 auto;padding:24px 16px 64px;}
  header{display:flex;align-items:center;gap:10px;margin-bottom:20px;}
  .mark{width:34px;height:34px;border-radius:9px;flex:none;}
  .brand{font-weight:800;letter-spacing:0.02em;font-size:17px;}
  .langs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 20px;}
  .langs button{
    font:inherit;font-size:13px;font-weight:600;cursor:pointer;
    padding:7px 14px;border-radius:999px;border:1px solid var(--line);
    background:transparent;color:var(--muted);
  }
  .langs button.on{background:var(--brand);border-color:var(--brand);color:#fff;}
  h1{font-size:23px;line-height:1.25;margin:0 0 6px;letter-spacing:-0.01em;}
  h4{font-size:15.5px;margin:26px 0 6px;color:var(--ink);}
  p{margin:0 0 10px;color:var(--soft);}
  ul,ol{margin:0 0 10px;padding-left:22px;color:var(--soft);}
  li{margin:0 0 5px;}
  b{color:var(--ink);}
  footer{
    margin-top:36px;padding-top:18px;border-top:1px solid var(--line);
    color:var(--muted);font-size:13.5px;
  }
  footer a{color:var(--brand);}
</style>
</head>
<body>
<div class="wrap">

  <header>
    ${LOGO}
    <span class="brand">YO'LDA</span>
  </header>

  <nav class="langs" id="langs" aria-label="Til / Язык / Language">${tabs}</nav>

${sections}

  <footer>
    <p>+998 94 440 20 90 &middot; <a href="https://t.me/ziyodullayv" rel="noopener">@ziyodullayv</a></p>
    <p><a href="/">YO'LDA</a></p>
  </footer>

</div>
<script>
  /* Til tanlash. Skriptsiz ham sahifa o'qiladi: o'zbekcha matn
     boshidanoq ochiq turadi, qolgan ikkitasi hidden bilan
     yashiringan — ya'ni skript ishlamasa ham hujjat ko'rinadi. */
  (function(){
    var langs = ${JSON.stringify(LANGS)};
    var nav = document.getElementById("langs");
    function show(pick){
      langs.forEach(function(l){
        var el = document.getElementById("doc-" + l);
        if(el) el.hidden = (l !== pick);
      });
      nav.querySelectorAll("[data-lang]").forEach(function(b){
        var on = b.getAttribute("data-lang") === pick;
        b.classList.toggle("on", on);
        if(on) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
      document.documentElement.lang = pick;
      try{ localStorage.setItem("yolda_${slug}_lang", pick); }catch(e){}
    }
    nav.addEventListener("click", function(e){
      var b = e.target.closest("[data-lang]");
      if(b) show(b.getAttribute("data-lang"));
    });
    /* Ilgari tanlangan til, yoki brauzerning tili, yoki o'zbekcha. */
    var start = "";
    try{ start = localStorage.getItem("yolda_${slug}_lang") || ""; }catch(e){}
    if(langs.indexOf(start) === -1){
      var nl = (navigator.language || "").slice(0, 2).toLowerCase();
      start = langs.indexOf(nl) === -1 ? "uz" : nl;
    }
    if(start !== "uz") show(start);
  })();
</script>
</body>
</html>
`;
};
