/*
 * Vanilla adaptation of xiaojiaenen/liquid-glass's displacementMap and SVG
 * filter pipeline (revision d61ba1109a62f505b71f517470e8597e6dbfc268).
 * https://github.com/xiaojiaenen/liquid-glass
 * The upstream engine also credits Bhavya-Goswami/liquid-glass.
 *
 * MIT License — Copyright (c) xiaojiaenen and contributors
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Snell refraction across the upstream convex-squircle bezel profile.
export function createLiquidGlassPixels(width, height, radius) {
  if (![width,height,radius].every(Number.isFinite) || width < 1 || height < 1 || width > 1024 || height > 512 || radius < 0) throw new RangeError('Invalid glass dimensions');
  const w = Math.round(width), h = Math.round(height);
  const r = clamp(radius || 1, .5, Math.min(w,h) / 2);
  const bezel = Math.max(.5, r * .6), thickness = bezel * 3;
  const surface = x => (1 - (1 - x) ** 4) ** .25;
  const profile = Array.from({length:128}, (_, i) => {
    const x = i / 128, y = surface(x);
    const slope = (surface(x + .0001) - y) / .0001;
    const magnitude = Math.hypot(slope, 1), nx = -slope / magnitude, ny = -1 / magnitude;
    const eta = 1 / 1.5, k = 1 - eta * eta * (1 - ny * ny);
    const bend = eta * ny + Math.sqrt(Math.max(0,k));
    return (-bend * nx) * (y * bezel + thickness) / (eta - bend * ny);
  });
  const maximum = Math.max(...profile.map(Math.abs)) || 1;
  const displacement = new Uint8ClampedArray(w * h * 4);
  const specular = new Uint8ClampedArray(w * h * 4);
  const light = Math.PI / 3, rim = Math.min(1.2, bezel);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    displacement[i] = displacement[i+1] = displacement[i+2] = 128;
    displacement[i+3] = 255;
    const dx = x < r ? x-r : x >= w-r ? x-(w-r) : 0;
    const dy = y < r ? y-r : y >= h-r ? y-(h-r) : 0;
    const distance = Math.hypot(dx,dy);
    if (!distance || distance > r + 1 || distance < r - bezel) continue;
    const coverage = clamp(r + 1 - distance, 0, 1);
    const p = clamp(Math.floor(clamp((r-distance)/bezel,0,1) * 128),0,127);
    const shift = profile[p] / maximum * 127 * coverage;
    displacement[i] = clamp(128 - dx / distance * shift,0,255);
    displacement[i+1] = clamp(128 - dy / distance * shift,0,255);
    if (distance >= r - rim) {
      const facing = Math.abs(dx / distance * Math.cos(light) - dy / distance * Math.sin(light));
      const inward = clamp((r-distance)/rim,0,1);
      const reflection = facing * Math.sqrt(1 - (1-inward) ** 2);
      specular[i] = specular[i+1] = specular[i+2] = 255 * reflection;
      specular[i+3] = 255 * reflection * reflection * coverage;
    }
  }
  return {width:w,height:h,bezel,displacement,specular};
}

export function supportsLiquidRefraction(userAgent, supportsBackdrop) {
  return supportsBackdrop && /Chrome|Chromium|Edg/.test(userAgent) && !/OPR|Firefox/.test(userAgent);
}

export function enhanceLiquidGlass(root) {
  if (!root || !window.ResizeObserver || !window.MutationObserver) return {destroy() {}};
  const compact = matchMedia('(max-width: 900px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const supported = supportsLiquidRefraction(navigator.userAgent, globalThis.CSS?.supports?.('backdrop-filter','url(#glass)') || false);
  const states = new Map(), cache = new Map();
  const namespace = 'http://www.w3.org/2000/svg';
  let serial = 0, frame = 0, pointerFrame = 0, hovered;
  const svg = document.createElementNS(namespace,'svg');
  svg.setAttribute('aria-hidden','true');
  svg.setAttribute('focusable','false');
  svg.setAttribute('data-liquid-defs','');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  const defs = document.createElementNS(namespace,'defs');
  svg.append(defs);
  document.body.append(svg);
  function primitive(parent, name, attributes) {
    const node = document.createElementNS(namespace,name);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
    parent.append(node);
    return node;
  }
  function png(pixels,w,h) {
    const canvas = document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    const image = context.createImageData(w,h);
    image.data.set(pixels);
    context.putImageData(image,0,0);
    return canvas.toDataURL();
  }
  function remove(element) {
    if (hovered === element) resetPointer();
    const state = states.get(element);
    resize.unobserve(element);
    state?.filter?.remove();
    element.removeAttribute('data-liquid-glass');
    element.removeAttribute('data-liquid-kind');
    for (const key of ['--liquid-backdrop','--liquid-angle','--liquid-rim-strength']) element.style.removeProperty(key);
    states.delete(element);
  }
  function update(element) {
    const state = states.get(element);
    if (!state || !element.isConnected) return;
    const mode = supported && !compact.matches && fine.matches ? 'refracted' : 'frosted';
    const rect = element.getBoundingClientRect(), css = getComputedStyle(element);
    const width=Math.round(rect.width), height=Math.round(rect.height), radius=parseFloat(css.borderTopLeftRadius) || 6;
    const key = `${width}:${height}:${radius}:${mode}`;
    if (key === state.key || !width || !height) return;
    state.key=key;
    state.filter?.remove(); state.filter=null;
    element.style.removeProperty('--liquid-backdrop');
    element.dataset.liquidGlass='frosted';
    if (mode !== 'refracted') return;
    try {
      let maps = cache.get(key);
      if (!maps) {
        const pixels=createLiquidGlassPixels(width,height,radius);
        maps={displacement:png(pixels.displacement,width,height),specular:png(pixels.specular,width,height),bezel:pixels.bezel};
        if (cache.size >= 12) cache.delete(cache.keys().next().value);
        cache.set(key,maps);
      }
      const id=`cijian-liquid-${++serial}`;
      const filter=primitive(defs,'filter',{id,x:'-20%',y:'-20%',width:'140%',height:'140%','color-interpolation-filters':'sRGB'});
      primitive(filter,'feGaussianBlur',{in:'SourceGraphic',stdDeviation:.45,result:'soft'});
      primitive(filter,'feImage',{href:maps.displacement,x:0,y:0,width,height,preserveAspectRatio:'none',result:'displacement'});
      const strength=parseFloat(css.getPropertyValue('--liquid-refraction-scale')) || .618;
      primitive(filter,'feDisplacementMap',{in:'soft',in2:'displacement',scale:2*maps.bezel*strength,xChannelSelector:'R',yChannelSelector:'G',result:'refracted'});
      primitive(filter,'feColorMatrix',{in:'refracted',type:'saturate',values:1.12,result:'tinted'});
      primitive(filter,'feImage',{href:maps.specular,x:0,y:0,width,height,preserveAspectRatio:'none',result:'reflection'});
      const transfer=primitive(filter,'feComponentTransfer',{in:'reflection',result:'rim'});
      primitive(transfer,'feFuncA',{type:'linear',slope:.18});
      primitive(filter,'feBlend',{in:'rim',in2:'tinted',mode:'screen'});
      state.filter=filter;
      element.style.setProperty('--liquid-backdrop',`url("#${id}")`);
      element.dataset.liquidGlass='refracted';
    } catch {
      // Frosted CSS remains usable without canvas/SVG backdrop support.
      state.filter?.remove(); state.filter=null;
    }
  }
  function sync() {
    frame=0;
    const targets = new Set(root.querySelector('.vocabulary-home') ? root.querySelectorAll('.vocabulary-home .daily-goal,.sidebar .nav-item.active,.sidebar .chapter-item.active') : []);
    for (const element of states.keys()) if (!targets.has(element)) remove(element);
    for (const element of targets) {
      if (!states.has(element)) {
        states.set(element,{key:'',filter:null});
        element.dataset.liquidKind=element.matches('.daily-goal') ? 'overview' : element.matches('.filter-tabs button') ? 'filter' : 'navigation';
        element.dataset.liquidGlass='frosted';
        resize.observe(element);
      }
      update(element);
    }
  }
  const schedule = () => { if (!frame) frame=requestAnimationFrame(sync); };
  const resize=new ResizeObserver(schedule);
  const observer=new MutationObserver(schedule);
  function resetPointer() {
    cancelAnimationFrame(pointerFrame); pointerFrame=0;
    hovered?.style.removeProperty('--liquid-angle');
    hovered?.style.removeProperty('--liquid-rim-strength');
    hovered=null;
  }
  function pointer(event) {
    if (reduced.matches || !fine.matches || compact.matches) return;
    const element=event.target.closest('[data-liquid-glass]');
    if (!element) { resetPointer(); return; }
    if (hovered !== element) resetPointer();
    hovered=element;
    cancelAnimationFrame(pointerFrame);
    const {clientX,clientY}=event;
    pointerFrame=requestAnimationFrame(() => {
      pointerFrame=0;
      if (!element.isConnected || reduced.matches) return;
      const box=element.getBoundingClientRect();
      const x=(clientX-box.left-box.width/2)/(box.width/2), y=(clientY-box.top-box.height/2)/(box.height/2);
      element.style.setProperty('--liquid-angle',`${Math.atan2(y,x)*180/Math.PI+90}deg`);
      element.style.setProperty('--liquid-rim-strength',String(.35 + .35*clamp(Math.max(Math.abs(x),Math.abs(y)),0,1)));
    });
  }
  function preferenceChanged() { resetPointer(); schedule(); }
  root.addEventListener('pointermove',pointer,{passive:true});
  root.addEventListener('pointerleave',resetPointer,{passive:true});
  compact.addEventListener('change',preferenceChanged);
  reduced.addEventListener('change',preferenceChanged);
  fine.addEventListener('change',preferenceChanged);
  observer.observe(root,{childList:true,subtree:true});
  sync();
  return {destroy() {
    observer.disconnect(); resize.disconnect();
    cancelAnimationFrame(frame); resetPointer();
    root.removeEventListener('pointermove',pointer);
    root.removeEventListener('pointerleave',resetPointer);
    compact.removeEventListener('change',preferenceChanged);
    reduced.removeEventListener('change',preferenceChanged);
    fine.removeEventListener('change',preferenceChanged);
    for (const element of states.keys()) remove(element);
    cache.clear(); svg.remove();
  }};
}
