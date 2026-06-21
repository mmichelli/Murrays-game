// All of Murray's Game styling, kept as one tagged template so the single
// UI component stays self-contained. Imported by App.jsx into a <style> tag.
export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;600;800&family=Space+Mono:wght@400;700&display=swap');
.fb-root{
  --paper:#E7EAED; --panel:#FBFCFD; --slip:#FFFFFF; --ink:#14181D; --muted:#5C636C; --line:#D6DBE0;
  --green:#1AA67E; --amber:#E8920A; --red:#E0322B;
  /* a cool, neutral paper desk, lit unevenly - pages sit on top of it */
  min-height:100vh;color:var(--ink);
  background-color:var(--paper);
  background-image:
    radial-gradient(150% 100% at 50% -25%, rgba(255,255,255,.6), rgba(255,255,255,0) 60%),
    radial-gradient(95% 80% at 9% 5%, rgba(247,249,251,.5), rgba(247,249,251,0) 46%),
    radial-gradient(130% 120% at 93% 105%, rgba(64,76,92,.12), rgba(64,76,92,0) 55%);
  background-attachment:fixed;
  font-family:Archivo,system-ui,sans-serif;display:flex;justify-content:center;padding:18px;box-sizing:border-box;position:relative;
}
/* fine fibre grain printed over the whole surface - paper, cards and all */
.fb-root::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:100;mix-blend-mode:multiply;opacity:.1;
  background-image:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='180'%20height='180'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.82'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='180'%20height='180'%20filter='url(%23n)'/%3E%3C/svg%3E");
  background-size:180px 180px;}
.fb-shell{width:100%;max-width:540px;position:relative;z-index:1;}
.fb-brand{font-family:Anton,'Arial Narrow',sans-serif;letter-spacing:.03em;font-size:clamp(32px,9.5vw,46px);line-height:.9;text-align:center;width:max-content;max-width:100%;margin:0;color:var(--ink);text-transform:uppercase;text-shadow:3px 3px 0 var(--accent);
  background:none;border:none;padding:0;cursor:pointer;display:block;transition:text-shadow .08s,transform .08s;}
.fb-brand:hover{text-shadow:4px 4px 0 var(--accent);}
.fb-brand:active{transform:translate(1px,1px);text-shadow:2px 2px 0 var(--accent);}
.fb-brand:focus-visible{outline:2.5px solid var(--ink);outline-offset:4px;border-radius:4px;}

/* brand + language toggle - neo-brutalist hard-edged EN/NO codes */
.fb-topbar{display:flex;flex-direction:column;align-items:center;gap:11px;margin:6px 0 18px;}
.fb-langs{display:inline-flex;gap:7px;}
.fb-lang{display:inline-flex;align-items:center;justify-content:center;min-width:42px;background:var(--panel);border:2.5px solid var(--ink);border-radius:6px;padding:6px 10px;cursor:pointer;
  font-family:'Space Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
  box-shadow:2px 2px 0 var(--ink);transition:transform .07s,box-shadow .07s;}
.fb-lang:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink);color:var(--ink);}
.fb-lang:active{transform:translate(2px,2px);box-shadow:0 0 0 var(--ink);}
.fb-lang.on{background:var(--ink);color:var(--paper);box-shadow:3px 3px 0 var(--accent);}
.fb-lang.on:hover{transform:translate(-1px,-1px);box-shadow:4px 4px 0 var(--accent);color:var(--paper);}
.fb-lang.on:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--accent);}
.fb-lang:focus-visible{outline:3px solid var(--accent);outline-offset:3px;}

/* landing hero - a bold solid accent band, brand oversized on top */
.fb-hero{position:relative;background:var(--accent);border:3px solid var(--ink);border-radius:8px;box-shadow:8px 8px 0 var(--ink);
  padding:22px 18px 24px;margin:2px 2px 22px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;overflow:hidden;}
.fb-hero>*{position:relative;z-index:1;}
.fb-herobrand{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;font-size:clamp(46px,15.5vw,82px);line-height:.96;margin:0;
  color:var(--paper);text-transform:uppercase;letter-spacing:.015em;text-shadow:4px 4px 0 var(--ink);}
