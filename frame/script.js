/* ═══════════════════════════════════════════════════════════════
   ScrabblePrint — script.js
   • Mot le plus long placé en VERTICAL en premier
   • Export PDF via html2canvas + jsPDF (rendu pixel-perfect)
   • Algorithme d'entremêlement Scrabble avec backtracking
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const SCORES = {
  A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:10,L:1,M:2,N:1,O:1,P:3,Q:8,R:1,S:1,T:1,
  U:1,V:4,W:10,X:10,Y:10,Z:10,É:1,È:1,Ê:1,Ë:1,Â:1,À:1,Î:1,Ï:1,Ô:1,Ù:1,Û:1,Ü:1,Ç:3
};

const PALETTES = [
  { name:'Bois',    bg:'#f5e6c8', border:'#c8a96e', text:'#2c1a0e', score:'#8b4513' },
  { name:'Ivoire',  bg:'#faf7f0', border:'#d4c08a', text:'#1a1208', score:'#7a6030' },
  { name:'Ardoise', bg:'#e4e8ec', border:'#96aab4', text:'#1c2b35', score:'#3a6a8a' },
  { name:'Nuit',    bg:'#1e2d3d', border:'#4a7a9b', text:'#ddeeff', score:'#87c3e0' },
  { name:'Rosée',   bg:'#fce8ec', border:'#e0a0b0', text:'#3d1520', score:'#b54060' },
  { name:'Forêt',   bg:'#e5f0dc', border:'#78b058', text:'#182e10', score:'#4a8020' },
  { name:'Craie',   bg:'#f8f5ec', border:'#c8c0a0', text:'#2a2418', score:'#6a5a30' },
  { name:'Nuit Or', bg:'#12100c', border:'#c8a030', text:'#f0d888', score:'#c8a030' },
];

const BG_COLORS = [
  { label:'Blanc',     val:'#ffffff' },
  { label:'Crème',     val:'#fdf8ef' },
  { label:'Lin',       val:'#f5ede0' },
  { label:'Gris pâle', val:'#f0f0f0' },
  { label:'Bleu pâle', val:'#eef3f8' },
  { label:'Anthracite',val:'#22201c' },
];

const state = {
  names:['Marie','Jean','Lucie'],
  palette:PALETTES[0], bgColor:'#ffffff', tileSize:50,
  showScores:true, showShadow:true, frameStyle:'classic',
  tileFont:"'Playfair Display', serif", bottomFont:"'Playfair Display', serif",
  mainText:'Notre famille', subText:'avec amour · pour toujours',
  mainSize:28, subSize:13, layouts:[], layoutIndex:0,
};

/* ── Algo ── */

function normalize(ch) {
  return ch.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
}

function placeWord(grid, word, wordIdx, startCol, startRow, dir) {
  const g = new Map(grid);
  for (let i = 0; i < word.length; i++) {
    const col = dir==='H' ? startCol+i : startCol;
    const row = dir==='H' ? startRow   : startRow+i;
    const key = col+','+row;
    const existing = g.get(key);
    const ch = word[i];
    const crossing = !!(existing && normalize(existing.char)===normalize(ch));
    if (existing && !crossing) return null;
    g.set(key, { char:ch, wordIndex:crossing?existing.wordIndex:wordIdx, crossing });
  }
  return g;
}

function bbox(grid) {
  let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
  for (const key of grid.keys()) {
    const [c,r] = key.split(',').map(Number);
    if(c<minC)minC=c; if(c>maxC)maxC=c; if(r<minR)minR=r; if(r>maxR)maxR=r;
  }
  return {minC,maxC,minR,maxR,w:maxC-minC+1,h:maxR-minR+1};
}

function gridScore(grid) {
  const {w,h} = bbox(grid);
  const ratio = w/Math.max(h,1);
  return -(w+h) - Math.max(0, ratio-0.9)*15;
}

