"use strict";

/* ----------------------------------------------------------------------------
 * OSINT-IG — pomocniczy „zbieracz” listy kont (bookmarklet).
 *
 * Pełnych list obserwujących/obserwowanych IG nie udostępnia publicznie. Ten
 * bookmarklet użytkownik uruchamia SAM, we własnej zalogowanej przeglądarce, na
 * otwartej liście obserwujących/obserwowanych danego profilu. Przewija listę,
 * zbiera nazwy kont i kopiuje je do schowka — nic nie trafia na żaden serwer.
 *
 * To scraping po stronie użytkownika: używać z umiarem i zgodnie z regulaminem
 * Instagrama. Nadużycie może skutkować ograniczeniem konta.
 * -------------------------------------------------------------------------- */

window.OsintCollector = (function () {
  // Źródło bookmarkletu (czytelna wersja). Przewija dialog listy i zbiera nicki.
  const SRC = `(async()=>{
    const dlg=document.querySelector('div[role="dialog"]')||document.body;
    const cand=[...dlg.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+40;});
    const sc=cand.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]||dlg;
    const names=new Set();
    const skip=new Set(['explore','reels','reel','p','stories','direct','accounts','about','tv']);
    const grab=()=>{dlg.querySelectorAll('a[href^="/"]').forEach(a=>{const m=(a.getAttribute('href')||'').match(/^\\/([A-Za-z0-9._]{1,30})\\/$/);if(m&&!skip.has(m[1]))names.add(m[1]);});};
    let last=-1,stable=0;
    for(let i=0;i<500&&stable<6;i++){grab();sc.scrollTop=sc.scrollHeight;await new Promise(r=>setTimeout(r,400));if(names.size===last)stable++;else{stable=0;last=names.size;}}
    grab();
    const list=[...names].join('\\n');
    try{await navigator.clipboard.writeText(list);alert('OSINT-IG: skopiowano '+names.size+' kont do schowka. Wklej w narzedziu.');}
    catch(e){const t=document.createElement('textarea');t.value=list;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();alert('OSINT-IG: skopiowano '+names.size+' kont.');}
  })();`;

  const HREF = "javascript:" + encodeURIComponent(SRC.replace(/\s*\n\s*/g, ""));

  // Zwraca gotowy węzeł z instrukcją i przeciąganym bookmarkletem.
  function helpNode() {
    const wrap = document.createElement("div");
    wrap.className = "b-help";
    wrap.innerHTML = `
      <p class="muted" style="margin:0 0 6px">Automatyczne zebranie listy (we własnej, zalogowanej przeglądarce):</p>
      <ol class="b-steps">
        <li>Przeciągnij na pasek zakładek: <a class="b-bm">📥 OSINT-IG zbieracz</a></li>
        <li>Na Instagramie otwórz u profilu listę <strong>Obserwujący</strong> lub <strong>Obserwowani</strong>.</li>
        <li>Kliknij zakładkę — przewinie listę i skopiuje nazwy do schowka.</li>
        <li>Wklej je w pole wyżej i kliknij „Zastosuj”.</li>
      </ol>
      <p class="disclaimer" style="margin:6px 0 0">⚠ Działa na Twojej sesji IG. To scraping po stronie przeglądarki — używaj z umiarem
        i zgodnie z regulaminem Instagrama; nadużycie grozi ograniczeniem konta.</p>`;
    const a = wrap.querySelector(".b-bm");
    a.setAttribute("href", HREF);           // ustawiamy przez DOM, bez HTML-escapingu
    a.addEventListener("click", (e) => {
      e.preventDefault();
      alert("Nie klikaj tutaj — przeciągnij ten przycisk na pasek zakładek przeglądarki, a potem użyj go na stronie listy obserwujących w Instagramie.");
    });
    return wrap;
  }

  return { helpNode, HREF };
})();
