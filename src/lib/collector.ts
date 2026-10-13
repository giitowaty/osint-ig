/* ----------------------------------------------------------------------------
 * Bookmarklet „zbieracz” listy kont. Użytkownik uruchamia go SAM, we własnej
 * zalogowanej przeglądarce, na otwartej liście obserwujących/obserwowanych.
 * Przewija listę, zbiera nazwy i kopiuje do schowka; nic nie trafia na serwer.
 * -------------------------------------------------------------------------- */

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


export const BOOKMARKLET_HREF = "javascript:" + encodeURIComponent(SRC.replace(/\s*\n\s*/g, ""))