function placementScore(p, word) {
  const dist = Math.abs(p.startCol)+Math.abs(p.startRow);
  const hBonus = p.dir==='H' ? 3 : 0;
  const midBonus = 1 - Math.abs(p.crossAt - word.length/2)/word.length;
  return -dist + hBonus + midBonus*2;
}

function findPlacements(grid, word) {
  const placements = [];
  const normWord = word.split('').map(normalize);

  for (const [key, cell] of grid) {
    const cellNorm = normalize(cell.char);
    const [gc,gr] = key.split(',').map(Number);

    for (let i = 0; i < normWord.length; i++) {
      if (normWord[i] !== cellNorm) continue;

      // Horizontal
      (function() {
        const sc=gc-i, sr=gr;
        if (grid.has((sc-1)+','+sr) || grid.has((sc+word.length)+','+sr)) return;
        for (let j=0;j<word.length;j++) {
          if(j===i) continue;
          const ex=grid.get((sc+j)+','+sr);
          if(ex && normalize(ex.char)!==normWord[j]) return;
        }
        for (let j=0;j<word.length;j++) {
          if(j===i) continue;
          if(grid.has((sc+j)+','+(sr-1))||grid.has((sc+j)+','+(sr+1))) return;
        }
        placements.push({startCol:sc,startRow:sr,dir:'H',crossAt:i});
      })();

      // Vertical
      (function() {
        const sc=gc, sr=gr-i;
        if (grid.has(sc+','+(sr-1)) || grid.has(sc+','+(sr+word.length))) return;
        for (let j=0;j<word.length;j++) {
          if(j===i) continue;
          const ex=grid.get(sc+','+(sr+j));
          if(ex && normalize(ex.char)!==normWord[j]) return;
        }
        for (let j=0;j<word.length;j++) {
          if(j===i) continue;
          if(grid.has((sc-1)+','+(sr+j))||grid.has((sc+1)+','+(sr+j))) return;
        }
        placements.push({startCol:sc,startRow:sr,dir:'V',crossAt:i});
      })();
    }
  }
  return placements;
}

function buildLayouts(words, maxLayouts=8) {
  if (!words.length) return [];

  const indexed = words
    .map((w,origIdx) => ({w:w.toUpperCase(), origIdx}))
    .sort((a,b) => b.w.length - a.w.length);

  const results = [];

  function backtrack(grid, remaining) {
    if (results.length >= maxLayouts*4) return;
    if (remaining.length === 0) { results.push(new Map(grid)); return; }

    const [{w:word, origIdx}, ...rest] = remaining;
    const placements = findPlacements(grid, word);

    if (placements.length === 0) {
      const {minC,maxC,maxR} = bbox(grid);
      const sc = Math.round((minC+maxC)/2) - Math.floor(word.length/2);
      const ng = placeWord(grid, word, origIdx, sc, maxR+2, 'H');
      if (ng) backtrack(ng, rest);
      return;
    }

    const sorted = placements
      .map(p => ({...p, score:placementScore(p,word)}))
      .sort((a,b) => b.score-a.score);

    const topN = Math.min(6, sorted.length);
    for (let i=0; i<topN; i++) {
      const p = sorted[i];
      const ng = placeWord(grid, word, origIdx, p.startCol, p.startRow, p.dir);
      if (ng) backtrack(ng, rest);
      if (results.length >= maxLayouts*4) break;
    }
  }

  // Mot le plus long en VERTICAL centré
  const longest = indexed[0];
  const sr0 = -Math.floor(longest.w.length/2);
  let initGrid = new Map();
  initGrid = placeWord(initGrid, longest.w, longest.origIdx, 0, sr0, 'V');

  backtrack(initGrid, indexed.slice(1));
  if (!results.length) return [];

  const seen = new Set();
  const unique = results.filter(g => {
    const sig = [...g.entries()].sort().map(([k,v])=>k+':'+v.char).join('|');
    if (seen.has(sig)) return false;
    seen.add(sig); return true;
  });

  unique.sort((a,b) => gridScore(b)-gridScore(a));
  return unique.slice(0, maxLayouts);
}

