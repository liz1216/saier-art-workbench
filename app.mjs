// 赛尔·美术工作台入口：同源静态 iframe、本地素材、可审计参数 JSON。
const $=id=>document.getElementById(id);
const ROLES={model:'头部模型 GLB',skin:'ash 皮肤贴图',bloodshot:'蓝紫眼睛贴图',horizontal:'横瞳眼睛贴图',vertical:'琥珀竖瞳眼睛贴图'};
const EYE_NAMES={embedded:'模型内置',bloodshot:'蓝紫',horizontal:'横瞳',vertical:'琥珀／竖瞳'};
const assets={
  model:null,
  skin:{name:'skin-default.png',url:'./assets/skin-default.png',default:true},
  bloodshot:null,horizontal:null,vertical:null
};
const eyes={human:'embedded'};
const lifecycle=new AbortController();
let frame=null,generation=0,clean=false,busy=false,roleToChoose=null,pendingState=null,disposed=false;

function status(message,state='loading'){
  const node=$('loadStatus');
  if(node){node.textContent=message||'';node.dataset.state=state;}
  const emptyMessage=$('emptyMessage');
  if(state==='error'&&emptyMessage)emptyMessage.textContent=message||'本地素材载入失败。';
}
function api(){try{return frame?.contentWindow?.workbenchView||null;}catch{return null;}}
function saveFile(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function releaseAsset(item){if(item&&typeof item.url==='string'&&item.url.startsWith('blob:'))URL.revokeObjectURL(item.url);}
function setReady(ready){for(const id of ['shotButton','exportSettings'])$(id).disabled=!ready;}
function toggleControls(show){
  const visible=typeof show==='boolean'?show:clean;
  clean=!visible;$('workbench').classList.toggle('clean',clean);$('returnUI').hidden=!clean;
  api()?.toggleControls(visible);
}
function fail(message){status(message,'error');$('empty').hidden=false;$('assetsPanel').hidden=false;setReady(false);}
function dispose(){
  if(disposed)return;disposed=true;generation++;lifecycle.abort();frame?.remove();frame=null;
  for(const key of Object.keys(assets)){releaseAsset(assets[key]);assets[key]=null;}
}
window.ART_WORKBENCH={assets,eyes,get view(){return 'solo';},status,toggleControls,dispose,get apiReady(){return Boolean(api()?.ready)}};

function inferRole(file){
  const path=(file.webkitRelativePath||file.name).toLowerCase();
  if(/\.glb$/i.test(path))return 'model';
  if(!/\.(png|jpe?g|webp)$/i.test(path))return null;
  if(/bloodshot|蓝紫|eye[-_]01/.test(path))return 'bloodshot';
  if(/horizontal|横瞳|eye[-_]02/.test(path))return 'horizontal';
  if(/vertical|竖瞳|琥珀|eye[-_]03/.test(path))return 'vertical';
  if(/skin|ivory|ash|骨白|肤色/.test(path))return 'skin';
  return null;
}
function parseGLBHeader(bytes,totalSize){
  const data=new DataView(bytes);
  if(data.byteLength<20||data.getUint32(0,true)!==0x46546c67||data.getUint32(4,true)!==2)throw new Error('GLB 文件头不正确。');
  const length=data.getUint32(8,true);if(length!==totalSize||data.getUint32(16,true)!==0x4e4f534a)throw new Error('GLB 结构或长度不正确。');
  const jsonLength=data.getUint32(12,true);if(jsonLength>16*1024*1024||jsonLength+20>totalSize)throw new Error('GLB JSON 区块过大。');
  return {jsonLength};
}
async function validateModelBlob(blob){
  const header=await blob.slice(0,20).arrayBuffer(),{jsonLength}=parseGLBHeader(header,blob.size);
  const json=JSON.parse(await blob.slice(20,20+jsonLength).text());
  for(const name of ['Head Skin Web','Eyes Web'])if(!json.materials?.some(material=>material.name===name))throw new Error(`模型缺少 ${name} 材质。`);
  if(json.buffers?.some(buffer=>buffer.uri&&!buffer.uri.startsWith('data:'))||json.images?.some(image=>image.uri&&!image.uri.startsWith('data:')))throw new Error('请使用贴图与几何内嵌的 GLB。');
}
async function validateFile(file,role){
  if(!file.size)throw new Error(`${file.name} 是空文件。`);
  if(role==='model'){
    if(!/\.glb$/i.test(file.name))throw new Error('头模请选择 GLB 文件。');
    if(file.size>512*1024*1024)throw new Error('GLB 超过 512 MiB，暂不导入。');
    await validateModelBlob(file);
    return;
  }
  if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('贴图请选择 PNG、JPG 或 WebP。');
  if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(file);bitmap.close();}
}