.fb-herotag{font-family:Anton,sans-serif;font-size:clamp(15px,4.4vw,22px);letter-spacing:.02em;text-transform:uppercase;
  color:var(--ink);background:var(--paper);border:2.5px solid var(--ink);border-radius:6px;padding:5px 13px;box-shadow:3px 3px 0 var(--ink);transform:rotate(-1.4deg);}
.fb-herosub{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--paper);margin:-2px 0 0;opacity:.95;}
/* sit the decorative slips right under the brand inside the hero */
.fb-hero .fb-sliprow{margin-bottom:0;}
.fb-hero .fb-sliprow span{color:var(--ink);}
/* Murray, framed beside his credit line */
.fb-murray{display:flex;align-items:center;gap:13px;text-align:left;margin-top:2px;}
.fb-murraypic{flex:none;display:inline-flex;background:#fff;border:2.5px solid var(--ink);border-radius:6px;box-shadow:3px 3px 0 var(--ink);padding:5px;}
.fb-murraypic svg{display:block;}
.fb-murray .fb-tiny{margin:0;}

/* neo-brutalist paper cards: thick ink border + hard offset shadow. */
.fb-card{position:relative;border:3px solid var(--ink);border-radius:6px;padding:22px;
  background-color:var(--panel);
  box-shadow:6px 6px 0 var(--ink);}
.fb-stack{display:flex;flex-direction:column;gap:12px;}
.fb-center{text-align:center;align-items:center;}

.fb-h1{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;letter-spacing:.01em;font-size:27px;margin:0;text-transform:uppercase;line-height:1;}
.fb-h2{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.14em;margin:0;text-transform:uppercase;color:var(--muted);}
.fb-xl{font-size:clamp(38px,11vw,58px);line-height:.96;}
.fb-center .fb-h1.fb-xl{margin:6px 0 2px;}
.fb-muted{color:var(--muted);margin:0;font-size:15px;line-height:1.62;}
.fb-muted b{color:var(--ink);}
.fb-tiny{color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}
.fb-hostnote{margin:2px 0 0;font-family:'Space Mono',monospace;font-size:11.5px;line-height:1.55;color:var(--ink);
  background:var(--panel);border:2.5px solid var(--ink);border-radius:6px;box-shadow:3px 3px 0 var(--accent);padding:11px 13px;text-align:left;}

.fb-label{display:flex;flex-direction:column;gap:6px;font-family:'Space Mono',monospace;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;}
.fb-input{background:#fff;border:2.5px solid var(--ink);border-radius:6px;color:var(--ink);padding:12px 13px;font-size:16px;font-family:inherit;width:100%;box-sizing:border-box;}
.fb-input:focus{outline:none;border-color:var(--ink);box-shadow:3px 3px 0 var(--accent);}
.fb-input.bare{background:transparent;border:none;padding:6px 0;font-weight:800;font-size:17px;box-shadow:none;}
.fb-input.bare:focus{outline:none;box-shadow:none;border-bottom:2px solid var(--tc);}
.fb-row{display:flex;gap:8px;}
.fb-add{width:auto;padding-left:18px;padding-right:18px;}
/* host's running wordlist total - a small status eyebrow, not a title */
.fb-wordtotal{margin:0;font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
.fb-wordtotal b{font-family:Anton,sans-serif;font-weight:400;font-size:22px;color:var(--accent);vertical-align:-3px;margin-right:5px;}
/* "Your words" heading + inline tally */
.fb-yourwords{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin-top:8px;}
.fb-yourwordsnum{font-family:Anton,sans-serif;font-weight:400;font-size:19px;color:var(--accent);}
.fb-wordhint{margin:-6px 0 0;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);}
.fb-wordhint.done{color:var(--green);}
/* your own words, each removable */
.fb-mywords{display:flex;flex-wrap:wrap;gap:7px;}
.fb-myword{display:inline-flex;align-items:center;gap:7px;background:#fff;border:2px solid var(--ink);border-radius:7px;box-shadow:2px 2px 0 var(--ink);
  padding:4px 4px 4px 11px;font-family:Archivo,sans-serif;font-weight:800;font-size:14px;color:var(--ink);}
.fb-wordx{display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;border:1.5px solid var(--ink);border-radius:5px;
  background:var(--panel);color:var(--muted);font-size:16px;line-height:1;cursor:pointer;padding:0;flex:none;}
.fb-wordx:hover{background:var(--red);color:#fff;}
/* a small fixed status badge - overlays the corner, never shifts the layout */
.fb-reconnect{position:fixed;top:13px;right:13px;z-index:80;width:38px;height:38px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;background:var(--amber);color:var(--ink);
  border:2.5px solid var(--ink);box-shadow:3px 3px 0 var(--ink);}
.fb-reconnect.offline{background:#9AA0A8;}
.fb-reconnect-ico{font-size:19px;line-height:1;font-weight:700;animation:fbspin 1s linear infinite;}
.fb-reconnect.offline .fb-reconnect-ico{animation:none;}
@keyframes fbspin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){.fb-reconnect-ico{animation:none;}}

.fb-btn{background:var(--ink);color:var(--paper);border:3px solid var(--ink);border-radius:6px;padding:13px 16px;font-size:16px;font-weight:800;
  font-family:Archivo,sans-serif;cursor:pointer;width:100%;box-shadow:5px 5px 0 var(--accent);transition:transform .07s,box-shadow .07s;}
.fb-btn:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:6px 6px 0 var(--accent);}
.fb-btn:active:not(:disabled){transform:translate(4px,4px);box-shadow:1px 1px 0 var(--accent);}
.fb-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none;background:var(--panel);color:var(--muted);border-style:dashed;}
.fb-btn:focus-visible{outline:3px solid var(--accent);outline-offset:3px;}
.fb-ghost{background:var(--panel);color:var(--ink);border:3px solid var(--ink);box-shadow:4px 4px 0 var(--ink);}
.fb-ghost:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:5px 5px 0 var(--ink);border-color:var(--ink);}
.fb-ghost:active:not(:disabled){transform:translate(4px,4px);box-shadow:1px 1px 0 var(--ink);}
.fb-big{padding:17px;font-size:18px;}
.fb-x{background:var(--panel);border:2.5px solid var(--ink);color:var(--ink);border-radius:6px;width:38px;height:38px;font-size:19px;cursor:pointer;flex:none;}
.fb-x:hover{color:var(--ink);border-color:var(--tc);box-shadow:2px 2px 0 var(--tc);}
.fb-err{color:var(--red);margin:0;font-size:13px;font-family:'Space Mono',monospace;}