/* ── Rendu ── */

function renderGrid(grid) {
  const area = document.getElementById('tiles-area');
  const s = state.tileSize;
  const step = s+2;
  area.innerHTML = '';
  if (!grid || !grid.size) return;

  const {minC,maxC,minR,maxR} = bbox(grid);
  const gridW = (maxC-minC+1)*step-2;
  const gridH = (maxR-minR+1)*step-2;
  const areaH = area.offsetHeight || 680;
  const offsetX = Math.max(30, (595-gridW)/2);
  const offsetY = Math.max(20, (areaH-gridH)/2);

  const {bg,border,text,score:scoreColor} = state.palette;
  const shadow = state.showShadow ? '2px 3px 0 '+border : 'none';

  for (const [key,cell] of grid) {
    const [c,r] = key.split(',').map(Number);
    const px = offsetX+(c-minC)*step;
    const py = offsetY+(r-minR)*step;
    const el = document.createElement('div');
    el.className = 'tile'+(cell.crossing?' crossing':'');
    const fs = Math.round(s*0.55);
    const sfs = Math.round(s*0.19);
    el.style.cssText = 'left:'+px+'px;top:'+py+'px;width:'+s+'px;height:'+s+'px;'+
      'font-family:'+state.tileFont+';font-size:'+fs+'px;'+
      'background:'+bg+';border:1.5px solid '+border+';color:'+text+';box-shadow:'+shadow+';';
    el.textContent = cell.char.toUpperCase();
    if (state.showScores) {
      const sc = SCORES[normalize(cell.char)] || 1;
      const scoreEl = document.createElement('span');
      scoreEl.className='score';
      scoreEl.style.cssText='font-size:'+sfs+'px;color:'+scoreColor+';';
      scoreEl.textContent=sc;
      el.appendChild(scoreEl);
    }
    area.appendChild(el);
  }
}

function renderBottom() {
  const isDark = state.bgColor==='#22201c';
  const mainEl = document.getElementById('preview-main');
  const subEl  = document.getElementById('preview-sub');
  mainEl.textContent=state.mainText; subEl.textContent=state.subText;
  mainEl.style.fontFamily=state.bottomFont; subEl.style.fontFamily=state.bottomFont;
  mainEl.style.fontSize=state.mainSize+'px'; subEl.style.fontSize=state.subSize+'px';
  mainEl.style.color=isDark?'#f0ddb0':'#2c1a0e';
  subEl.style.color=isDark?'#b0986a':'#aaa';
}