function renderFiles(){
  const rows=$('assetRows');rows.replaceChildren();
  for(const [role,label] of Object.entries(ROLES)){
    const row=document.createElement('div');row.className='assetrow';
    const name=document.createElement('strong');name.textContent=label;
    const info=document.createElement('small');info.textContent=assets[role]?.name||'未导入';
    const button=document.createElement('button');button.type='button';button.textContent=assets[role]?'替换':'选择';button.onclick=()=>{roleToChoose=role;$('hiddenFile').accept=role==='model'?'.glb':'.png,.jpg,.jpeg,.webp';$('hiddenFile').click();};
    row.append(name,button,info);rows.append(row);
  }
  const select=$('eye-human');select.replaceChildren();
  for(const [id,label] of Object.entries(EYE_NAMES)){if(id!=='embedded'&&!assets[id])continue;const option=document.createElement('option');option.value=id;option.textContent=label;select.append(option);}
  if(eyes.human!=='embedded'&&!assets[eyes.human])eyes.human='embedded';
  select.value=eyes.human;select.disabled=!assets.model;
}

async function importFiles(files,explicitRole=null){
  if(busy){status('当前正在导入，请稍等。','error');return;}
  const selected=[...files].map(file=>({file,role:explicitRole||inferRole(file)})).filter(item=>item.role);
  if(!selected.length){status('没有识别到 GLB 或贴图，请在素材面板选择具体类型。','error');$('assetsPanel').hidden=false;return;}
  if(new Set(selected.map(item=>item.role)).size!==selected.length){status('同一类素材有多份，请只选择一份。','error');return;}
  busy=true;status('正在检查本地素材…');
  try{
    for(const item of selected)await validateFile(item.file,item.role);
    if(api()?.ready)pendingState=api().getState();
    const old=[];
    for(const {file,role} of selected){if(assets[role])old.push(assets[role]);assets[role]={name:file.name,url:URL.createObjectURL(file),default:false};}
    old.forEach(releaseAsset);
    if(assets.model){$('empty').hidden=true;$('assetsPanel').hidden=true;await loadView(false);}else fail('请先选择兼容的头部 GLB。');
  }catch(error){status(error.message||'本地文件读取失败。','error');$('assetsPanel').hidden=false;}
  finally{busy=false;renderFiles();}
}

async function loadView(remember=true){
  const version=++generation;
  if(remember&&api()?.ready)pendingState=api().getState();
  frame?.remove();frame=null;setReady(false);renderFiles();
  if(!assets.model?.url){status('正在等待默认头模…');return;}
  status('正在载入赛尔单头…');
  frame=document.createElement('iframe');frame.title='赛尔单头镜头';frame.src='./solo.html';frame.allow="camera 'none'; microphone 'none'";frame.referrerPolicy='no-referrer';$('viewport').append(frame);
  const started=performance.now();
  while(version===generation&&!disposed){
    const child=api();
    if(child?.ready){
      try{
        if(pendingState){const state=pendingState;pendingState=null;child.setState(state);}
        await child.setEye('human',eyes.human);
        child.toggleControls(!clean&&window.innerWidth>760);setReady(true);$('empty').hidden=true;$('assetsPanel').hidden=true;
        status('已载入 · H 隐藏界面，Esc 恢复','ready');
      }catch(error){fail(error.message||'场景参数载入失败。');}
      return;
    }
    if(performance.now()-started>180000){fail('模型加载超时，请检查默认 GLB 与浏览器性能。');return;}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
}

function assertSafe(value,depth=0,count={n:0}){
  if(depth>15||++count.n>2000)throw new Error('参数层级或字段过多。');
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('参数包含不允许的字段。');assertSafe(item,depth+1,count);}
}
const LOOK_RANGES={exposure:[.5,2],contrast:[.7,1.6],sat:[0,1.5],glow:[0,1],keyI:[0,9],keyAz:[-90,90],keyEl:[-15,75],keyWarm:[0,1],keyCone:[.15,.75],rimI:[0,9],rimAz:[60,180],rimEl:[-15,60],rimCone:[.15,.75],fill:[0,1.5],env:[0,1],skinRoughnessOffset:[-.5,.5],skinNormalStrength:[0,2],ringLevel:[0,1],r0:[.3,1.4],r1:[.6,2],neckFull:[-.5,2],neckZero:[-1,1.5],neckCurve:[0,2.5],dof:[0,1],dofSoft:[.2,3],dofDead:[0,1.2],focusOffset:[-1,1],vig:[0,1],grain:[0,.15],quietDim:[0,.85],lifeAmp:[0,3],exprAmp:[0,2],flatSpread:[.4,1.5],flatHeight:[1,14],flatX:[-16,16],flatY:[0,4],flatFov:[2,30]};
const CAM_RANGES={dist:[.6,8],fov:[6,60],height:[1.3,2.8],x:[-1,1]};
function validateRangeObject(raw,ranges,label){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`${label} 参数格式不正确。`);
  const out={};
  for(const [key,value] of Object.entries(raw)){
    if(key==='preset'){if(value!=='black'&&value!=='white')throw new Error('灯光预设不正确。');out[key]=value;continue;}
    if(['bg'].includes(key)){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error(`${key} 颜色不正确。`);out[key]=value;continue;}
    if(key==='focusHead'){if(value!=='auto'&&value!=='human')throw new Error('对焦目标不正确。');out[key]=value;continue;}
    if(['tag','eyeFlipV','showRing','showAudience'].includes(key)){if(typeof value!=='boolean')throw new Error(`${key} 开关不正确。`);out[key]=value;continue;}
    if(!(key in ranges))continue;
    const n=Number(value),range=ranges[key];if(!Number.isFinite(n)||n<range[0]||n>range[1])throw new Error(`${key} 超出允许范围。`);out[key]=n;
  }
  return out;
}
function validateState(state){
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('参数 state 格式不正确。');
  return {look:validateRangeObject(state.look,LOOK_RANGES,'灯光'),cam:validateRangeObject(state.cam,CAM_RANGES,'相机')};
}
async function importSettings(file){
  try{
    if(!file||file.size>1024*1024)throw new Error('请选择小于 1 MB 的参数 JSON。');
    const data=JSON.parse(await file.text());assertSafe(data);
    if(data.format!=='saier-art-workbench'||data.version!==1||data.view!=='solo')throw new Error('不是赛尔工作台导出的参数文件。');
    const state=validateState(data.state);const id=data.eyes?.human||'embedded';if(!(id in EYE_NAMES))throw new Error('眼睛参数不正确。');
    eyes.human=assets[id]?id:'embedded';pendingState=state;await loadView(false);
  }catch(error){status(error.message||'参数文件读取失败。','error');}
}
async function loadDefaultModel(){
  try{
    const response=await fetch('./assets/head.glb.gz');if(!response.ok)throw new Error(`默认头模读取失败（HTTP ${response.status}）。`);
    if(typeof DecompressionStream!=='function')throw new Error('当前浏览器不支持 gzip 解压，请手动选择 GLB。');
    const compressed=await response.arrayBuffer();const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));const blob=await new Response(stream).blob();
    await validateModelBlob(blob);if(assets.model&&!assets.model.default)return;
    const url=URL.createObjectURL(blob);if(assets.model)releaseAsset(assets.model);assets.model={name:'head.glb.gz（已解压）',url,default:true};
    await loadView(false);
  }catch(error){fail(`${error.message||'默认头模读取失败。'} 可在左侧选择兼容 GLB。`);}
}

