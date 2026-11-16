import * as THREE from 'three';

// 只允许同源父页面提供本地资源与工作台桥，不使用 postMessage 或跨源回退。
const parentWindow=window.parent;
if(parentWindow===window)throw new Error('请从赛尔美术工作台入口打开单头预览。');
let workbench;
try{
  if(parentWindow.location.origin!==window.location.origin)throw new Error('单头预览必须与工作台同源。');
  workbench=parentWindow.ART_WORKBENCH;
}catch{throw new Error('单头预览必须与工作台同源。');}
if(!workbench?.assets?.model?.url)throw new Error('默认头模尚未准备好，请稍候。');

export const assets=workbench.assets;
export const eyes=workbench.eyes;
export const view=workbench.view;
export const reportStatus=(message,state='loading')=>workbench.status?.(message,state);

THREE.DefaultLoadingManager.setURLModifier(url=>{
  if(/^(blob:|data:)/.test(url))return url;
  const path=decodeURIComponent(url.split('?')[0]);
  if(/(?:^|\/)head(?:-[^/]+)?\.glb$/i.test(path))return assets.model.url;
  if(assets.skin&&/(?:ivory|skin|ash)[^/]*\.(?:png|jpe?g|webp)$/i.test(path))return assets.skin.url;
  const match=path.match(/(?:eyes-original-v1\/)?(bloodshot|horizontal|vertical)(?:\/basecolor)?\.(?:png|jpe?g|webp)$/i);
  return match&&assets[match[1]]?assets[match[1]].url:url;
});

addEventListener('keydown',event=>{
  if(event.target?.closest?.('input,textarea,select')||event.ctrlKey||event.metaKey)return;
  if(event.key.toLowerCase()==='h'){event.preventDefault();workbench.toggleControls?.();}
  if(event.key==='Escape')workbench.toggleControls?.(true);
});