function drawFrame() {
  const canvas=document.getElementById('frame-canvas');
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,595,842);
  if(state.frameStyle==='none') return;
  const accent=state.palette.border, m=20;

  if(state.frameStyle==='classic') {
    ctx.strokeStyle=accent; ctx.lineWidth=2.5;
    ctx.strokeRect(m,m,595-2*m,842-2*m);
    ctx.lineWidth=0.8; ctx.strokeRect(m+8,m+8,595-2*(m+8),842-2*(m+8));
    ctx.fillStyle=accent;
    [[m,m],[595-m,m],[595-m,842-m],[m,842-m]].forEach(([x,y])=>{
      ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.strokeStyle=accent;ctx.lineWidth=0.6;ctx.stroke();
    });
    ctx.lineWidth=1.2;ctx.strokeStyle=accent;
    [[m,421,true],[595-m,421,true],[297,m,false],[297,842-m,false]].forEach(([x,y,v])=>{
      ctx.beginPath();
      v?(ctx.moveTo(x,y-14),ctx.lineTo(x,y+14)):(ctx.moveTo(x-14,y),ctx.lineTo(x+14,y));
      ctx.stroke();
    });

  } else if(state.frameStyle==='deco') {
    [{w:2.5,o:0},{w:0.8,o:6},{w:2,o:14}].forEach(({w,o})=>{
      ctx.strokeStyle=accent;ctx.lineWidth=w;
      ctx.strokeRect(m+o,m+o,595-2*(m+o),842-2*(m+o));
    });
    [[m,m,1,1],[595-m,m,-1,1],[595-m,842-m,-1,-1],[m,842-m,1,-1]].forEach(([cx,cy,dx,dy])=>{
      ctx.save();ctx.translate(cx,cy);ctx.strokeStyle=accent;
      [22,32,42].forEach(r=>{ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(dx*r,0);ctx.lineTo(0,0);ctx.lineTo(0,dy*r);ctx.stroke();});
      ctx.restore();
    });
    [[297,m],[297,842-m],[m,421],[595-m,421]].forEach(([x,y])=>{
      ctx.save();ctx.translate(x,y);ctx.strokeStyle=accent;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(6,0);ctx.lineTo(0,6);ctx.lineTo(-6,0);ctx.closePath();ctx.stroke();ctx.restore();
    });

  } else if(state.frameStyle==='dots') {
    ctx.fillStyle=accent;
    for(let x=m;x<=595-m;x+=10)[m,842-m].forEach(y=>{ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();});
    for(let y=m+10;y<=842-m-10;y+=10)[m,595-m].forEach(x=>{ctx.beginPath();ctx.arc(x,y,1.8,0,Math.PI*2);ctx.fill();});
    ctx.strokeStyle=accent;ctx.lineWidth=0.8;
    ctx.strokeRect(m+10,m+10,595-2*(m+10),842-2*(m+10));
  }
}

function render() {
  document.getElementById('page').style.background=state.bgColor;
  renderBottom(); drawFrame();
  renderGrid(state.layouts[state.layoutIndex]||null);
  const total=state.layouts.length;
  document.getElementById('interlock-label').textContent=total?(state.layoutIndex+1)+' / '+total:'–';
}

function recompute() {
  const words=state.names.filter(n=>n.trim().length>0);
  state.layouts=buildLayouts(words,8);
  state.layoutIndex=0;
  render();
}

/* ── Export PDF ── */

function loadScript(url) {
  return new Promise((resolve,reject)=>{
    if(document.querySelector('script[src="'+url+'"]')){resolve();return;}
    const s=document.createElement('script');
    s.src=url; s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
}

async function exportPDF() {
  const btn=document.getElementById('print-btn');
  const orig=btn.textContent;
  btn.textContent='⏳ Génération…'; btn.disabled=true;
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

    const page=document.getElementById('page');
    const savedT=page.style.transform;
    const savedM=page.style.marginBottom;
    page.style.transform='none';
    page.style.marginBottom='0';

    const canvas=await html2canvas(page,{
      scale:2, useCORS:true, allowTaint:true,
      backgroundColor:state.bgColor,
      width:595, height:842,
      windowWidth:595, windowHeight:842,
      logging:false,
    });

    page.style.transform=savedT;
    page.style.marginBottom=savedM;

    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297);

    const filename=(state.mainText||'scrabble').replace(/[^a-zA-Z0-9_-]/g,'_')+'.pdf';
    pdf.save(filename);
  } catch(err) {
    alert('Erreur PDF : '+err.message); console.error(err);
  } finally {
    btn.textContent=orig; btn.disabled=false;
  }
}

/* ── Panel ── */

function buildNameInputs() {
  const list=document.getElementById('names-list');
  list.innerHTML='';
  state.names.forEach((name,i)=>{
    const row=document.createElement('div');
    row.className='name-row';
    row.innerHTML='<input type="text" value="'+name+'" placeholder="Prénom" data-idx="'+i+'" />'+
      '<button class="del-btn" data-idx="'+i+'" title="Supprimer">✕</button>';
    list.appendChild(row);
  });
  list.querySelectorAll('input[type="text"]').forEach(inp=>{
    inp.addEventListener('input',e=>{state.names[+e.target.dataset.idx]=e.target.value;recompute();});
  });
  list.querySelectorAll('.del-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{state.names.splice(+e.target.dataset.idx,1);buildNameInputs();recompute();});
  });
}