$('assetsButton').onclick=()=>{$('assetsPanel').hidden=!$('assetsPanel').hidden;};
$('controlsButton').onclick=()=>{const panel=frame?.contentDocument?.getElementById('panel');api()?.toggleControls(!panel?.classList.contains('on'));};
$('chooseFiles').onclick=()=>{$('assetsPanel').hidden=false;$('hiddenFile').accept='.glb,.png,.jpg,.jpeg,.webp';$('hiddenFile').click();};
$('hiddenFile').onchange=event=>{if(event.target.files.length)importFiles(event.target.files,roleToChoose);roleToChoose=null;event.target.value='';};
$('eye-human').onchange=async event=>{eyes.human=event.target.value;try{await api()?.setEye('human',eyes.human);}catch(error){status(error.message,'error');}};
$('importSettings').onclick=()=>$('settingsFile').click();
$('settingsFile').onchange=event=>{if(event.target.files.length)importSettings(event.target.files[0]);event.target.value='';};
$('exportSettings').onclick=()=>{try{const child=api();if(!child?.ready)throw new Error('场景尚未载入。');const data={format:'saier-art-workbench',version:1,view:'solo',eyes:{human:eyes.human},state:child.getState()};saveFile(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`赛尔-solo-参数-${stamp()}.json`);}catch(error){status(error.message,'error');}};
$('shotButton').onclick=async()=>{try{const blob=await api().screenshot();saveFile(blob,`赛尔-solo-${stamp()}.png`);}catch(error){status(error.message||'截图失败。','error');}};
$('hideButton').onclick=()=>toggleControls(false);$('returnUI').onclick=()=>toggleControls(true);
addEventListener('keydown',event=>{if(event.target.closest?.('input,select,textarea'))return;if(event.key.toLowerCase()==='h')toggleControls();if(event.key==='Escape')toggleControls(true);},{signal:lifecycle.signal});
let dragDepth=0;
addEventListener('dragenter',event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth++;document.body.classList.add('drop-on');}},{signal:lifecycle.signal});
addEventListener('dragover',event=>event.preventDefault(),{signal:lifecycle.signal});
addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('drop-on');}},{signal:lifecycle.signal});
addEventListener('drop',async event=>{event.preventDefault();dragDepth=0;document.body.classList.remove('drop-on');try{await importFiles([...event.dataTransfer.files]);}catch(error){status(error.message||'拖放素材失败。','error');}},{signal:lifecycle.signal});
addEventListener('beforeunload',dispose,{signal:lifecycle.signal});
renderFiles();
void loadDefaultModel();
