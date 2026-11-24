'use strict';

/* Big PDFs (over Gemini's 50 MB limit, up to 500 MB): the person picks pages and this turns them
   into a smaller PDF of page images, so every picture, diagram and scan is kept. The big file is
   read in pieces straight from disk and is never uploaded. */

(function () {
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const MAX_PAGES = 120;
  const BUDGET = 44 * 1024 * 1024;
  const tr = (key, vars) => window.AceI18n.t(key, vars);
  const $ = id => document.getElementById(id);

  const add = (code, entries) => Object.assign(window.AceI18n.dicts[code], entries);
  add('en', { 'pdf.title': 'Choose pages', 'pdf.sub': '{name} has {n} pages. Pick up to {max} pages; pictures are kept.', 'pdf.label': 'Pages, for example 1-40, 55', 'pdf.use': 'Use these pages', 'pdf.cancel': 'Cancel', 'pdf.opening': 'Opening the PDF…', 'pdf.working': 'Preparing page {i} of {n}…', 'pdf.bad': 'Enter pages between 1 and {n}, like 1-40, 55.', 'pdf.many': 'That is {count} pages. Choose {max} or fewer.', 'pdf.locked': 'This PDF has a password. Remove it and try again.', 'pdf.fail': 'This PDF could not be read. Check your internet connection, or try another copy.' });
  add('uz', { 'pdf.title': 'Sahifalarni tanlang', 'pdf.sub': '{name}: {n} sahifa. Ko‘pi bilan {max} sahifa tanlang; rasmlar saqlanadi.', 'pdf.label': 'Sahifalar, masalan 1-40, 55', 'pdf.use': 'Shu sahifalarni ishlatish', 'pdf.cancel': 'Bekor qilish', 'pdf.opening': 'PDF ochilmoqda…', 'pdf.working': '{i} / {n} sahifa tayyorlanmoqda…', 'pdf.bad': '1 dan {n} gacha sahifalarni kiriting, masalan 1-40, 55.', 'pdf.many': '{count} sahifa tanlandi. Ko‘pi bilan {max} ta tanlang.', 'pdf.locked': 'Bu PDF parol bilan himoyalangan. Parolni olib tashlang.', 'pdf.fail': 'PDF o‘qilmadi. Internetni tekshiring yoki boshqa nusxani sinang.' });
  add('ru', { 'pdf.title': 'Выберите страницы', 'pdf.sub': '{name}: страниц {n}. Выберите не более {max}; картинки сохранятся.', 'pdf.label': 'Страницы, например 1-40, 55', 'pdf.use': 'Использовать страницы', 'pdf.cancel': 'Отмена', 'pdf.opening': 'Открываю PDF…', 'pdf.working': 'Готовлю страницу {i} из {n}…', 'pdf.bad': 'Введите страницы от 1 до {n}, например 1-40, 55.', 'pdf.many': 'Выбрано страниц: {count}. Выберите не более {max}.', 'pdf.locked': 'PDF защищён паролем. Снимите его и попробуйте снова.', 'pdf.fail': 'Не удалось прочитать PDF. Проверьте интернет или возьмите другую копию.' });
  add('es', { 'pdf.title': 'Elige páginas', 'pdf.sub': '{name} tiene {n} páginas. Elige hasta {max}; las imágenes se conservan.', 'pdf.label': 'Páginas, por ejemplo 1-40, 55', 'pdf.use': 'Usar estas páginas', 'pdf.cancel': 'Cancelar', 'pdf.opening': 'Abriendo el PDF…', 'pdf.working': 'Preparando página {i} de {n}…', 'pdf.bad': 'Escribe páginas entre 1 y {n}, como 1-40, 55.', 'pdf.many': 'Son {count} páginas. Elige {max} o menos.', 'pdf.locked': 'Este PDF tiene contraseña. Quítala e inténtalo de nuevo.', 'pdf.fail': 'No se pudo leer el PDF. Revisa tu conexión o prueba otra copia.' });
  add('de', { 'pdf.title': 'Seiten wählen', 'pdf.sub': '{name} hat {n} Seiten. Wähle bis zu {max}; Bilder bleiben erhalten.', 'pdf.label': 'Seiten, zum Beispiel 1-40, 55', 'pdf.use': 'Diese Seiten verwenden', 'pdf.cancel': 'Abbrechen', 'pdf.opening': 'PDF wird geöffnet…', 'pdf.working': 'Seite {i} von {n} wird vorbereitet…', 'pdf.bad': 'Gib Seiten von 1 bis {n} ein, etwa 1-40, 55.', 'pdf.many': 'Das sind {count} Seiten. Wähle höchstens {max}.', 'pdf.locked': 'Dieses PDF hat ein Passwort. Entferne es und versuch es erneut.', 'pdf.fail': 'Das PDF konnte nicht gelesen werden. Prüfe das Internet oder nimm eine andere Kopie.' });
  add('fr', { 'pdf.title': 'Choisis les pages', 'pdf.sub': '{name} a {n} pages. Choisis-en {max} au plus ; les images sont gardées.', 'pdf.label': 'Pages, par exemple 1-40, 55', 'pdf.use': 'Utiliser ces pages', 'pdf.cancel': 'Annuler', 'pdf.opening': 'Ouverture du PDF…', 'pdf.working': 'Préparation de la page {i} sur {n}…', 'pdf.bad': 'Entre des pages de 1 à {n}, comme 1-40, 55.', 'pdf.many': 'Cela fait {count} pages. Choisis-en {max} au plus.', 'pdf.locked': 'Ce PDF a un mot de passe. Retire-le et réessaie.', 'pdf.fail': 'Impossible de lire ce PDF. Vérifie ta connexion ou essaie une autre copie.' });

  let loading = null;
  function loadLibrary() {
    if (window.pdfjsLib) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${CDN}pdf.min.js`;
        script.onload = resolve;
        script.onerror = () => { script.remove(); loading = null; reject(new Error('library')); };
        document.head.append(script);
      }).then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN}pdf.worker.min.js`; });
    }
    return loading;
  }

  /* pdf.js asks for byte ranges; each is read from the file on disk only when needed. */
  function openDocument(file) {
    const lib = window.pdfjsLib;
    const range = new lib.PDFDataRangeTransport(file.size, new Uint8Array(0));
    let task;
    range.requestDataRange = (begin, end) => {
      file.slice(begin, end).arrayBuffer()
        .then(buffer => range.onDataRange(begin, new Uint8Array(buffer)))
        .catch(() => task && task.destroy());
    };
    task = lib.getDocument({
      range, length: file.size, rangeChunkSize: 512 * 1024, disableAutoFetch: true, disableStream: true,
      isEvalSupported: false, cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/', cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
    });
    return task;
  }

  function parsePages(text, total) {
    const pages = new Set();
    for (const part of text.replace(/[–—]/g, '-').split(/[,;]/).map(item => item.trim()).filter(Boolean)) {
      const match = /^(\d{1,6})(?:\s*-\s*(\d{1,6}))?$/.exec(part);
      if (!match) return null;
      const from = Number(match[1]);
      const to = Number(match[2] || match[1]);
      if (from < 1 || to > total || from > to) return null;
      for (let page = from; page <= to; page += 1) pages.add(page);
    }
    return pages.size ? [...pages].sort((a, b) => a - b) : null;
  }

  /* toBlob waits for idle time (a second or more in a hidden tab); toDataURL works straight away. */
  function toJpeg(canvas, quality) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (!url.startsWith('data:image/jpeg')) throw new Error('jpeg');
    const text = window.atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  async function renderPage(doc, number, longSide, limit) {
    const page = await doc.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: longSide / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    /* "print" does not wait for screen refreshes, so it keeps going in a hidden tab. */
    await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;
    let blob = null;
    for (const quality of [0.82, 0.65, 0.45, 0.2]) {
      blob = toJpeg(canvas, quality);
      if (blob.size <= limit) break;
    }
    const result = { blob, width: canvas.width, height: canvas.height };
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    return result;
  }

  /* A minimal PDF with one JPEG per page. */
  function buildPdf(images) {
    const parts = [];
    const offsets = [];
    let length = 0;
    const push = part => { parts.push(part); length += typeof part === 'string' ? part.length : part.size; };
    const object = (id, ...body) => { offsets[id] = length; push(`${id} 0 obj\n`); body.forEach(push); push('\nendobj\n'); };
    push('%PDF-1.4\n');
    object(1, '<</Type/Catalog/Pages 2 0 R>>');
    object(2, `<</Type/Pages/Count ${images.length}/Kids[${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}]>>`);
    images.forEach(({ blob, width, height }, i) => {
      const id = 3 + i * 3;
      const scale = 842 / Math.max(width, height);
      const w = (width * scale).toFixed(2);
      const h = (height * scale).toFixed(2);
      const draw = `q ${w} 0 0 ${h} 0 0 cm /I Do Q`;
      object(id, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]/Resources<</XObject<</I ${id + 1} 0 R>>>>/Contents ${id + 2} 0 R>>`);
      object(id + 1, `<</Type/XObject/Subtype/Image/Width ${width}/Height ${height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${blob.size}>>\nstream\n`, blob, '\nendstream');
      object(id + 2, `<</Length ${draw.length}>>\nstream\n${draw}\nendstream`);
    });
    const start = length;
    push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for (let id = 1; id < offsets.length; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<</Size ${offsets.length}/Root 1 0 R>>\nstartxref\n${start}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function convert(doc, pages, onStep, cancelled) {
    const limit = BUDGET / pages.length;
    const longSide = pages.length <= 60 ? 1700 : 1400;
    const images = [];
    for (const [index, number] of pages.entries()) {
      if (cancelled()) return null;
      onStep(index + 1, pages.length);
      images.push(await renderPage(doc, number, longSide, limit));
    }
    return cancelled() ? null : buildPdf(images);
  }

  function run(file) {
    return new Promise(resolve => {
      const dialog = $('pdf-dialog');
      const form = $('pdf-form');
      const input = $('pdf-pages');
      const use = $('pdf-use');
      let task = null;
      let doc = null;
      let stopped = false;
      let working = false;
      const say = (text, bad) => {
        $('pdf-status').textContent = text;
        $('pdf-status').className = `name-status${bad ? ' is-bad' : ''}`;
      };
      /* A damaged file can be searched for minutes: say so instead of waiting silently. */
      const slow = window.setTimeout(() => { if (!doc && !stopped) say(tr('pdf.fail'), true); }, 90000);
      const bar = ratio => { $('pdf-bar').style.width = `${Math.round(ratio * 100)}%`; };
      const done = result => {
        if (stopped) return;
        stopped = true;
        window.clearTimeout(slow);
        form.onsubmit = null;
        dialog.onclose = null;
        $('pdf-cancel').onclick = null;
        if (dialog.open) dialog.close();
        if (task) task.destroy().catch(() => {});
        resolve(result);
      };
      $('pdf-sub').textContent = file.name;
      input.value = '';
      input.disabled = true;
      use.disabled = true;
      bar(0);
      say(tr('pdf.opening'));
      dialog.onclose = () => done(null);
      $('pdf-cancel').onclick = () => done(null);
      document.querySelectorAll('dialog[open]').forEach(other => other.close());
      dialog.showModal();

      loadLibrary().then(() => {
        if (stopped) return null;
        task = openDocument(file);
        return task.promise;
      }).then(opened => {
        if (stopped || !opened || doc) return;
        window.clearTimeout(slow);
        doc = opened;
        const total = doc.numPages;
        $('pdf-sub').textContent = tr('pdf.sub', { name: file.name, n: total, max: MAX_PAGES });
        input.value = `1-${Math.min(40, total)}`;
        input.disabled = false;
        use.disabled = false;
        say('');
        input.focus();
        input.select();
      }).catch(error => {
        if (!stopped) say(tr(error && error.name === 'PasswordException' ? 'pdf.locked' : 'pdf.fail'), true);
      });

      form.onsubmit = async event => {
        event.preventDefault();
        if (!doc || working) return;
        const pages = parsePages(input.value, doc.numPages);
        if (!pages) return say(tr('pdf.bad', { n: doc.numPages }), true);
        if (pages.length > MAX_PAGES) return say(tr('pdf.many', { count: pages.length, max: MAX_PAGES }), true);
        working = true;
        input.disabled = true;
        use.disabled = true;
        try {
          const blob = await convert(doc, pages, (i, n) => {
            say(tr('pdf.working', { i, n }));
            bar(i / n);
          }, () => stopped);
          if (!blob) return;
          if (blob.size > 50 * 1024 * 1024) {
            say(tr('pdf.many', { count: pages.length, max: Math.max(1, Math.floor(pages.length * 0.7)) }), true);
            return;
          }
          const label = `${pages[0]}-${pages[pages.length - 1]}`;
          const stem = file.name.replace(/\.pdf$/i, '').slice(0, 120);
          done(new File([blob], `${stem} (p. ${label}).pdf`, { type: 'application/pdf', lastModified: file.lastModified }));
        } catch {
          if (!stopped) say(tr('pdf.fail'), true);
        } finally {
          working = false;
          if (!stopped) {
            input.disabled = false;
            use.disabled = false;
            bar(0);
          }
        }
      };
    });
  }

  /* Never let the form reload the page, whatever state the dialog is in. */
  $('pdf-form').addEventListener('submit', event => event.preventDefault());

  /* One at a time, even when several big PDFs are dropped together. */
  let chain = Promise.resolve();
  window.AcePdf = {
    pick(file) {
      const next = chain.then(() => run(file));
      chain = next.catch(() => {});
      return next;
    }
  };
})();
