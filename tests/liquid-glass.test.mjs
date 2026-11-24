import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiquidGlassPixels, supportsLiquidRefraction, enhanceLiquidGlass } from '../src/liquid-glass.js';

test('液态折射只作用于边缘，中心保持中性且贴图尺寸匹配边框盒', () => {
  const map=createLiquidGlassPixels(100,40,12);
  assert.equal(map.displacement.length,100*40*4);
  assert.equal(map.specular.length,map.displacement.length);
  const center=(20*100+50)*4;
  assert.deepEqual([...map.displacement.slice(center,center+4)],[128,128,128,255]);
  assert.equal(map.specular[center+3],0);
  const top=(1*100+50)*4;
  assert.notEqual(map.displacement[top+1],128);
  assert.ok(map.specular[top+3]>0);
});

test('左右折射方向相反，镜面贴图不会给整块面板铺白色', () => {
  const map=createLiquidGlassPixels(100,40,12);
  const left=(20*100+1)*4, right=(20*100+99)*4;
  assert.ok(map.displacement[left]>128);
  assert.ok(map.displacement[right]<128);
  assert.ok(Math.abs(map.displacement[left]+map.displacement[right]-256)<=1);
  const lit=map.specular.filter((value,index)=>index%4===3&&value>0).length;
  assert.ok(lit>0&&lit<100*40*.15);
});

test('尺寸约束避免无效或过大的光学贴图，圆角安全约束于实际尺寸', () => {
  for (const size of [0,-1,NaN,Infinity,1025]) assert.throws(()=>createLiquidGlassPixels(size,40,12),RangeError);
  assert.throws(()=>createLiquidGlassPixels(100,513,12),RangeError);
  const map=createLiquidGlassPixels(24.3,20.2,100);
  assert.equal(map.width,24);
  assert.equal(map.height,20);
  assert.ok(map.bezel<=10);
});

test('SVG折射只在具备对应能力的Chromium上启用，其余浏览器保留磨砂降级', () => {
  assert.ok(supportsLiquidRefraction('Chrome/130.0',true));
  assert.ok(supportsLiquidRefraction('Chrome/130.0 Edg/130.0',true));
  assert.equal(supportsLiquidRefraction('Version/18.0 Safari/605.1',true),false);
  assert.equal(supportsLiquidRefraction('Firefox/130.0',true),false);
  assert.equal(supportsLiquidRefraction('Chrome/130.0 OPR/100',true),false);
  assert.equal(supportsLiquidRefraction('Chrome/130.0',false),false);
  assert.doesNotThrow(()=>enhanceLiquidGlass(null).destroy());
});