function buildPalette() {
  const pal=document.getElementById('palette');
  pal.innerHTML='';
  PALETTES.forEach((p,i)=>{
    const s=document.createElement('div');
    s.className='color-swatch'+(i===0?' active':'');
    s.title=p.name; s.style.background=p.bg; s.style.borderColor=p.border;
    s.addEventListener('click',()=>{
      state.palette=p;
      pal.querySelectorAll('.color-swatch').forEach(x=>x.classList.remove('active'));
      s.classList.add('active'); render();
    });
    pal.appendChild(s);
  });
}

function buildBgPalette() {
  const bgp=document.getElementById('bg-palette');
  bgp.innerHTML='';
  BG_COLORS.forEach((c,i)=>{
    const s=document.createElement('div');
    s.className='color-swatch'+(i===0?' active':'');
    s.title=c.label; s.style.background=c.val; s.style.borderColor='#bbb';
    s.addEventListener('click',()=>{
      state.bgColor=c.val;
      bgp.querySelectorAll('.color-swatch').forEach(x=>x.classList.remove('active'));
      s.classList.add('active'); render();
    });
    bgp.appendChild(s);
  });
}

function bindControls() {
  document.getElementById('add-name-btn').addEventListener('click',()=>{state.names.push('');buildNameInputs();recompute();});

  document.getElementById('prev-layout').addEventListener('click',()=>{
    if(!state.layouts.length)return;
    state.layoutIndex=(state.layoutIndex-1+state.layouts.length)%state.layouts.length; render();
  });
  document.getElementById('next-layout').addEventListener('click',()=>{
    if(!state.layouts.length)return;
    state.layoutIndex=(state.layoutIndex+1)%state.layouts.length; render();
  });

  document.getElementById('font-select').addEventListener('change',e=>{state.tileFont=e.target.value;render();});
  document.getElementById('font-bottom').addEventListener('change',e=>{state.bottomFont=e.target.value;render();});
  document.getElementById('tile-size').addEventListener('input',e=>{
    state.tileSize=+e.target.value;
    document.getElementById('tile-size-val').textContent=e.target.value+'px';
    render();
  });
  document.getElementById('main-text').addEventListener('input',e=>{state.mainText=e.target.value;render();});
  document.getElementById('sub-text').addEventListener('input',e=>{state.subText=e.target.value;render();});
  document.getElementById('main-size').addEventListener('input',e=>{state.mainSize=+e.target.value||28;render();});
  document.getElementById('sub-size').addEventListener('input',e=>{state.subSize=+e.target.value||13;render();});

  document.querySelectorAll('[data-frame]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      state.frameStyle=btn.dataset.frame;
      document.querySelectorAll('[data-frame]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); render();
    });
  });

  ['toggle-scores','toggle-shadow'].forEach((id,ki)=>{
    const key=['showScores','showShadow'][ki];
    document.getElementById(id).addEventListener('click',function(){
      this.classList.toggle('on'); state[key]=this.classList.contains('on'); render();
    });
  });

  document.getElementById('print-btn').addEventListener('click', exportPDF);

  scalePageToFit();
  window.addEventListener('resize', scalePageToFit);
}

function scalePageToFit() {
  const area=document.querySelector('.preview-area');
  const page=document.getElementById('page');
  if(!area||!page) return;
  const scale=Math.min(1,(area.clientHeight-50)/842,(area.clientWidth-50)/595);
  page.style.transform='scale('+scale+')';
  page.style.marginBottom=(842*scale-842)+'px';
}

document.addEventListener('DOMContentLoaded',()=>{
  buildNameInputs(); buildPalette(); buildBgPalette(); bindControls(); recompute();
});
