(async function(){

/* -------------------------
   LOAD CSS
------------------------- */

function loadCSS(url){
  return new Promise(res=>{
    const l=document.createElement("link");
    l.rel="stylesheet";
    l.href=url;
    l.onload=res;
    document.head.appendChild(l);
  });
}

await loadCSS("https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.css");
await loadCSS("https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/styles/github.min.css");
await loadCSS("https://sebgamblin.github.io/moodle/style.css");



/* -------------------------
   LOAD JS LIBS
------------------------- */

function loadJS(url){
  return new Promise(res=>{
    const s=document.createElement("script");
    s.src=url;
    s.onload=res;
    document.head.appendChild(s);
  });
}

await loadJS("https://cdn.jsdelivr.net/npm/marked/marked.min.js");
await loadJS("https://cdn.jsdelivr.net/npm/reveal.js/dist/reveal.js");
await loadJS("https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js");
await loadJS("https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.8.0/build/highlight.min.js");



/* -------------------------
   INIT LIBS
------------------------- */

mermaid.initialize({
  startOnLoad:false,
  theme:'base',
  themeVariables:{
    primaryColor:'#fadbd8',
    primaryBorderColor:'#c0392b',
    primaryTextColor:'#1a1a2e'
  }
});

marked.setOptions({
  highlight:function(code,lang){
    return hljs.highlightAuto(code,lang?[lang]:undefined).value;
  }
});


/* -------------------------
   BUILD DOM
------------------------- */

document.body.insertAdjacentHTML("afterbegin",`

<div id="toolbar">
<button class="toolbar-btn" id="modeBtn">▶ Slides</button>
<button class="toolbar-btn" id="fsBtn">⛶ Plein écran</button>
</div>

<div id="error-banner">
⚠️ Contenu introuvable.
La page doit contenir
<code>&lt;div id="cours-md"&gt;</code>
</div>

<div id="doc"></div>
<div class="reveal"><div class="slides"></div></div>

`);



/* -------------------------
   STATE
------------------------- */

let md=null;
let slideMode=false;
let revealInitialized=false;



/* -------------------------
   LOAD MARKDOWN
------------------------- */

const mdDiv=document.getElementById("cours-md");

if(mdDiv){

  md=mdDiv.innerText.trim();
  document.getElementById("error-banner").style.display="none";

  renderDoc();

}



/* -------------------------
   UTILITIES
------------------------- */

function transformMermaid(root){

root.querySelectorAll("pre code.language-mermaid")
.forEach(el=>{

  const div=document.createElement("div");
  div.className="mermaid";
  div.textContent=el.textContent;

  el.closest("pre").replaceWith(div);

});

mermaid.run({nodes:root.querySelectorAll(".mermaid")});

}



function addLangBadges(root){

root.querySelectorAll("pre code[class*='language-']")
.forEach(el=>{

let lang=[...el.classList]
.find(c=>c.startsWith("language-"));

if(!lang) return;

lang=lang.replace("language-","");

if(lang!=="mermaid")
el.closest("pre").setAttribute("data-lang",lang);

});

}



function addCopyButtons(root){

root.querySelectorAll("pre").forEach(pre=>{

if(pre.querySelector(".copy-btn")) return;

const btn=document.createElement("button");

btn.className="copy-btn";
btn.textContent="Copier";

btn.onclick=()=>{

const text=(pre.querySelector("code")||pre).innerText;

navigator.clipboard.writeText(text);

btn.textContent="Copié !";

setTimeout(()=>btn.textContent="Copier",2000);

};

pre.appendChild(btn);

});

}



/* -------------------------
   RENDER DOC
------------------------- */

function renderDoc(){

if(revealInitialized){

try{Reveal.destroy()}catch(e){}

revealInitialized=false;

}

document.getElementById("doc").style.display="block";
document.querySelector(".reveal").style.display="none";

const doc=document.getElementById("doc");

doc.innerHTML=marked.parse(md||"*Aucun contenu.*");

transformMermaid(doc);

hljs.highlightAll();

addLangBadges(doc);

addCopyButtons(doc);

}



/* -------------------------
   RENDER SLIDES
------------------------- */

function renderSlides(){

document.getElementById("doc").style.display="none";
document.querySelector(".reveal").style.display="block";

const container=document.querySelector(".slides");

container.innerHTML="";

(md||"").split(/^---$/m).forEach(s=>{

const section=document.createElement("section");

section.innerHTML=marked.parse(s);

container.appendChild(section);

});

transformMermaid(container);

hljs.highlightAll();

addCopyButtons(container);

if(!revealInitialized){

Reveal.initialize({
hash:false,
slideNumber:true,
transition:"slide",
width:1100,
height:700
});

revealInitialized=true;

}

}



/* -------------------------
   EVENTS
------------------------- */

document.getElementById("modeBtn").onclick=()=>{

slideMode=!slideMode;

if(slideMode){

renderSlides();

modeBtn.textContent="📄 Document";

}

else{

renderDoc();

modeBtn.textContent="▶ Slides";

}

};


document.getElementById("fsBtn").onclick=()=>{

if(!document.fullscreenElement)
document.documentElement.requestFullscreen();
else
document.exitFullscreen();

};



})();