.fb-sliprow{display:flex;gap:12px;justify-content:center;margin-bottom:6px;}
.fb-sliprow span{position:relative;font-family:'Space Mono',monospace;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);
  background:var(--slip);padding:8px 12px;border:2.5px solid var(--ink);border-radius:5px;box-shadow:3px 3px 0 var(--ink);}
.fb-sliprow span:nth-child(1){transform:rotate(-3deg);}
.fb-sliprow span:nth-child(2){transform:rotate(2deg);}
.fb-sliprow span:nth-child(3){transform:rotate(-2deg);}

/* landing round-by-round breakdown */
.fb-roundlist{width:100%;display:flex;flex-direction:column;gap:10px;}
.fb-roundlisttop{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-align:left;}
.fb-rounds{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;width:100%;}
.fb-rounds li{display:flex;align-items:baseline;gap:9px;text-align:left;}
.fb-rname{font-family:Archivo,sans-serif;font-weight:800;font-size:14.5px;color:var(--ink);white-space:nowrap;flex:none;}
.fb-rgloss{color:var(--muted);font-size:13px;line-height:1.42;}
/* pixel-art round glyphs - scale with the text, inherit its colour */
.fb-pixicon{display:inline-flex;width:1.2em;height:1.2em;vertical-align:-0.24em;flex:none;}
.fb-pixicon svg{width:100%;height:100%;display:block;}
.fb-roundtag .fb-pixicon{width:1.35em;height:1.35em;vertical-align:-0.3em;}
.fb-pixicon-th{width:1.7em;height:1.7em;vertical-align:0;}

.fb-steps{display:flex;gap:8px;}
.fb-step{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:var(--panel);border:2.5px solid var(--ink);border-radius:6px;padding:11px 6px;font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);cursor:pointer;}
.fb-step.on{border-color:var(--ink);color:var(--ink);box-shadow:4px 4px 0 var(--accent);}
.fb-step.done{color:var(--ink);}
.fb-stepn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1.6px solid currentColor;font-size:11px;flex:none;}
.fb-step.done .fb-stepn{background:var(--green);border-color:var(--green);color:#fff;}

.fb-tcount{font-family:'Space Mono',monospace;color:var(--muted);font-size:13px;min-width:16px;text-align:right;}
.fb-dot{width:11px;height:11px;border-radius:50%;background:var(--tc);flex:none;}
.fb-rosterwrap{display:flex;flex-wrap:wrap;gap:7px;}
.fb-chip{background:#fff;border:2px solid var(--ink);border-radius:999px;padding:6px 11px;color:var(--ink);font-size:13px;display:inline-flex;align-items:center;gap:7px;}
.fb-chip.off{opacity:.5;border-style:dashed;}
.fb-chip.off .fb-dot{background:var(--muted);}
/* live arrivals roster - players pop in as little minifigures */
.fb-arrlist{display:flex;flex-wrap:wrap;gap:9px;}
.fb-arrchip{display:inline-flex;align-items:center;gap:7px;background:#fff;border:2.5px solid var(--ink);border-radius:9px;
  box-shadow:3px 3px 0 var(--ink);padding:5px 15px 5px 7px;font-size:14px;animation:arrpop .34s cubic-bezier(.2,.9,.3,1.35);}
.fb-arrchip svg{display:block;flex:none;}
.fb-arrchip b{font-family:Archivo,sans-serif;font-weight:800;color:var(--ink);}
.fb-arrtag{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;
  background:var(--accent);border:1.5px solid var(--ink);border-radius:4px;padding:1px 5px;}
@keyframes arrpop{0%{transform:translateY(-9px) scale(.55);opacity:0;}60%{transform:translateY(0) scale(1.1);}100%{transform:scale(1);opacity:1;}}

.fb-group{background:#fff;border:2.5px solid var(--ink);border-radius:6px;padding:11px 13px;display:flex;flex-direction:column;gap:9px;box-shadow:3px 3px 0 var(--ink);}
.fb-group.mine{box-shadow:4px 4px 0 var(--tc);}
.fb-grouphead{display:flex;align-items:center;gap:10px;}
.fb-grouphead .fb-input.bare{flex:1;}
.fb-empty{color:var(--muted);font-size:12px;font-family:'Space Mono',monospace;letter-spacing:.06em;}
.fb-joinbtn{background:transparent;border:2.5px solid var(--ink);color:var(--ink);border-radius:6px;padding:9px;font-weight:800;font-family:inherit;font-size:14px;cursor:pointer;}
.fb-joinbtn:hover{border-color:var(--tc);color:var(--tc);}
.fb-joinbtn.on{background:var(--tc);border-color:var(--ink);color:#fff;box-shadow:3px 3px 0 var(--ink);}

.fb-qr{width:200px;height:200px;border-radius:6px;background:var(--slip);border:3px solid var(--ink);padding:8px;box-shadow:6px 6px 0 var(--ink);image-rendering:pixelated;}
.fb-sharetitle{display:flex;align-items:center;justify-content:center;gap:8px;}
.fb-sharetitle .fb-code{font-size:16px;}
.fb-statusdot{width:10px;height:10px;border-radius:50%;flex:none;border:1.5px solid var(--ink);}
.fb-code{font-family:'Space Mono',monospace;letter-spacing:.12em;color:var(--accent);text-transform:uppercase;}
.fb-linkfield{font-size:12px;text-align:center;}
.fb-sharebtns{width:100%;}

.fb-roundline{display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
.fb-center .fb-roundline{align-items:center;}
.fb-roundtag{font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);}
/* themed round-progress strip under the card: one dot per round, in its colour */
.fb-progress{display:flex;gap:13px;justify-content:center;align-items:center;margin:16px auto 0;}
.fb-progdot{width:16px;height:16px;border-radius:50%;border:2.5px solid var(--ink);background:var(--panel);box-shadow:2px 2px 0 var(--ink);box-sizing:border-box;flex:none;transition:transform .12s;}
.fb-progdot.done{background:var(--dc);}
.fb-progdot.now{width:24px;height:24px;background:var(--dc);box-shadow:3px 3px 0 var(--ink);}

/* Time Timer-style disc - a depleting wedge on a clock face. */
@property --fbdeg{syntax:'<angle>';inherits:false;initial-value:360deg;}
.fb-vtimer{align-self:center;position:relative;width:min(264px,70vw);aspect-ratio:1;margin:2px auto;}
.fb-vtimer.green{--zone:var(--green);}
.fb-vtimer.yellow{--zone:var(--amber);}
.fb-vtimer.red{--zone:var(--red);}
.fb-vt-disc{position:absolute;inset:0;border-radius:50%;border:3px solid var(--ink);
  background:conic-gradient(var(--zone) var(--fbdeg), rgba(20,26,34,.12) var(--fbdeg) 360deg);
  transition:--fbdeg 1s linear;box-shadow:0 16px 32px rgba(20,26,34,.20), 0 1px 0 #fff inset;}
.fb-vt-ticks{position:absolute;inset:0;border-radius:50%;pointer-events:none;opacity:.5;
  background:repeating-conic-gradient(from -.7deg, var(--ink) 0 1.4deg, transparent 1.4deg 30deg);
  -webkit-mask:radial-gradient(circle, transparent 0 calc(50% - 15px), #000 calc(50% - 15px) calc(50% - 4px), transparent calc(50% - 4px));
          mask:radial-gradient(circle, transparent 0 calc(50% - 15px), #000 calc(50% - 15px) calc(50% - 4px), transparent calc(50% - 4px));}
.fb-vt-hub{position:absolute;inset:23%;border-radius:50%;background:var(--slip);border:2px solid var(--ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 5px 12px rgba(20,26,34,.14);}
.fb-vt-secs{font-family:Anton,'Arial Narrow',sans-serif;font-weight:400;font-size:clamp(38px,15vw,58px);line-height:.85;color:var(--ink);font-variant-numeric:tabular-nums;}
.fb-vtimer.red .fb-vt-secs{color:var(--red);}
.fb-vt-unit{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-top:3px;}
.fb-vtimer.pulse{animation:fbvt .85s ease-in-out infinite;}@keyframes fbvt{50%{transform:scale(1.045);}}

.fb-slip{position:relative;align-self:center;max-width:100%;background:var(--slip);padding:26px 20px 22px;border-radius:4px;border:4px solid var(--ink);
  box-shadow:8px 8px 0 var(--ink);transform:rotate(-1deg);animation:slipdrop .28s cubic-bezier(.2,.85,.3,1);}
.fb-slip.tap{cursor:pointer;transition:box-shadow .08s;}
.fb-slip.tap:hover{box-shadow:10px 10px 0 var(--ink);}
.fb-slip.tap:active{box-shadow:3px 3px 0 var(--ink);}
.fb-slip.tap:focus-visible{outline:3px solid var(--accent);outline-offset:4px;}
.fb-slip::before{content:"";position:absolute;top:-2px;left:10px;right:10px;height:8px;
  background:radial-gradient(circle at 6px -2px, var(--paper) 0 5px, transparent 5.5px) repeat-x;background-size:12px 8px;}
@keyframes slipdrop{from{transform:translateY(-18px) rotate(2.5deg);opacity:0;}to{transform:translateY(0) rotate(-1.1deg);opacity:1;}}
.fb-word{position:relative;z-index:0;font-family:Anton,'Arial Narrow',sans-serif;text-transform:uppercase;text-align:center;
  font-size:clamp(40px,13vw,78px);line-height:1.02;letter-spacing:.01em;color:var(--ink);white-space:nowrap;}
.fb-word::before{content:attr(data-word);position:absolute;inset:0;color:var(--accent);transform:translate(2px,2px);
  opacity:.5;z-index:-1;}

.fb-watch{text-align:center;padding:24px 8px;}.fb-watch p{margin:0 0 6px;}
.fb-rules{display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--muted);border-top:1.5px dashed var(--line);padding-top:11px;}
.fb-rules.tight{border-top:none;padding-top:0;}
.fb-rules b{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin-right:7px;}
.fb-correct{display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--accent);color:#fff;border:3px solid var(--ink);font-family:Anton,sans-serif;font-weight:400;font-size:32px;letter-spacing:.04em;padding:18px 20px;box-shadow:6px 6px 0 var(--ink);}
.fb-correct:hover:not(:disabled){box-shadow:7px 7px 0 var(--ink);}
.fb-correct:active:not(:disabled){box-shadow:1px 1px 0 var(--ink);}
.fb-correct span{font-family:'Space Mono',monospace;font-size:12px;opacity:.75;font-weight:700;line-height:1;}
.fb-noskip{text-align:center;color:var(--muted);font-size:12px;margin:0;font-family:'Space Mono',monospace;}

.fb-flash{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.04em;color:var(--ink);
  background:var(--accent);border:2.5px solid var(--ink);padding:9px 13px;border-radius:6px;box-shadow:3px 3px 0 var(--ink);}
.fb-flash.big{font-family:Anton,sans-serif;font-weight:400;font-size:20px;letter-spacing:.03em;}
.fb-inherit{color:var(--muted);font-weight:400;margin:0;font-size:13px;font-family:'Space Mono',monospace;}
.fb-inherit::before{content:"\\21B3  ";opacity:.7;}
.fb-paused{margin:0;color:var(--muted);font-family:'Space Mono',monospace;font-size:13px;}.fb-paused b{color:var(--ink);font-size:18px;}
.fb-nextsetup{font-family:Anton,sans-serif;font-size:21px;color:var(--accent);display:flex;flex-direction:column;gap:5px;line-height:1.1;}
.fb-nextsetup span{font-family:Archivo,sans-serif;font-size:13px;color:var(--muted);}
.fb-nextsetup .fb-nextsetuphead{font-family:Anton,sans-serif;font-size:21px;color:var(--accent);display:inline-flex;align-items:center;justify-content:center;gap:7px;}

.fb-standings{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;width:100%;box-sizing:border-box;color:var(--muted);font-size:13px;background:var(--panel);border:2.5px solid var(--ink);box-shadow:4px 4px 0 var(--ink);border-radius:6px;padding:11px 12px;margin-top:6px;font-family:'Space Mono',monospace;}
.fb-standings b{font-family:Anton,sans-serif;font-weight:400;font-size:18px;vertical-align:-2px;}
.fb-stand{display:inline-flex;align-items:center;gap:5px;}
/* your own team, marked right in the score box */
.fb-stand.mine{background:#fff;border:2px solid currentColor;border-radius:999px;padding:2px 10px;box-shadow:2px 2px 0 currentColor;}
.fb-youtag{font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;border-radius:4px;padding:1px 5px;}
/* whose turn it is - an eyebrow above the big team name */
.fb-uplabel{font-family:'Space Mono',monospace;font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:-6px;}

.fb-modal{position:fixed;inset:0;background:rgba(20,26,34,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;z-index:50;}
.fb-modal .fb-card{max-width:500px;width:100%;}

.fb-rankrow{display:flex;align-items:center;gap:11px;background:#fff;border:2.5px solid var(--ink);border-radius:6px;padding:11px 14px;box-shadow:3px 3px 0 var(--ink);}
.fb-rank{font-family:Anton,sans-serif;color:var(--muted);width:20px;}
.fb-rankname{flex:1;font-weight:800;}
.fb-ranktotal{font-family:Anton,sans-serif;font-size:24px;color:var(--tc);}
.fb-details{color:var(--muted);font-size:14px;font-family:'Space Mono',monospace;}
.fb-details summary{cursor:pointer;padding:6px 0;letter-spacing:.06em;text-transform:uppercase;font-size:12px;}
.fb-scroll{overflow-x:auto;}
.fb-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;font-family:'Space Mono',monospace;}
.fb-table th,.fb-table td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap;}
.fb-table th{color:var(--muted);font-weight:700;}
.fb-th2{display:flex;flex-direction:column;align-items:center;gap:1px;}
.fb-th2 span{font-size:9px;letter-spacing:.06em;color:var(--muted);}
.fb-table th:first-child,.fb-table td:first-child{text-align:left;font-family:Archivo;font-weight:800;}

.fb-hostbar{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:14px;color:var(--muted);font-size:11px;font-family:'Space Mono',monospace;text-transform:uppercase;letter-spacing:.1em;}
.fb-hostbar button{background:var(--panel);border:2px solid var(--ink);color:var(--ink);border-radius:6px;padding:7px 11px;font-size:11px;cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:.08em;}
.fb-hostbar button:hover{color:var(--ink);border-color:var(--ink);box-shadow:2px 2px 0 var(--ink);}

@media (prefers-reduced-motion:reduce){
  .fb-vtimer.pulse{animation:none;}.fb-vt-disc{transition:none;}.fb-btn{transition:none;}.fb-slip{animation:none;}
  .fb-arrchip{animation:none;}
}
`;
