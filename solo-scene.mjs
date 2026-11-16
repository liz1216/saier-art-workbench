// 赛尔单头美术工作台：单头、黑底、固定 theater 光起点，可调灯光、材质与相机。
import {assets,eyes as importedEyes,reportStatus} from './local-bridge.mjs';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const $=id=>document.getElementById(id);
const stage=$('stage');
const canvas=$('stageCanvas');
const stageStatus=$('stageStatus');
const slots=['human'];
const frames={human:null};
const MORPHS=['jawOpen','mouthSmile','mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','mouthLeft','mouthRight','mouthPucker','mouthWide','mouthFunnel','mouthPress','mouthSmileOpen','cheekRaiseLeft','cheekRaiseRight','noseSneerLeft','noseSneerRight','browRaise','browFrown','eyeBlinkLeft','eyeBlinkRight','eyeLidFollowLeft','eyeLidFollowRight'];
const EYES=['eyeYaw','eyePitch'];
const VIEWS=['center','inside','far','top'];
const ANGLES={human:0};
const RADIUS=3.45;
const FACE_UP=.65;   // 面部中心相对头部原点的高度
const EYE_UP=1.16;   // 双眼相对头部原点的高度
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const headState=()=>({face:{},pose:{pitch:0,yaw:0,roll:0}});
const drivers=Object.fromEntries(slots.map(slot=>[slot,headState()]));
const params=new URLSearchParams(location.search);

let renderer,scene,camera,orbit;
let hemiLight;
let wallMaterial,floorMaterial,silhouetteMaterial,trimMaterial;
let ringGroup=null,audience=null;
let heads={};
let currentView='center';
let modelReady=false;
let lastFrame=0;
let currentSpeaker=null;
const speakingSince={human:0};
let humanMouthUntil=0;
const lastDriverAt={human:0};
const idle=Object.fromEntries(slots.map((slot,index)=>[slot,{nextBlink:performance.now()+1200+index*900,blinkStart:0,seed:index*2.7}]));

// 相机状态：飞行动画与场内环顾
const look={yaw:0,pitch:0,targetYaw:0,targetPitch:0,dragging:false,x:0,y:0};
const cam={pos:new THREE.Vector3(),target:new THREE.Vector3(),fov:60,tween:null,free:true};
const Y_AXIS=new THREE.Vector3(0,1,0);

const CAMERAS={
  center:{pos:[0,.55,.9],target:[0,1.55,-3.45],fov:74},
  inside:{pos:[0,1.55,5.55],target:[0,1.15,-1.8],fov:36},
  far:{pos:[0,3.1,9.7],target:[0,1.1,-.8],fov:34},
  top:{pos:[0,11.8,6.8],target:[0,.3,-.8],fov:52}
};

/* ================= 外观参数 ================= */
const SCHEMA=[
  {group:'背景与影调',items:[
    {key:'bg',label:'背景颜色',type:'color'},
    {key:'exposure',label:'曝光',min:.5,max:2,step:.01},
    {key:'contrast',label:'对比度',min:.7,max:1.6,step:.01},
    {key:'sat',label:'饱和度',min:0,max:1.5,step:.01},
    {key:'glow',label:'舞台微光',min:0,max:1,step:.01}]},
  {group:'主光',items:[
    {key:'keyI',label:'主光强度',min:0,max:9,step:.1},
    {key:'keyAz',label:'主光方位（负＝画面左）',min:-90,max:90,step:1},
    {key:'keyEl',label:'主光高度角',min:-15,max:75,step:1},
    {key:'keyWarm',label:'主光色温',min:0,max:1,step:.01},
    {key:'keyCone',label:'主光范围',min:.15,max:.75,step:.01}]},
  {group:'轮廓光',items:[
    {key:'rimI',label:'轮廓光强度',min:0,max:9,step:.1},
    {key:'rimAz',label:'轮廓光方位',min:60,max:180,step:1},
    {key:'rimEl',label:'轮廓光高度角',min:-15,max:60,step:1},
    {key:'rimCone',label:'轮廓光范围',min:.15,max:.75,step:.01}]},
  {group:'补光',items:[
    {key:'fill',label:'环境补光',min:0,max:1.5,step:.01},
    {key:'env',label:'环境反射',min:0,max:1,step:.01}]},
  {group:'材质',items:[
    {key:'skinRoughnessOffset',label:'皮肤粗糙度偏移',min:-.5,max:.5,step:.01},
    {key:'skinNormalStrength',label:'皮肤法线强度',min:0,max:2,step:.01}]},
  {group:'脸以外的衰减',items:[
    {key:'ringLevel',label:'发/耳轮廓保留亮度',min:0,max:1,step:.01},
    {key:'r0',label:'脸部完整范围',min:.3,max:1.4,step:.01},
    {key:'r1',label:'衰减到轮廓的位置',min:.6,max:2,step:.01},
    {key:'neckFull',label:'颈部开始渐隐',min:-.5,max:2,step:.01},
    {key:'neckZero',label:'颈部完全消失',min:-1,max:1.5,step:.01},
    {key:'neckCurve',label:'颈部渐隐弧度',min:0,max:2.5,step:.01}]},
  {group:'虚焦',items:[
    {key:'dof',label:'虚焦强度',min:0,max:1,step:.01},
    {key:'dofSoft',label:'虚焦过渡深度',min:.2,max:3,step:.01},
    {key:'dofDead',label:'清晰深度范围',min:0,max:1.2,step:.01},
    {key:'focusHead',label:'对焦在',type:'select',options:[['auto','画面中心的脸'],['human','头部']]},
    {key:'focusOffset',label:'焦点前后偏移',min:-1,max:1,step:.01}]},
  {group:'情绪标签',items:[
    {key:'tag',label:'显示情绪标签',type:'bool'},
    {key:'tagSize',label:'字的大小',min:.4,max:3,step:.01},
    {key:'tagShift',label:'左右位置（正＝画面右）',min:-.7,max:.7,step:.005},
    {key:'tagRadius',label:'前后位置（负＝靠近观众）',min:-2,max:1.2,step:.01},
    {key:'tagHeight',label:'高度',min:-1.5,max:1.5,step:.01},
    {key:'tagHold',label:'停留时间',min:0,max:12,step:.1},
    {key:'tagFade',label:'淡入淡出时长',min:.1,max:4,step:.05},
    {key:'tagSpacing',label:'字距',min:0,max:1.4,step:.01},
    {key:'tagBright',label:'亮度',min:.1,max:1.5,step:.01}]},
  {group:'画面质感',items:[
    {key:'vig',label:'暗角/边缘渐隐',min:0,max:1,step:.01},
    {key:'grain',label:'胶片颗粒',min:0,max:.15,step:.005}]},
  {group:'说话的主次',items:[
    {key:'quietDim',label:'没说话的脸压暗多少',min:0,max:.85,step:.01},
    {key:'lifeAmp',label:'动作幅度（点头、歪头、转头）',min:0,max:3,step:.05},
    {key:'exprAmp',label:'表情强度',min:0,max:2,step:.05},
    {key:'eyeFlipV',label:'眼睛上下看反了就打开',type:'bool'}]},
  {group:'环屏平铺',items:[
    {key:'flatSpread',label:'三颗头的间距',min:.4,max:1.5,step:.01},
    {key:'flatHeight',label:'取景高度',min:1,max:14,step:.05},
    {key:'flatX',label:'画面左右平移',min:-16,max:16,step:.01},
    {key:'flatY',label:'视线高度· 拖动',min:0,max:4,step:.01},
    {key:'flatFov',label:'透视强度',min:2,max:30,step:.5}]}
];
const ITEMS=Object.fromEntries(SCHEMA.flatMap(group=>group.items.map(item=>[item.key,item])));
// 仅把单头美术控制暴露给 UI；旧版表演/环屏参数不进入新工作台面板。
const PUBLIC_SCHEMA=SCHEMA.filter(group=>!['情绪标签','说话的主次','环屏平铺'].includes(group.group));

const BASE={
  bg:'#000000',exposure:1,contrast:1.1,sat:.95,glow:0,tag:false,tagSize:1.15,tagShift:0,tagRadius:0,tagHeight:0,tagHold:1.8,tagFade:1,tagSpacing:.5,tagBright:1,
  keyI:3.8,keyAz:-40,keyEl:24,keyWarm:.78,keyCone:.38,
  rimI:3.6,rimAz:142,rimEl:14,rimCone:.44,
  fill:.35,env:.22,skinRoughnessOffset:0,skinNormalStrength:1,
  ringLevel:.4,r0:.62,r1:1.22,neckFull:.95,neckZero:.2,neckCurve:.9,
  dof:0,dofSoft:.75,dofDead:.12,focusHead:'auto',focusOffset:0,
  vig:.3,grain:.03,
  spacing:1.05,quietDim:.3,lifeAmp:1.4,exprAmp:1.2,eyeFlipV:false,flatSpread:.72,flatHeight:3.8,flatX:0,flatY:1.75,flatFov:8,showRing:false,showAudience:true,audienceMotion:1,audienceHeight:2.2,audienceLight:0
};
const PRESETS={
  black:{...BASE},
  white:{...BASE,bg:'#f4f4f2',exposure:1.02,contrast:1.12,keyI:3.1,keyAz:-30,keyEl:22,keyWarm:.55,rimI:2.2,fill:.6,env:.4,glow:0,ringLevel:.58,vig:0,grain:.025,showRing:false}
};
const STORE_KEY='saier-art-workbench.solo.looks.v1';
let LOOK={preset:'black',...PRESETS.black};
let saved={};
try{if(params.has('reset'))localStorage.removeItem(STORE_KEY);saved=JSON.parse(localStorage.getItem(STORE_KEY)||'{}')||{};}catch{saved={};}
// 旧版记录里的纯黑背景不覆盖新的渐变默认

// 现场固化的默认值：ring-look.json（“保存参数”按钮写入）。比浏览器里的记录新就用它；?show=1 时只用它
let fileLook=null;
// 本地审核版不读取旧站固化设置文件。
if(fileLook&&typeof fileLook==='object'){
  if(params.has('show'))saved={...fileLook};
  else{
    for(const k of Object.keys(PRESETS)){const f=fileLook[k];if(f&&(Number(f._t)||0)>=(Number(saved[k]?._t)||0))saved[k]=f;}
    if(fileLook.current&&!saved.current)saved.current=fileLook.current;
  }
}

function sanitize(raw,fallback){
  const out={};
  for(const key of Object.keys(fallback))if(!(key in ITEMS))out[key]=fallback[key];
  for(const [key,item] of Object.entries(ITEMS)){
    const value=raw?.[key];
    if(item.type==='color')out[key]=typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback[key];
    else if(item.type==='bool')out[key]=typeof value==='boolean'?value:fallback[key];
    else if(item.type==='select')out[key]=item.options.some(option=>option[0]===value)?value:fallback[key];
    else out[key]=clamp(number(value,fallback[key]),item.min,item.max);
  }
  return out;
}
function persist(){
  try{saved[LOOK.preset]={...LOOK,_t:Date.now()};delete saved[LOOK.preset].preset;saved.current=LOOK.preset;localStorage.setItem(STORE_KEY,JSON.stringify(saved));}catch{}
}
function lookChanged(){window.dispatchEvent(new CustomEvent('saier-look-change',{detail:{preset:LOOK.preset,look:{...LOOK}}}));}

function applyPreset(name,{fresh=false}={}){
  const preset=PRESETS[name]?name:'black';
  const base=PRESETS[preset];
  LOOK={preset,...sanitize(fresh?base:saved[preset],base)};
  applyLook();persist();lookChanged();
  return {...LOOK};
}
function setLook(next={}){
  if(!next||typeof next!=='object')return {...LOOK};
  if(typeof next.preset==='string'&&next.preset!==LOOK.preset&&PRESETS[next.preset]){
    applyPreset(next.preset);
    const {preset,...rest}=next;if(Object.keys(rest).length)setLook(rest);
    return {...LOOK};
  }
  const {preset,...rest}=next;
  LOOK={preset:LOOK.preset,...sanitize({...LOOK,...rest},PRESETS[LOOK.preset])};
  applyLook();persist();lookChanged();
  return {...LOOK};
}

/* ================= 后期（景深 + 影调） ================= */
let rt,postScene,postCamera,postMaterial;
const MASK_UNI={uP:{value:new THREE.Vector4(.4,.62,1.22,0)},uN:{value:new THREE.Vector4(.95,.2,0,0)},uA:{value:new THREE.Vector3(1.3,2.1,1.2)}};

function createPost(){
  postMaterial=new THREE.ShaderMaterial({
    uniforms:{
      tColor:{value:null},tDepth:{value:null},uRes:{value:new THREE.Vector2(1,1)},
      uNear:{value:.05},uFar:{value:40},uFocus:{value:4},uBlur:{value:0},uSoft:{value:.75},uDead:{value:.12},
      uVig:{value:0},uGlow:{value:0},uGrain:{value:0},uTime:{value:0},uContrast:{value:1},uSat:{value:1},uBg:{value:new THREE.Color(0x000000)},
      uBgEdge:{value:new THREE.Color(0x000000)},uBgSpot:{value:new THREE.Color(0x000000)},uGrad:{value:0},uSpot:{value:new THREE.Vector3(.5,0,.2)},uLevel:{value:1}
    },
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader:`
      uniform sampler2D tColor; uniform sampler2D tDepth;
      uniform vec2 uRes; uniform float uNear,uFar,uFocus,uBlur,uSoft,uDead,uVig,uGrain,uTime,uContrast,uSat,uGlow;
      uniform vec3 uBg,uBgEdge,uBgSpot; uniform float uGrad,uLevel; uniform vec3 uSpot;
      varying vec2 vUv;
      #include <packing>
      #define SAMPLES 32
      float viewDist(float d){ return -perspectiveDepthToViewZ(d,uNear,uFar); }
      float cocOf(float dist,float d){
        if(d>=.99999) return uBlur;
        float x=max(abs(dist-uFocus)-uDead,0.);
        return uBlur*smoothstep(0.,uSoft,x);
      }
      float hash(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
      void main(){
        float dC=texture2D(tDepth,vUv).x;
        float distC=viewDist(dC);
        float cC=cocOf(distC,dC);
        vec4 acc=texture2D(tColor,vUv); float wsum=1.;
        if(cC>.75){
          for(int i=0;i<SAMPLES;i++){
            float fi=float(i)+.5;
            float t=sqrt(fi/float(SAMPLES))*cC;
            float ang=fi*2.39996323;
            vec2 uv=vUv+vec2(cos(ang),sin(ang))*t/uRes;
            float d=texture2D(tDepth,uv).x;
            float dist=viewDist(d);
            float w=1.;
            if(dist<distC) w=smoothstep(t-1.,t+1.,cocOf(dist,d));
            acc+=texture2D(tColor,uv)*w; wsum+=w;
          }
        }
        vec4 c=acc/wsum;
        float a=clamp(c.a,0.,1.);
        vec3 base=a>.0005? c.rgb/a : vec3(0.);
        vec3 t=toneMapping(base);
        t=max((t-.18)*uContrast+.18,0.);
        float l=dot(t,vec3(.2126,.7152,.0722));
        t=mix(vec3(l),t,uSat);
        float gl=exp(-pow(length(vec2((vUv.x-.5)*1.05,vUv.y*1.7)),2.)*2.6);
        float gx=pow(abs(vUv.x-.5)*2.,1.5), gy=pow(abs(vUv.y-.5)*2.,2.);
        vec3 bgBase=mix(uBg,uBgEdge,clamp((gx+gy*.6)*uGrad,0.,1.));
        float sp=exp(-pow((vUv.x-uSpot.x)/uSpot.z,2.))*(1.-gy*.8);
        bgBase+=uBgSpot*sp*uSpot.y;
        vec3 bgc=bgBase+vec3(.92,.96,1.)*.1*gl*uGlow;
        vec3 col=mix(bgc,t,a);
        vec2 q=(vUv-.5)*vec2(uRes.x/uRes.y,1.);
        float v=smoothstep(.55,1.15,length(q)*1.25);
        col=mix(col,bgBase,v*uVig);
        col*=uLevel;
        col*=1.+(hash(vUv*uRes+fract(uTime))-.5)*uGrain*6.;
        gl_FragColor=linearToOutputTexel(vec4(max(col,0.),1.));
      }`,
    depthTest:false,depthWrite:false
  });
  postScene=new THREE.Scene();
  postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),postMaterial));
}

function makeTarget(width,height){
  if(rt){rt.dispose();rt.depthTexture?.dispose();}
  const depth=new THREE.DepthTexture(width,height);
  depth.type=THREE.UnsignedIntType;
  rt=new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,depthTexture:depth,samples:4,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
}

/* ================= 场景 ================= */
function setStatus(text,error=false){
  const state=error?'error':modelReady?'ready':'loading';
  if(stageStatus){stageStatus.textContent=text;stageStatus.dataset.state=state;}
  try{reportStatus?.(text,state);}catch{}
}
function materialsOf(object){return Array.isArray(object.material)?object.material:[object.material];}
function normalize(root){
  root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<=0)throw new Error('模型尺寸无效');
  root.scale.multiplyScalar(2.25/size.y);
  root.updateMatrixWorld(true);
  const center=new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.updateMatrixWorld(true);
}

function createWorld(){
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(60,1,.05,40);
  orbit=new OrbitControls(camera,canvas);
  orbit.enableDamping=true;orbit.enablePan=false;orbit.rotateSpeed=.35;
  orbit.minDistance=3.8;orbit.maxDistance=15;
  orbit.maxPolarAngle=Math.PI*.68;

  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
  pmrem.dispose();

  hemiLight=new THREE.HemisphereLight(0xdbe8ff,0x08090c,.3);scene.add(hemiLight);

  // 单头工作台不创建环幕、地面、观众或情绪标签；黑底由后期背景处理。
  ringGroup=null;
  silhouetteMaterial=new THREE.MeshBasicMaterial({color:0x000000});
  audience=null;
  setView(currentView,0);
}

// 观众：真人比例的黑色剪影；单人镜头固定隐藏观众。
const rigs=[];
const FLOOR=-1.15;
const CROWD_SIZE=[.94,1.06,1,.97,1.04,.95,1.02];
function limb(radTop,radBottom,length,mat){
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radTop,radBottom,length,10),mat);
  mesh.position.y=-length/2;return mesh;
}
function createPerson(){
  const root=new THREE.Group();
  const mat=silhouetteMaterial;
  const legs=[-1,1].map(side=>{
    const hip=new THREE.Group();hip.position.set(side*.04,.47,0);root.add(hip);
    hip.add(limb(.052,.038,.24,mat));
    const knee=new THREE.Group();knee.position.y=-.24;hip.add(knee);
    knee.add(limb(.037,.026,.23,mat));
    const foot=new THREE.Mesh(new THREE.BoxGeometry(.05,.026,.11),mat);foot.position.set(0,-.235,.025);knee.add(foot);
    return {hip,knee};
  });
  const body=new THREE.Group();body.position.y=.47;root.add(body);
  const profile=[[0,.0],[.1,.0],[.108,.06],[.1,.14],[.115,.24],[.138,.315],[.12,.345],[.06,.362],[0,.366]].map(([r,y])=>new THREE.Vector2(r,y));
  const torso=new THREE.Mesh(new THREE.LatheGeometry(profile,20),mat);
  torso.scale.set(1,1,.52);body.add(torso);
  const arms=[-1,1].map(side=>{
    const shoulder=new THREE.Group();shoulder.position.set(side*.14,.335,0);body.add(shoulder);
    shoulder.add(limb(.03,.024,.16,mat));
    const elbow=new THREE.Group();elbow.position.y=-.16;shoulder.add(elbow);
    elbow.add(limb(.024,.019,.15,mat));
    const hand=new THREE.Mesh(new THREE.SphereGeometry(.022,8,6),mat);hand.position.y=-.16;elbow.add(hand);
    return {shoulder,elbow};
  });
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.026,.03,.07,12),mat);
  neck.position.y=.385;body.add(neck);
  const headPivot=new THREE.Group();headPivot.position.y=.39;body.add(headPivot);
  const head=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),mat);
  head.scale.set(.048,.066,.057);head.position.y=.07;headPivot.add(head);
  const jaw=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),mat);
  jaw.scale.set(.04,.04,.046);jaw.position.set(0,.035,.012);headPivot.add(jaw);
  return {root,body,headPivot,legs,arms};
}
// 观众可站立/走动的区域：环幕围起来的半圆里（半径 2.6，头在半径 3.45 的环幕上）
function randomSpot(){
  for(let tries=0;tries<12;tries++){
    const a=Math.random()*Math.PI*2,r=.5+Math.sqrt(Math.random())*2.1;
    const x=Math.sin(a)*r,z=.1+Math.cos(a)*r*.9;
    if(rigs.every(o=>Math.hypot(o.x-x,o.z-z)>.7))return {x,z};
  }
  return {x:(Math.random()-.5)*4,z:(Math.random()-.3)*3};
}
function addRig(parts,kind,extra={}){
  const spot=randomSpot();
  const now=performance.now();
  const rig={...parts,kind,x:spot.x,z:spot.z,yaw:Math.atan2(-spot.x,-3.5-spot.z),speed:0,stride:Math.random()*6.28,
    phase:Math.random()*20,mode:'watch',until:now+2000+Math.random()*12000,target:null,leaving:false,
    glanceUntil:0,glanceIdx:0,nextGlance:now+4000+Math.random()*9000,react:Math.random()*1.2,
    yawCur:0,lean:0,nods:Math.random()<.55,vmax:.9+Math.random()*.5,w:0,size:CROWD_SIZE[rigs.length%CROWD_SIZE.length],...extra};
  rigs.push(rig);audience.add(rig.root);
  rig.root.position.set(rig.x,FLOOR,rig.z);
  return rig;
}
function clearCrowd(){
  while(audience.children.length)audience.remove(audience.children[0]);
  rigs.length=0;
}
function buildProceduralCrowd(){
  clearCrowd();
  for(let i=0;i<7;i++)addRig(createPerson(),'proc');
  setAudienceScale();
}
function setAudienceScale(){
  for(const rig of rigs)rig.root.scale.setScalar(rig.kind==='glb'?LOOK.audienceHeight*rig.size/rig.srcH:LOOK.audienceHeight*rig.size);
}
function createAudience(){
  const group=new THREE.Group();
  audience=group;
  buildProceduralCrowd();
  return group;
}
const wrapPi=a=>Math.atan2(Math.sin(a),Math.cos(a));
function animateAudience(now,dt){
  if(!audience||!audience.visible)return;
  const k=LOOK.audienceMotion,t=now/1000;
  const speakerHead=currentSpeaker?heads[currentSpeaker]:null;
  const defaultHead=heads.human;
  rigs.forEach((rig,index)=>{
    const ph=rig.phase;
    if(rig.mode==='away'){
      if(now>rig.until){
        const side=Math.random()<.5?-1:1;
        rig.x=side*5.6;rig.z=1.8+Math.random()*1.6;rig.root.visible=true;
        rig.target=randomSpot();rig.mode='walk';rig.leaving=false;rig.yaw=Math.atan2(rig.target.x-rig.x,rig.target.z-rig.z);
      }else return;
    }
    if(rig.mode==='watch'&&k>.05&&now>rig.until){
      if(Math.random()<.14*Math.min(1.5,k)){rig.leaving=true;rig.target={x:(Math.random()<.5?-1:1)*5.8,z:1.8+Math.random()*1.6};}
      else rig.target=randomSpot();
      rig.mode='walk';
    }
    let desiredSpeed=0;
    if(rig.mode==='walk'&&rig.target){
      const dx=rig.target.x-rig.x,dz=rig.target.z-rig.z,dist=Math.hypot(dx,dz);
      if(dist<.1){
        if(rig.leaving){rig.mode='away';rig.root.visible=false;rig.until=now+(5000+Math.random()*14000);rig.speed=0;return;}
        rig.mode='watch';rig.until=now+(7000+Math.random()*22000)/Math.max(.3,k);
      }else{
        desiredSpeed=Math.min(rig.vmax*Math.min(1.4,.6+k*.5),.3+dist*.9);
        rig.yaw+=wrapPi(Math.atan2(dx,dz)-rig.yaw)*(1-Math.exp(-dt*4));
      }
    }
    if(rig.mode==='watch'){
      const want=Math.atan2(0-rig.x,-3.5-rig.z);
      rig.yaw+=wrapPi(want-rig.yaw)*(1-Math.exp(-dt*1.6));
    }
    rig.speed+=(desiredSpeed-rig.speed)*(1-Math.exp(-dt*3));
    rig.x+=Math.sin(rig.yaw)*rig.speed*dt;rig.z+=Math.cos(rig.yaw)*rig.speed*dt;
    for(const other of rigs){
      if(other===rig||other.mode==='away')continue;
      const ox=rig.x-other.x,oz=rig.z-other.z,d=Math.hypot(ox,oz);
      if(d<.6&&d>.001){const push=(.6-d)*dt*1.6;rig.x+=ox/d*push;rig.z+=oz/d*push;}
    }
    const w=Math.min(1,rig.speed/.6);rig.w=w;
    rig.root.rotation.y=rig.yaw;
    // 头的朝向目标：说话的人 / 旁边的人 / 中间
    if(now>rig.nextGlance){
      rig.glanceUntil=now+900+Math.random()*1500;
      rig.glanceIdx=clamp(index+(Math.random()<.5?-1:1),0,rigs.length-1);
      rig.nextGlance=now+(6000+Math.random()*12000)/Math.max(.3,k);
    }
    let tx,tz,weight;
    if(now<rig.glanceUntil&&rig.glanceIdx!==index&&rigs[rig.glanceIdx].mode!=='away'){const o=rigs[rig.glanceIdx];tx=o.x;tz=o.z;weight=.9;}
    else if(speakerHead){tx=speakerHead.group.position.x;tz=speakerHead.group.position.z;weight=1;}
    else if(defaultHead){tx=defaultHead.group.position.x;tz=defaultHead.group.position.z;weight=.35;}
    else{tx=0;tz=-3;weight=0;}
    weight*=1-w*.6;
    const rel=clamp(wrapPi(Math.atan2(tx-rig.x,tz-rig.z)-rig.yaw)*weight,-.85,.85);
    rig.yawCur+=(rel-rig.yawCur)*(1-Math.exp(-dt*(1.1+rig.react)));
    const nod=speakerHead&&rig.nods&&w<.1?Math.max(0,Math.sin(t*1.6+ph*3))*.045:0;
    if(rig.kind==='glb'){
      rig.walk.setEffectiveWeight(w);rig.idle.setEffectiveWeight(1-w);
      rig.walk.timeScale=Math.max(.3,rig.speed/(.95*rig.root.scale.x*rig.srcH/1.8*1.3));
      rig.mixer.update(dt);
      rig.root.position.set(rig.x,FLOOR,rig.z);
      if(rig.neckBone)rig.neckBone.rotateY(rig.yawCur*.35);
      if(rig.headBone){rig.headBone.rotateY(rig.yawCur*.65+Math.sin(t*.5+ph)*.03*k);rig.headBone.rotateX(nod);}
      return;
    }
    // 程序化剪影的步态
    rig.stride+=dt*Math.PI*2*(.55+rig.speed*1.1)*(w>.02?1:0);
    const psi=rig.stride,s=Math.sin(psi);
    rig.legs[0].hip.rotation.x=-.5*w*s;rig.legs[1].hip.rotation.x=.5*w*s;
    rig.legs[0].knee.rotation.x=Math.max(0,Math.cos(psi))*.8*w;rig.legs[1].knee.rotation.x=Math.max(0,-Math.cos(psi))*.8*w;
    rig.arms[0].shoulder.rotation.x=.4*w*s;rig.arms[1].shoulder.rotation.x=-.4*w*s;
    rig.arms[0].elbow.rotation.x=-(.12+.3*w*Math.max(0,s));rig.arms[1].elbow.rotation.x=-(.12+.3*w*Math.max(0,-s));
    rig.root.position.set(rig.x,FLOOR+Math.abs(s)*.012*w*rig.root.scale.x,rig.z);
    rig.lean+=((speakerHead?.035:0)-rig.lean)*(1-Math.exp(-dt*.6));
    rig.body.scale.y=1+Math.sin(t*1.3+ph)*.005*k;
    rig.body.rotation.z=(Math.sin(t*.42+ph)*.014+Math.sin(t*.91+ph*2)*.004)*k*(1-w)+s*.03*w;
    rig.body.rotation.x=(rig.lean+Math.sin(t*.31+ph)*.008)*k*(1-w)+.04*w;
    rig.headPivot.rotation.set((Math.sin(t*.37+ph)*.02*k+nod),(rig.yawCur+Math.sin(t*.5+ph)*.03*k),Math.sin(t*.29+ph)*.02*k,'YXZ');
  });
}

/* ---------- 情绪标签：放在环幕空间里，头与头之间，眼睛高度 ---------- */
const EMO_WORDS=[['CURIOSITY',.55],['UNEASE',.42],['DOUBT',.46],['EMPATHY',.38],['TENSION',.5],['RECOGNITION',.34],['CALM',.6],['SUSPICION',.44],['AMUSEMENT',.28],['HESITATION',.36],['ATTENTION',.72]];
const tag={group:null,layers:[],canvas:null,ctx:null,tex:null,enabled:true,slot:null,label:'',last:'',base:.5,val:.5,target:.5,nextJitter:0,hideAt:0,shown:false,opacity:0,text:'',drawnAt:0,light:null};
function drawTag(){
  const {ctx,canvas}=tag,light=tag.light;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle=light?'#14110e':'#f2ece2';
  ctx.textBaseline='middle';
  const size=52,spacing=size*LOOK.tagSpacing;
  ctx.font=`300 ${size}px Futura, Jost, "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
  const spaced=(text,x,gap)=>{for(const ch of text){ctx.fillText(ch,x,canvas.height/2);x+=ctx.measureText(ch).width+gap;}return x;};
  const measure=(text,gap)=>[...text].reduce((sum,ch)=>sum+ctx.measureText(ch).width+gap,0);
  const value=tag.val.toFixed(2);
  const lineW=size*1.6,gapA=size*.8;
  const total=lineW+gapA+measure(tag.label,spacing)+size*.9+measure(value,spacing*.55);
  let x=(canvas.width-total)/2;
  ctx.fillRect(x,canvas.height/2-1,lineW,2.5);x+=lineW+gapA;
  x=spaced(tag.label,x,spacing);x+=size*.9;
  ctx.globalAlpha=.7;spaced(value,x,spacing*.55);ctx.globalAlpha=1;
  tag.tex.needsUpdate=true;tag.text=tag.label+value;
}
function createTag(){
  tag.canvas=document.createElement('canvas');tag.canvas.width=1536;tag.canvas.height=96;
  tag.ctx=tag.canvas.getContext('2d');
  tag.tex=new THREE.CanvasTexture(tag.canvas);tag.tex.colorSpace=THREE.SRGBColorSpace;tag.tex.anisotropy=8;
  tag.group=new THREE.Group();tag.group.visible=false;
  const W=2.6,H=W*96/1536;
  // 几层略微错开的面片，从侧面看有一点厚度
  [[0,1.9],[-.012,.55],[-.024,.32],[-.036,.18]].forEach(([z,gain],index)=>{
    const material=new THREE.MeshBasicMaterial({map:tag.tex,transparent:true,alphaTest:.04,side:THREE.DoubleSide,depthWrite:true});
    material.color.setScalar(gain);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(W,H),material);
    mesh.position.z=z;tag.group.add(mesh);tag.layers.push({mesh,material,gain});
  });
  scene.add(tag.group);
}
function placeTag(slot){
  const pair=slot==='left'?['left','human']:['human','right'];
  const angle=(ANGLES[pair[0]]+ANGLES[pair[1]])/2*LOOK.spacing+LOOK.tagShift;
  const radius=RADIUS+.12+LOOK.tagRadius,y=1.3+EYE_UP+.04+LOOK.tagHeight;
  tag.group.scale.setScalar(LOOK.tagSize);
  if(isFlat()){
    const xm=(ANGLES[pair[0]]+ANGLES[pair[1]])/2*flatXs()+LOOK.tagShift*3;
    tag.group.position.set(xm,y,-RADIUS+.12+LOOK.tagRadius);
    tag.group.rotation.set(0,0,0);
    return;
  }
  tag.group.position.set(Math.sin(angle)*radius,y,-Math.cos(angle)*radius);
  tag.group.lookAt(0,y,0);
}
function updateTag(now,dt){
  if(!tag.group)return;
  const light=(LOOK.bg&&parseInt(LOOK.bg.slice(1,3),16)*.299+parseInt(LOOK.bg.slice(3,5),16)*.587+parseInt(LOOK.bg.slice(5,7),16)*.114>140);
  const allowed=tag.enabled&&LOOK.tag;
  if(allowed&&currentSpeaker){
    if(!tag.shown||currentSpeaker!==tag.slot){
      let pick;do{pick=EMO_WORDS[Math.floor(Math.random()*EMO_WORDS.length)];}while(pick[0]===tag.last);
      tag.slot=currentSpeaker;tag.label=pick[0];tag.last=pick[0];
      tag.base=clamp(pick[1]+(Math.random()-.5)*.3,.12,.93);tag.val=tag.target=tag.base;tag.nextJitter=0;
      tag.shown=true;tag.light=light;placeTag(tag.slot);drawTag();
    }
    tag.hideAt=now+LOOK.tagHold*1000;
  }
  const visible=allowed&&tag.shown&&now<tag.hideAt;
  tag.opacity+=((visible?1:0)-tag.opacity)*(1-Math.exp(-dt*3/LOOK.tagFade));
  if(!visible&&tag.opacity<.02){tag.group.visible=false;if(now>tag.hideAt+800)tag.shown=false;return;}
  tag.group.visible=true;
  if(tag.light!==light){tag.light=light;drawTag();}
  if(now>tag.nextJitter){tag.target=clamp(tag.base+(Math.random()-.5)*.14,.05,.97);tag.nextJitter=now+600+Math.random()*700;}
  tag.val+=(tag.target-tag.val)*(1-Math.exp(-dt*1.8));
  if(tag.label+tag.val.toFixed(2)!==tag.text&&now-tag.drawnAt>90){drawTag();tag.drawnAt=now;}
  for(const layer of tag.layers){
    layer.material.opacity=tag.opacity*Math.min(1,LOOK.tagBright);
    layer.material.color.setScalar((tag.light?(layer.gain>1?1:Math.min(8,layer.gain*12)):layer.gain)*Math.max(1,LOOK.tagBright));
  }
}

/* ---------- 头：独立打光 + 衰减着色器 ---------- */
function patchMaterial(material,head){
  material.onBeforeCompile=shader=>{
    shader.uniforms.uC=head.uni.uC;shader.uniforms.uDim=head.uni.uDim;
    shader.uniforms.uP=MASK_UNI.uP;shader.uniforms.uN=MASK_UNI.uN;shader.uniforms.uA=MASK_UNI.uA;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vHeadW;')
      .replace('#include <project_vertex>','#include <project_vertex>\nvHeadW=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying vec3 vHeadW; uniform vec3 uC; uniform float uDim; uniform vec4 uP; uniform vec4 uN; uniform vec3 uA;')
      .replace('#include <opaque_fragment>',`
        vec3 hd=vHeadW-uC;
        float ex=length(hd.xz)/uA.x;
        float ey=hd.y>0.?hd.y/uA.y:hd.y/uA.z;
        float en=length(vec2(ex,ey));
        float hm=mix(uP.x,1.,1.-smoothstep(uP.y,uP.z,en));
        float dxz=max(length(hd.xz)-.55,0.);
        float nm=smoothstep(uN.y,uN.x,vHeadW.y-uN.z*dxz*dxz);
        float fmask=hm*nm*uDim;
        #ifdef OPAQUE
        gl_FragColor=vec4(outgoingLight*fmask,fmask);
        #else
        gl_FragColor=vec4(outgoingLight,diffuseColor.a*fmask);
        #endif`);
  };
  material.customProgramCacheKey=()=>'headfade-1';
  material.needsUpdate=true;
}

function prepareHead(slot,source){
  const model=source.clone(true),meshes=[],eyes=[];
  const head={slot,model,meshes,eyes,attention:{headYaw:0,eyeYaw:0},dim:1,dimCur:1,
    uni:{uC:{value:new THREE.Vector3()},uDim:{value:1}},lights:{}};
  model.traverse(object=>{
    if(!object.isMesh)return;
    meshes.push(object);
    const cloned=materialsOf(object).map(material=>{
      const copy=material.clone();
      copy.userData.saierBaseRoughness=Number.isFinite(copy.roughness)?copy.roughness:.5;
      patchMaterial(copy,head);
      return copy;
    });
    object.material=Array.isArray(object.material)?cloned:cloned[0];
    if(/(eyeball|lens)/i.test(object.name))eyes.push({object,rest:object.quaternion.clone()});
  });
  const group=new THREE.Group();
  group.scale.setScalar(1);
  group.add(model);scene.add(group);
  head.group=group;
  // 每颗头自己的主光与轮廓光（聚光灯，光锥只罩住这一颗头）
  for(const kind of ['key','rim']){
    const light=new THREE.SpotLight(0xffffff,1,0,.4,1,0);
    light.castShadow=false;
    scene.add(light,light.target);
    head.lights[kind]=light;
  }
  heads[slot]=head;
}

function applyMorph(head,name,value){
  for(const object of head.meshes){
    const index=object.morphTargetDictionary?.[name];
    if(index!==undefined)object.morphTargetInfluences[index]=value;
  }
}

function applyDriver(slot){
  const head=heads[slot],state=drivers[slot];
  if(!head)return;
  for(const [name,raw] of Object.entries(state.face)){
    if(name==='eyeYaw'||name==='eyePitch'||!MORPHS.includes(name))continue;
    applyMorph(head,name,clamp(number(raw,0),0,1));
  }
  const LF=life[slot];
  if(LF){
    const fb=n=>number(state.face[n],0),C=LF.ch;
    applyMorph(head,'eyeBlinkLeft',clamp(Math.max(LF.blink,fb('eyeBlinkLeft')),0,1));applyMorph(head,'eyeBlinkRight',clamp(Math.max(LF.blink*(1-.04),fb('eyeBlinkRight')),0,1));
    const lf=LF.lidFollow??.07;
    applyMorph(head,'eyeLidFollowLeft',clamp(Math.max(lf,fb('eyeLidFollowLeft')),0,1));applyMorph(head,'eyeLidFollowRight',clamp(Math.max(lf,fb('eyeLidFollowRight')),0,1));
    applyMorph(head,'browRaise',clamp(fb('browRaise')+C.brow,0,1));
    applyMorph(head,'browFrown',clamp(fb('browFrown')+C.frown,0,1));
    applyMorph(head,'mouthSmileLeft',clamp(fb('mouthSmileLeft')+C.smileL,0,1));applyMorph(head,'mouthSmileRight',clamp(fb('mouthSmileRight')+C.smileR,0,1));
    applyMorph(head,'cheekRaiseLeft',clamp(fb('cheekRaiseLeft')+C.cheek*(.6+C.smileL),0,1));applyMorph(head,'cheekRaiseRight',clamp(fb('cheekRaiseRight')+C.cheek*(.6+C.smileR),0,1));
    applyMorph(head,'mouthFrownLeft',clamp(fb('mouthFrownLeft')+C.mfrown,0,1));applyMorph(head,'mouthFrownRight',clamp(fb('mouthFrownRight')+C.mfrown*.9,0,1));
    applyMorph(head,'noseSneerLeft',clamp(fb('noseSneerLeft')+C.sneer,0,1));
    applyMorph(head,'mouthPress',clamp(fb('mouthPress')+C.press,0,1));
  }
  const yaw=clamp(number(state.face.eyeYaw,0)+head.attention.eyeYaw+(LF?.eyeYaw||0),-1,1)*THREE.MathUtils.degToRad(18);
  const pitch=clamp(number(state.face.eyePitch,0)+(LF?.eyePitch||0),-1,1)*THREE.MathUtils.degToRad(12);
  for(const eye of head.eyes){
    eye.object.quaternion.copy(eye.rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ')));
  }
  const pose=state.pose;
  head.group.rotation.set(clamp(number(pose.pitch,0)+(LF?(LF.pitch+LF.nodX)*LOOK.lifeAmp:0),-.8,.8),head.group.userData.baseYaw+clamp(number(pose.yaw,0)+(LF?LF.yaw*LOOK.lifeAmp:0),-1,1)+head.attention.headYaw,clamp(number(pose.roll,0)+(LF?LF.roll*LOOK.lifeAmp:0),-.8,.8),'YXZ');
}

function placeHeads(){
  for(const slot of slots){
    const head=heads[slot];if(!head)continue;
    const angle=ANGLES[slot]*LOOK.spacing;
    if(isFlat()){
      head.group.position.set(ANGLES[slot]*flatXs(),1.3,-RADIUS);
      head.group.userData.baseYaw=0;
    }else{
      head.group.position.set(Math.sin(angle)*RADIUS,1.3,-Math.cos(angle)*RADIUS);
      head.group.userData.baseYaw=-angle*.5;
    }
    head.uni.uC.value.set(head.group.position.x,head.group.position.y+FACE_UP,head.group.position.z);
    applyDriver(slot);
  }
  placeLights();
}

function warmColor(t){
  const cool=[.8,.88,1],warm=[1,.82,.66];
  return new THREE.Color().setRGB(cool[0]+(warm[0]-cool[0])*t,cool[1]+(warm[1]-cool[1])*t,cool[2]+(warm[2]-cool[2])*t,THREE.SRGBColorSpace);
}
function placeLights(){
  const rad=THREE.MathUtils.degToRad;
  for(const slot of slots){
    const head=heads[slot];if(!head)continue;
    const yaw=head.group.userData.baseYaw;
    const facing=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const center=new THREE.Vector3(head.group.position.x,head.group.position.y+FACE_UP,head.group.position.z);
    const place=(light,az,el,distance)=>{
      const a=rad(az),e=rad(el);
      const dir=facing.clone().multiplyScalar(Math.cos(a)*Math.cos(e)).add(right.clone().multiplyScalar(Math.sin(a)*Math.cos(e))).add(new THREE.Vector3(0,Math.sin(e),0));
      light.position.copy(center).add(dir.multiplyScalar(distance));
      light.target.position.copy(center);light.target.updateMatrixWorld();
    };
    const {key,rim}=head.lights;
    place(key,LOOK.keyAz,LOOK.keyEl,6);place(rim,LOOK.rimAz,LOOK.rimEl,5.5);
  }
}

function applyLook(){
  if(!scene)return;
  const bg=new THREE.Color(LOOK.bg);
  postMaterial.uniforms.uBg.value.copy(bg);

  if(stage)stage.style.background=LOOK.bg;
  renderer.toneMappingExposure=LOOK.exposure;
  postMaterial.uniforms.uContrast.value=LOOK.contrast;
  postMaterial.uniforms.uSat.value=LOOK.sat;
  postMaterial.uniforms.uVig.value=LOOK.vig;
  postMaterial.uniforms.uGrain.value=LOOK.grain;
  postMaterial.uniforms.uSoft.value=LOOK.dofSoft;
  postMaterial.uniforms.uDead.value=LOOK.dofDead;
  hemiLight.intensity=LOOK.fill;
  scene.environmentIntensity=LOOK.env;
  MASK_UNI.uP.value.set(LOOK.ringLevel,Math.min(LOOK.r0,LOOK.r1-.05),LOOK.r1,0);
  MASK_UNI.uN.value.set(Math.max(LOOK.neckFull,LOOK.neckZero+.05),LOOK.neckZero,LOOK.neckCurve,0);
  for(const head of Object.values(heads)){
    const {key,rim}=head.lights;
    key.color.copy(warmColor(LOOK.keyWarm));key.intensity=LOOK.keyI;key.angle=LOOK.keyCone;
    rim.color.copy(warmColor(.15));rim.intensity=LOOK.rimI;rim.angle=LOOK.rimCone;
    for(const object of head.meshes)for(const material of materialsOf(object))if(material.name==='Head Skin Web'){
      if('roughness' in material)material.roughness=clamp((material.userData.saierBaseRoughness??.5)+LOOK.skinRoughnessOffset,0,1);
      if(material.normalScale?.setScalar)material.normalScale.setScalar(LOOK.skinNormalStrength);
      material.needsUpdate=true;
    }
  }
  if(ringGroup)ringGroup.visible=false;
  placeHeads();
}
function updateAudienceVisible(){
  if(audience)audience.visible=false;
}

// 哪些头被淡出：{left:1, human:.3, right:.3}（淡向背景色）
function setDim(map={}){
  for(const slot of slots){
    if(!(slot in map)||!heads[slot])continue;
    heads[slot].dim=clamp(number(map[slot],1),.05,1);
  }
}

/* ---------- 相机 ---------- */
function v3(arr){return new THREE.Vector3(arr[0],arr[1],arr[2]);}
function lookTarget(){
  const dir=cam.target.clone().sub(cam.pos);
  const length=dir.length()||1;
  dir.normalize().applyAxisAngle(Y_AXIS,look.yaw);
  const right=new THREE.Vector3().crossVectors(dir,Y_AXIS).normalize();
  dir.applyAxisAngle(right,look.pitch);
  return cam.pos.clone().add(dir.multiplyScalar(length));
}
function placeCamera(){
  if(isFlat()){
    const half=Math.tan(THREE.MathUtils.degToRad(LOOK.flatFov)/2);
    const dist=(LOOK.flatHeight/2)/half;
    camera.up.set(0,1,0);
    camera.position.set(LOOK.flatX,LOOK.flatY,-RADIUS+dist);
    camera.fov=LOOK.flatFov;camera.far=dist+30;
    camera.lookAt(LOOK.flatX,LOOK.flatY,-RADIUS);
    camera.updateProjectionMatrix();
    return;
  }
  camera.far=40;
  camera.position.copy(cam.pos);
  camera.fov=cam.fov;
  camera.lookAt(currentView==='center'&&cam.free?lookTarget():cam.target);
  camera.updateProjectionMatrix();
}
function flyTo(spec,ms=0){
  const pos=spec.pos.isVector3?spec.pos.clone():v3(spec.pos);
  const target=spec.target.isVector3?spec.target.clone():v3(spec.target);
  const fov=number(spec.fov,cam.fov);
  look.yaw=look.targetYaw=0;look.pitch=look.targetPitch=0;
  if(!(ms>0)){cam.tween=null;cam.pos.copy(pos);cam.target.copy(target);cam.fov=fov;finishCamera();placeCamera();return;}
  cam.tween={start:performance.now(),ms,fromPos:cam.pos.clone(),toPos:pos,fromTarget:cam.target.clone(),toTarget:target,fromFov:cam.fov,toFov:fov};
}
function finishCamera(){
  const orbitView=currentView==='inside'||currentView==='far';
  if(orbit){orbit.target.copy(cam.target);orbit.enabled=orbitView&&!cam.tween;if(orbitView)orbit.update();}
}
function stepCamera(now){
  if(isFlat()){placeCamera();return;}
  const tween=cam.tween;
  if(tween){
    const t=clamp((now-tween.start)/tween.ms,0,1),e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    cam.pos.lerpVectors(tween.fromPos,tween.toPos,e);
    cam.target.lerpVectors(tween.fromTarget,tween.toTarget,e);
    cam.fov=tween.fromFov+(tween.toFov-tween.fromFov)*e;
    if(t>=1){cam.tween=null;finishCamera();}
    placeCamera();return;
  }
  if(currentView==='center'){
    look.yaw+=(look.targetYaw-look.yaw)*.18;look.pitch+=(look.targetPitch-look.pitch)*.18;
    placeCamera();
  }
}

function setView(view,ms=1400){
  const next=VIEWS.includes(view)?view:'center';
  const wasTop=currentView==='top';
  currentView=next;
  updateAudienceVisible();
  if(!camera)return currentView;
  camera.up.set(0,1,0);
  const spec=CAMERAS[currentView];
  if(currentView==='top'){camera.up.set(0,0,-1);flyTo(spec,0);}
  else flyTo(spec,wasTop?0:ms);
  if(orbit)orbit.enabled=(currentView==='inside'||currentView==='far')&&!cam.tween;
  return currentView;
}

function headFrame(slot,distance=3.6,fov=38,height=2.1){
  const head=heads[slot];
  if(!head)return null;
  const base=head.group.position,yaw=head.group.userData.baseYaw;
  const facing=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
  const target=new THREE.Vector3(base.x,height,base.z);
  const pos=target.clone().add(facing.multiplyScalar(distance));
  return {pos,target,fov};
}
function closeUp(slot,distance,fov,ms=0,height){
  const frame=headFrame(slot,distance,fov,height);
  if(!frame)return false;
  currentView='center';updateAudienceVisible();
  flyTo(frame,ms);return true;
}

function project(slot,dy=-1.05,dx=0){
  const head=heads[slot];
  if(!head||!camera)return null;
  const p=new THREE.Vector3();
  head.group.getWorldPosition(p);p.y+=dy;
  camera.updateMatrixWorld();
  if(dx)p.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),dx);
  p.project(camera);
  const rect=(stage||canvas).getBoundingClientRect();
  return {x:(p.x*.5+.5)*rect.width,y:(-p.y*.5+.5)*rect.height,visible:p.z<1&&Math.abs(p.x)<1.15&&Math.abs(p.y)<1.15};
}

let outAspect=0;
const isFlat=()=>outAspect>0;
function flatXs(){return (LOOK.flatHeight/2)*outAspect*2/3*LOOK.flatSpread;}
function resize(){
  if(!renderer||!camera)return;
  const rect=stage?.getBoundingClientRect?.()||canvas.getBoundingClientRect();
  const width=Math.max(1,Math.round(rect.width||canvas.clientWidth||1));
  const height=Math.max(1,Math.round(rect.height||canvas.clientHeight||1));
  renderer.setSize(width,height,false);
  camera.aspect=outAspect>0?outAspect:width/height;camera.updateProjectionMatrix();
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());
  if(!rt||rt.width!==size.x||rt.height!==size.y)makeTarget(size.x,size.y);
  postMaterial.uniforms.uRes.value.copy(size);
}

/* ---------- 静止时的自然眨眼与注视（沿用，不改） ---------- */
function blinkAmount(state,now){
  if(!state.blinkStart&&now>=state.nextBlink)state.blinkStart=now;
  if(!state.blinkStart)return 0;
  const elapsed=now-state.blinkStart;
  if(elapsed>=245){state.blinkStart=0;state.nextBlink=now+(Math.random()<.17?150+Math.random()*80:2200+Math.random()*2900);return 0;}
  if(elapsed<72)return elapsed/72;
  if(elapsed<105)return 1;
  return 1-(elapsed-105)/140;
}
function applyIdle(now){
  // 待机动作全部交给表演层（updateLife）；这里只负责让驱动数据保持为空
  for(const slot of slots){
    if(now-lastDriverAt[slot]<800)continue;
    drivers[slot].face={};drivers[slot].pose={pitch:0,yaw:0,roll:0};
  }
}


/* ---------- 表演层：情绪 → 表情叠加；停一下再动的头和眼睛；有来由的眨眼和看向别处 ---------- */
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];
// 情绪 → 各表情通道的目标值（乘以强度）。smile 可带 asym（只笑一边）
const EMO={
  neutral:{},
  attentive:{brow:.12},
  curious:{brow:.38,lid:-.04},
  probing:{frown:.22,squint:.2},
  recall:{brow:.14,smile:.1,squint:.05},
  hesitant:{brow:.2,frown:.16,press:.14},
  pained:{brow:.26,frown:.26,mfrown:.3,squint:.1},
  sad:{brow:.3,frown:.14,mfrown:.28},
  concern:{brow:.2,frown:.12,mfrown:.12},
  amused:{smile:.4,cheek:.38,squint:.12},
  wry:{smile:.2,asym:.8,cheek:.15,squint:.14,sneer:.08},
  dry:{smile:.12,asym:.7,squint:.1},
  warm:{smile:.22,cheek:.2},
  playful:{smile:.32,cheek:.26,brow:.16},
  sheepish:{smile:.22,asym:.4,brow:.18,frown:.08,squint:.06},
  firm:{frown:.18,press:.22},
  unease:{brow:.2,frown:.16,press:.2},
  wonder:{brow:.42,smile:.08,lid:-.05},
  afraid:{brow:.36,frown:.2,press:.12,lid:-.06}
};
const CH=['brow','frown','smileL','smileR','cheek','mfrown','sneer','press','squint','lid'];
const REACT={curious:'attentive',probing:'attentive',hesitant:'attentive',recall:'attentive',firm:'attentive',pained:'concern',sad:'concern',concern:'concern',afraid:'concern',amused:'warm',playful:'warm',warm:'warm',sheepish:'warm',wry:'dry',dry:'dry',unease:'unease',wonder:'wonder',neutral:'neutral'};
const GAZE={down:{yaw:0,pitch:.75},up:{yaw:0,pitch:-.6},side:{yaw:.7,pitch:.05}};
// 二阶弹簧：欠阻尼 → 到位时带一点过冲，再停住
function spring(o,target,dt,w,z){
  const n=Math.max(1,Math.ceil(dt/.006)),h=dt/n;   // 小步长，避免硬弹簧发散
  for(let i=0;i<n;i++){o.v+=(-w*w*(o.x-target)-2*z*w*o.v)*h;o.x+=o.v*h;}
}
const mk=()=>({x:0,v:0});
const life=Object.fromEntries(slots.map((slot,i)=>[slot,{
  // 输出（applyDriver 读取）
  pitch:0,yaw:0,roll:0,nodX:0,eyeYaw:0,eyePitch:0,blink:.12,ch:Object.fromEntries(CH.map(c=>[c,0])),
  // 内部
  hp:mk(),hy:mk(),hr:mk(),gy:mk(),gp:mk(),nod:mk(),
  hTarget:{p:0,y:0,r:0},nextShift:performance.now()+rnd(1500,3500),
  gazeT:{yaw:0,pitch:0},gazeUntil:0,micro:{yaw:0,pitch:0},nextMicro:0,
  emo:{},emoAmt:0,emoGoal:0,flash:0,drift:Object.fromEntries(CH.map(c=>[c,0])),driftT:Object.fromEntries(CH.map(c=>[c,0])),nextDrift:0,
  asym:0,queue:[],wasSpeaking:false,perf:null,lookAt:0,
  blinks:[],nextBlink:performance.now()+rnd(900,2600)+i*700,
  lastBlinkAt:0,seed:i*3.1+.7
}]));
const speakingNow=()=>currentSpeaker;
function schedule(L,delay,fn){L.queue.push({t:performance.now()+delay,fn});}
function addBlink(L,now,amp=1,delay=0){
  const close=rnd(55,85),open=rnd(130,210);
  L.blinks.push({t0:now+delay,close,open,amp});
  L.lastBlinkAt=now+delay;
}
function lookAway(slot,dir,dur,now=performance.now()){
  const L=life[slot];const g=GAZE[dir];if(!g)return;
  const flip=LOOK.eyeFlipV?-1:1;
  const sx=Math.random()<.5?-1:1;
  L.gazeT={yaw:dir==='side'?sx*g.yaw:sx*rnd(.05,.25),pitch:g.pitch*flip*rnd(.8,1.1)};
  L.gazeUntil=now+dur;
  if(Math.random()<.75)addBlink(L,now,rnd(.8,1),rnd(0,60));   // 转视线时常伴一次眨眼
  // 头跟着视线走一小部分（约 30%），晚一点点
  schedule(L,rnd(60,110),()=>{L.hTarget.p+=L.gazeT.pitch*.05;L.hTarget.y+=L.gazeT.yaw*.06;});
  schedule(L,dur+rnd(0,80),()=>{L.hTarget.p*=.3;L.hTarget.y*=.3;});
}
function setEmotion(slot,name,amt,tilt=0){
  const L=life[slot];
  L.emo=EMO[name]||{};L.emoGoal=amt;L.asym=Math.random()<.5?-1:1;
  if(tilt)L.hTarget.r=tilt*.07*(.7+amt*.6);
}
function nodNow(L,v){L.nod.v+=v;}
window.saierCue=ev=>{
  const now=performance.now(),slot=ev.slot,L=life[slot];if(!L)return;
  const speakers=slots.filter(s=>s!==slot);
  if(ev.type==='turn'){
    const perf=ev.turn?.perf||{emo:'neutral',amt:.3};L.perf=perf;
    L.wasSpeaking=true;
    // 说话者：开口前换气，进入情绪，按标注安排视线
    L.hTarget.p=-.03;schedule(L,350,()=>{L.hTarget.p=0;});
    setEmotion(slot,perf.emo,perf.amt,perf.tilt||0);
    L.queue=L.queue.filter(q=>!q.keep);
    const dur=ev.dur||2000;
    const looks=perf.look||[];
    for(const lk of looks)schedule(L,Math.max(0,lk.at*dur),()=>lookAway(slot,lk.dir,lk.dur));
    if(!looks.length&&Math.random()<.35)schedule(L,rnd(100,600),()=>lookAway(slot,pick(['up','side','down']),rnd(500,1100)));
    // 说话者在不看别处时，看向某一个听的人
    L.lookAt=Math.random()<.7?Math.sign(slots.indexOf(pick(speakers))-slots.indexOf(slot)):0;
    if(Math.random()<.3)addBlink(L,now,1,rnd(0,250));
    // 听的人：稍晚一点才有反应（反应延迟）
    for(const o of speakers){
      const O=life[o];const rn=perf.react?.[o]||[REACT[perf.emo]||'attentive',Math.min(1,(perf.amt||.4)*.7)];
      if(Math.random()<.85)schedule(O,rnd(500,1100),()=>{setEmotion(o,rn[0],rn[1]);});
      O.lookAt=0;
    }
  }else if(ev.type==='stress'){
    // 重音：眉毛一抬、头点一下，偶尔眨眼
    L.flash=Math.min(1,(.45+ev.amp*.5)*(L.emoGoal>.5?1.1:1));
    if(Math.random()<.7)nodNow(L,rnd(.3,.6));
    if(Math.random()<.2)addBlink(L,now,rnd(.7,1));
  }else if(ev.type==='pause'){
    // 句中停顿：常常换口气、眨眼，眼睛移开想一下
    if(Math.random()<.6)addBlink(L,now,rnd(.7,1),rnd(0,80));
    if(ev.d>260&&Math.random()<.5)lookAway(slot,pick(['down','side','up']),Math.min(ev.d+500,1200));
    // 听的人在停顿处偶尔应一下
    for(const o of speakers)if(Math.random()<.25)schedule(life[o],rnd(100,400),()=>nodNow(life[o],rnd(.18,.3)));
  }else if(ev.type==='end'){
    // 句尾：眨眼、放松、表情慢慢收回；问句最后抬一下眉
    addBlink(L,now,1,rnd(60,160));
    L.hTarget.p=.015;schedule(L,500,()=>{L.hTarget.p=0;L.hTarget.r*=.4;});
    L.emoGoal*=.35;
    for(const o of speakers){
      if(Math.random()<.45)schedule(life[o],rnd(150,600),()=>nodNow(life[o],rnd(.22,.38)));
    }
  }else if(ev.type==='done'){
    L.wasSpeaking=false;L.lookAt=0;
  }
};
function updateLife(now,dt){
  const speaker=currentSpeaker;
  const f=r=>1-Math.exp(-dt*r);
  for(const slot of slots){
    const L=life[slot],head=heads[slot];if(!head)continue;
    const speaking=slot===speaker,t=now/1000+L.seed;
    // 排队事件
    if(L.queue.length){const rest=[];for(const q of L.queue){if(now>=q.t)q.fn();else rest.push(q);}L.queue=rest;}
    // ----- 头：停住 → 换一个姿势 → 停住（弹簧带轻微过冲）
    if(now>=L.nextShift){
      if(!speaking){
        L.hTarget.y=(Math.random()<.4?0:rnd(-.045,.045));
        L.hTarget.r=(Math.random()<.4?0:rnd(-.05,.05));
        L.hTarget.p=rnd(-.012,.02);
      }else{
        L.hTarget.y=L.lookAt*.07+rnd(-.02,.02);
        L.hTarget.p=rnd(-.02,.01);
      }
      L.nextShift=now+rnd(speaking?1400:2500,speaking?3200:6500);
    }
    spring(L.hp,L.hTarget.p,dt,9,.55);spring(L.hy,L.hTarget.y,dt,7,.6);spring(L.hr,L.hTarget.r,dt,6,.65);
    spring(L.nod,0,dt,13,.28);
    L.pitch=L.hp.x+Math.sin(t*1.15)*.004;   // 只有呼吸是连续的，幅度很小
    L.yaw=L.hy.x;L.roll=L.hr.x;L.nodX=L.nod.x;
    // ----- 眼睛：目标是离散的（看某处）+ 微扫视；快速到位
    let gy=0,gp=0;
    if(now<L.gazeUntil){gy=L.gazeT.yaw;gp=L.gazeT.pitch;}
    else if(speaking||speaker===null){gy=L.lookAt*.4;}
    if(now>=L.nextMicro){L.micro={yaw:rnd(-.035,.035),pitch:rnd(-.025,.025)};L.nextMicro=now+rnd(180,650);}
    // 没人说话时偶尔自己看看别处
    if(speaker===null&&now>L.gazeUntil&&Math.random()<dt*.18)lookAway(slot,pick(['down','side','up']),rnd(500,1300),now);
    // 听的人偶尔也移开视线一下
    if(speaker&&!speaking&&now>L.gazeUntil&&Math.random()<dt*.07)lookAway(slot,pick(['down','side']),rnd(350,800),now);
    spring(L.gy,gy+L.micro.yaw,dt,40,.78);spring(L.gp,gp+L.micro.pitch,dt,40,.78);
    L.eyeYaw=L.gy.x;L.eyePitch=L.gp.x;
    // ----- 眨眼：自己的节奏（说话时更频繁，听时较少）；快闭慢睁，大小不一，偶尔成双
    if(now>=L.nextBlink){
      const amp=Math.random()<.18?rnd(.45,.7):rnd(.85,1);
      addBlink(L,now,amp);
      if(Math.random()<.12)addBlink(L,now,amp*.9,rnd(190,260));
      L.nextBlink=now+(speaking?rnd(1800,4200):rnd(2600,6200));
    }
    let b=0;
    L.blinks=L.blinks.filter(k=>{
      const e=now-k.t0;if(e<0)return true;
      if(e<k.close){b=Math.max(b,k.amp*(e/k.close));return true;}
      if(e<k.close+k.open){const u=(e-k.close)/k.open;b=Math.max(b,k.amp*(1-u*u*(3-2*u)));return true;}
      return false;
    });
    // 眼睑随眼珠上下（向下看时上眼睑跟着落）
    const down=clamp((L.eyePitch*(LOOK.eyeFlipV?-1:1)),-.8,1);
    L.lidFollow=clamp(.07+Math.max(0,down)*.55-Math.max(0,-down)*.1,0,.8);
    // ----- 表情：情绪目标（说话者随强度，听的人是反应）+ 重音闪现 + 缓慢游移
    L.flash=Math.max(0,L.flash-dt*3);
    L.emoAmt+=(L.emoGoal-L.emoAmt)*f(L.emoGoal>L.emoAmt?5:1.6);
    if(!speaker&&!L.wasSpeaking)L.emoGoal*=Math.exp(-dt*.5);
    if(now>=L.nextDrift){for(const c of CH)L.driftT[c]=rnd(-1,1)*(c==='brow'||c==='frown'||c==='smileL'||c==='smileR'?.05:.025);L.nextDrift=now+rnd(700,2200);}
    const e=L.emo,a=Math.min(1.5,L.emoAmt*(LOOK.exprAmp??1)),as=L.asym;
    const tg={
      brow:(e.brow||0)*a+L.flash*.3*(.5+a*.8)+L.driftT.brow,
      frown:(e.frown||0)*a+L.driftT.frown,
      smileL:(e.smile||0)*a*(e.asym?(as<0?1:1-e.asym):1)+L.driftT.smileL,
      smileR:(e.smile||0)*a*(e.asym?(as>0?1:1-e.asym):1)+L.driftT.smileR,
      cheek:(e.cheek||0)*a+(L.flash*.08),
      mfrown:(e.mfrown||0)*a,
      sneer:(e.sneer||0)*a,
      press:(e.press||0)*a*(speaking?.35:1),
      squint:(e.squint||0)*a,
      lid:(e.lid||0)*a
    };
    for(const c of CH)L.ch[c]+=((c==='lid'?tg[c]:Math.max(0,tg[c]))-L.ch[c])*f(c==='brow'?9:6);
    // 睁眼/闭眼底线：基础 .12，情绪眯眼抬高，惊讶睁大降低；眨眼叠加其上
    const base=clamp(.12+L.ch.squint*.8+L.ch.lid,0,.6);
    L.blink=Math.max(base,b);
    // 说话人的头在没被标注时保持不动太久会僵：偶尔小幅度自然晃
  }
}

/* ---------- 对焦 ---------- */
let focusCur=4;
const _fwd=new THREE.Vector3(),_rel=new THREE.Vector3(),_pt=new THREE.Vector3();
function updateFocus(){
  camera.updateMatrixWorld();camera.getWorldDirection(_fwd);
  let best=null,bestScore=1e9;
  for(const slot of slots){
    const head=heads[slot];if(!head)continue;
    const yaw=head.group.userData.baseYaw;
    _pt.set(head.group.position.x+Math.sin(yaw)*.25,head.group.position.y+EYE_UP,head.group.position.z+Math.cos(yaw)*.25);
    _rel.copy(_pt).sub(camera.position);
    const dz=_rel.dot(_fwd);if(dz<.2)continue;
    let score=Math.acos(clamp(dz/_rel.length(),-1,1));
    if(LOOK.focusHead===slot||(LOOK.focusHead==='speaker'&&currentSpeaker===slot))score-=10;
    if(score<bestScore){bestScore=score;best=dz;}
  }
  if(best===null)return;
  const target=best+LOOK.focusOffset;
  focusCur+=(target-focusCur)*.2;
}

/* ---------- 渲染 ---------- */
let glowCur=0;
const spotCur={x:.5,s:0};let levelCur=1;
let fpsCount=0,fpsStart=performance.now(),fps=0;
function renderFrame(now){
  updateFocus();
  const size=postMaterial.uniforms.uRes.value;
  postMaterial.uniforms.uNear.value=camera.near;postMaterial.uniforms.uFar.value=camera.far;
  postMaterial.uniforms.uFocus.value=focusCur;
  postMaterial.uniforms.uBlur.value=LOOK.dof*14*(size.y/1080);
  postMaterial.uniforms.uTime.value=now*.001;
  glowCur+=((audience&&audience.visible?LOOK.glow:0)-glowCur)*.08;postMaterial.uniforms.uGlow.value=glowCur;
  scene.background=null;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000,0);
  renderer.clear();
  renderer.render(scene,camera);
  renderer.setRenderTarget(null);
  postMaterial.uniforms.tColor.value=rt.texture;postMaterial.uniforms.tDepth.value=rt.depthTexture;
  renderer.render(postScene,postCamera);
}

function render(now){
  requestAnimationFrame(render);
  if(!renderer||!scene||!camera||now-lastFrame<33)return;
  const dt=Math.min((now-lastFrame)/1000,.1);
  lastFrame=now;
  applyIdle(now);
  updateAttention(now,dt);
  animateAudience(now,dt);
  updateTag(now,dt);
  for(const head of Object.values(heads)){
    head.dimCur+=(head.dim-head.dimCur)*(1-Math.exp(-dt*8));
    head.uni.uDim.value=head.dimCur;
  }
  stepCamera(now);
  if(!cam.tween&&orbit?.enabled)orbit.update();
  renderFrame(now);
  fpsCount++;
  if(now-fpsStart>=1000){fps=Math.round(fpsCount*1000/(now-fpsStart));fpsCount=0;fpsStart=now;}
}

function updateAttention(now,dt){
  const speaker=now<humanMouthUntil?'human':null;
  currentSpeaker=speaker;
  const response=1-Math.exp(-dt*3);
  updateLife(now,dt);
  for(const slot of slots){
    const head=heads[slot];if(!head)continue;
    const offset=speaker&&speaker!==slot?slots.indexOf(speaker)-slots.indexOf(slot):0;
    const direction=Math.sign(offset);
    const headYaw=direction*(Math.abs(offset)>1?.5:.34);
    const eyeYaw=direction*(Math.abs(offset)>1?.8:.62);  // 眼睛逻辑不变
    head.dim=speaker&&speaker!==slot?1-LOOK.quietDim:1;
    head.attention.headYaw+=((offset?headYaw:0)-head.attention.headYaw)*response;
    head.attention.eyeYaw+=((offset?eyeYaw:0)-head.attention.eyeYaw)*response;
    applyDriver(slot);
  }
}

function cleanFace(values){
  if(!values||typeof values!=='object')return {};
  const clean={};
  for(const name of [...MORPHS,...EYES])if(Object.prototype.hasOwnProperty.call(values,name))clean[name]=number(values[name],0);
  return clean;
}
function cleanPose(values){
  if(!values||typeof values!=='object')return {};
  const clean={};
  for(const name of ['pitch','yaw','roll'])if(Object.prototype.hasOwnProperty.call(values,name))clean[name]=number(values[name],0);
  return clean;
}

function ingest(data){
  if(data.type==='saier:phase'&&data.slot!=='human'){
    speakingSince[data.slot]=data.phase==='speaking'?performance.now():0;
    return;
  }
  if(data.type!=='saier:driver'||!['face','pose'].includes(data.channel))return;
  const now=performance.now();
  if(now-lastDriverAt[data.slot]>=800){drivers[data.slot]=headState();}
  lastDriverAt[data.slot]=now;
  if(data.channel==='face')drivers[data.slot].face={...drivers[data.slot].face,...cleanFace(data.values)};
  else drivers[data.slot].pose={...drivers[data.slot].pose,...cleanPose(data.values)};
  if(data.slot==='human'&&data.channel==='face'&&number(data.values?.jawOpen,0)>.12)humanMouthUntil=performance.now()+650;
  applyDriver(data.slot);
}
// 美术审核版不监听外部驱动消息。

// 环屏平铺视角：滚轮缩放、拖动平移、双击复位
{
  const pan={on:false,x:0,y:0};
  canvas?.addEventListener('wheel',event=>{
    if(isFlat()){
      event.preventDefault();
      const h=clamp(LOOK.flatHeight*Math.exp(event.deltaY*.0012),1,14);
      // 以鼠标所在位置为中心缩放
      const rect=canvas.getBoundingClientRect();
      const nx=((event.clientX-rect.left)/rect.width-.5),ny=(.5-(event.clientY-rect.top)/rect.height);
      const wOld=LOOK.flatHeight*outAspect,wNew=h*outAspect;
      setLook({flatHeight:h,flatX:clamp(LOOK.flatX+nx*(wOld-wNew),-16,16),flatY:clamp(LOOK.flatY+ny*(LOOK.flatHeight-h),0,4)});
      return;
    }
    if(!modelReady||!window.soloCam)return;
    event.preventDefault();
    window.soloCam({dist:clamp(SOLO.dist*Math.exp(event.deltaY*.001),.6,8)});
    window.rebuildSoloPanel?.();
  },{passive:false});
  canvas?.addEventListener('pointerdown',event=>{
    if(!isFlat())return;
    pan.on=true;pan.x=event.clientX;pan.y=event.clientY;
    try{canvas.setPointerCapture(event.pointerId);}catch{}
  });
  canvas?.addEventListener('pointermove',event=>{
    if(!pan.on||!isFlat())return;
    const rect=canvas.getBoundingClientRect();
    const dx=(event.clientX-pan.x)/rect.width*LOOK.flatHeight*outAspect;
    const dy=(event.clientY-pan.y)/rect.height*LOOK.flatHeight;
    pan.x=event.clientX;pan.y=event.clientY;
    setLook({flatX:clamp(LOOK.flatX-dx,-16,16),flatY:clamp(LOOK.flatY+dy,0,4)});
  });
  const stopPan=()=>{pan.on=false;};
  canvas?.addEventListener('pointerup',stopPan);canvas?.addEventListener('pointercancel',stopPan);
  canvas?.addEventListener('dblclick',()=>{if(isFlat())setLook({flatX:BASE.flatX,flatY:BASE.flatY,flatHeight:BASE.flatHeight});});
}

// 场内环顾：拖动画面
canvas?.addEventListener('pointerdown',event=>{
  if(currentView!=='center'||cam.tween)return;
  look.dragging=true;look.x=event.clientX;look.y=event.clientY;
  try{canvas.setPointerCapture(event.pointerId);}catch{}
});
canvas?.addEventListener('pointermove',event=>{
  if(!look.dragging)return;
  look.targetYaw=clamp(look.targetYaw+(event.clientX-look.x)*.004,-.9,.9);
  look.targetPitch=clamp(look.targetPitch+(event.clientY-look.y)*.003,-.3,.35);
  look.x=event.clientX;look.y=event.clientY;
});
const endDrag=()=>{look.dragging=false;};
canvas?.addEventListener('pointerup',endDrag);canvas?.addEventListener('pointercancel',endDrag);

function announce(ready,error){
  window.dispatchEvent(new CustomEvent('saier-scene-ready',{detail:{ready,error:error||null}}));
}

// 仅用于没有模型文件时检查镜头与版式：?stub=1
function stubModel(){
  const group=new THREE.Group();
  const skin=new THREE.MeshStandardMaterial({color:0xc99b83,roughness:.6});
  const head=new THREE.Mesh(new THREE.SphereGeometry(1,40,28),skin);
  head.name='Head';head.scale.set(7.8,10.6,9.2);head.position.set(0,29.1,2);group.add(head);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(4.3,10.5,19,24),skin);neck.name='Neck';neck.position.set(0,15.2,0);group.add(neck);
  for(const x of [-3,3]){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(1.5,16,12),new THREE.MeshStandardMaterial({color:0xeeeeee}));
    eye.name='Realtime Eyeball';eye.position.set(x,29.85,10);group.add(eye);
  }
  const mouth=new THREE.Mesh(new THREE.BoxGeometry(5,.7,.6),new THREE.MeshStandardMaterial({color:0x7a3f3a}));
  mouth.position.set(0,23.5,11);group.add(mouth);
  return group;
}

const localEyeMaps=new Map();
let embeddedEye=null;
const EYE_IDS=['embedded','bloodshot','horizontal','vertical'];
function copyTexture(source,target){
  if(source){for(const key of ['offset','repeat','center','matrix'])target[key].copy(source[key]);target.rotation=source.rotation;target.channel=source.channel;}
  target.flipY=false;target.colorSpace=THREE.SRGBColorSpace;target.needsUpdate=true;
}
async function loadLocalAppearance(source){
  let skin,eye;
  source.traverse(object=>{if(object.isMesh)for(const material of materialsOf(object)){if(material.name==='Head Skin Web')skin=material;if(material.name==='Eyes Web')eye=material;}});
  if(!skin||!eye)throw new Error('请使用包含配套皮肤和眼睛材质的头模。');
  embeddedEye=eye.map;
  if(assets.skin){const map=await new THREE.TextureLoader().loadAsync(assets.skin.url);copyTexture(skin.map,map);skin.map=map;skin.needsUpdate=true;}
}
async function setSoloEye(slot,id){
  if(slot!=='human'||!EYE_IDS.includes(id))return false;
  const variants={bloodshot:{center:[.5,.49],diameter:.405},horizontal:{center:[.497,.493],diameter:.386},vertical:{center:[.499,.484],diameter:.465}};
  let map=embeddedEye;
  if(id!=='embedded'&&assets[id]&&variants[id]){
    if(!localEyeMaps.has(id)){
      const promise=new THREE.TextureLoader().loadAsync(assets[id].url).then(texture=>{copyTexture(embeddedEye,texture);const variant=variants[id],scale=variant.diameter/.23;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.center.set(0,0);texture.rotation=0;texture.repeat.set(scale,scale);texture.offset.set(variant.center[0]-scale*.5,variant.center[1]-scale*.5);texture.matrixAutoUpdate=true;texture.updateMatrix();return texture;});
      localEyeMaps.set(id,promise);
    }
    map=await localEyeMaps.get(id);
  }
  heads.human?.model.traverse(object=>{if(object.isMesh)for(const material of materialsOf(object))if(material.name==='Eyes Web'){material.map=map;material.normalMap=null;material.roughnessMap=null;material.roughness=.4;material.needsUpdate=true;}});
  return true;
}
async function loadModel(){
  const draco=new DRACOLoader().setDecoderPath('./vendor/three/examples/jsm/libs/draco/');
  try{
    setStatus('正在载入单头模型…');
    let source;
    if(params.has('stub'))source=stubModel();
    else{
      const loader=new GLTFLoader().setDRACOLoader(draco);
      const gltf=await loader.loadAsync(assets.model.url,event=>{if(event.total)setStatus(`正在载入本地头模… ${Math.round(event.loaded/event.total*100)}%`);});
      source=gltf.scene;
    }
    await loadLocalAppearance(source);
    normalize(source);
    for(const slot of slots)prepareHead(slot,source);
    applyLook();
    // 单人镜头：只留中间这一颗，相机贴近、固定
    cam.free=false;tag.enabled=false;
    window.soloCam=(o={})=>{for(const [key,min,max] of [['dist',.6,8],['fov',6,60],['height',1.3,2.8],['x',-1,1]])if(Number.isFinite(o[key]))SOLO[key]=clamp(o[key],min,max);soloFrame();try{localStorage.setItem('saier-art-workbench.solo.cam.v1',JSON.stringify(SOLO));}catch{}return {...SOLO};};
    await setSoloEye('human',importedEyes.human);
    soloFrame();
    requestAnimationFrame(now=>{
      modelReady=true;
      renderFrame(now);
      document.getElementById('loading')?.remove();
    setStatus('赛尔单头模型已载入');announce(true);
    });
  }catch(error){
    const message=error?.message||String(error);
    setStatus(`三维场景载入失败：${message}`,true);announce(false,message);console.error(error);
  }finally{draco.dispose();}
}

const SOLO={dist:5,fov:28,height:1.3,x:0};
try{Object.assign(SOLO,JSON.parse(localStorage.getItem('saier-art-workbench.solo.cam.v1')||'{}'));}catch{}
for(const [key,min,max,fallback] of [['dist',.6,8,5],['fov',6,60,28],['height',1.3,2.8,1.3],['x',-1,1,0]])SOLO[key]=clamp(number(SOLO[key],fallback),min,max);
function soloFrame(){
  const head=heads.human;if(!head)return;
  const base=head.group.position;
  currentView='center';
  const rect=(stage||canvas).getBoundingClientRect(),aspect=rect.height>0?rect.width/rect.height:1;
  const fit=aspect<.8?Math.min(1.8,.8/Math.max(.35,aspect)):1;
  const actualDist=SOLO.dist*fit;
  flyTo({pos:[base.x+SOLO.x,SOLO.height,base.z+actualDist],target:[base.x+SOLO.x,SOLO.height,base.z],fov:SOLO.fov},0);
}
function screenshot(){
  return new Promise((resolve,reject)=>{
    try{
      const old=renderer.getPixelRatio(),rect=(stage||canvas).getBoundingClientRect();
      renderer.setPixelRatio(Math.max(old,Math.min(2,2560/Math.max(1,rect.width))));resize();
      renderFrame(performance.now());
      canvas.toBlob(blob=>{
        try{renderer.setPixelRatio(old);resize();renderFrame(performance.now());blob?resolve(blob):reject(new Error('截图失败'));}
        catch(error){reject(error);}
      },'image/png');
    }catch(error){reject(error);}
  });
}

window.saierScene={
  setView,setDim,flyTo,closeUp,project,setLook,applyPreset,screenshot,
  getLook:()=>({...LOOK}),
  defaults:name=>({...(PRESETS[name]||PRESETS.black)}),
  get schema(){return PUBLIC_SCHEMA;},
  get presets(){return Object.keys(PRESETS);},
  get ready(){return modelReady;},
  get view(){return currentView;},
  get fps(){return fps;},
  get speaker(){return currentSpeaker;},
  // 环屏输出：按环幕比例取景，画面被横向压进当前窗口（现场再被拉伸回去）；0 = 关
  setOutputAspect(a){outAspect=Number(a)>0?Number(a):0;applyLook();placeCamera();resize();},
  exportLooks(){return JSON.stringify({...saved,current:LOOK.preset,[LOOK.preset]:{...LOOK,_t:Date.now(),preset:undefined}},null,2);},
  setTagEnabled(value){tag.enabled=Boolean(value);},
  get _tag(){return tag;},
  // 预览用：不接 AI 时模拟某一位在说话（ms 毫秒）
  simulateSpeaking(slot,ms=4000){
    if(slot==='human'){humanMouthUntil=performance.now()+ms;return;}
    if(slot in speakingSince){speakingSince[slot]=performance.now();setTimeout(()=>{speakingSince[slot]=0;},ms);}
  }
};

window.workbenchView={
  get ready(){return modelReady;},get canvas(){return canvas;},
  getState(){return {look:{...LOOK},cam:{...SOLO}};},
  setState(state){if(state?.look)setLook(state.look);if(state?.cam)window.soloCam?.(state.cam);window.rebuildSoloPanel?.();return this.getState();},
  setEye:setSoloEye,screenshot,
  toggleControls(show){document.getElementById('panel')?.classList.toggle('on',Boolean(show));const bar=document.getElementById('bar');if(bar)bar.hidden=!show;}
};

if(!stage||!canvas){
  setStatus('三维场景缺少舞台节点',true);announce(false,'missing stage nodes');
}else{
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.AgXToneMapping;
    createPost();
    createWorld();
    const start=params.get('look')||saved.current;
    LOOK={preset:PRESETS[start]?start:'black',...sanitize(saved[PRESETS[start]?start:'black'],PRESETS[PRESETS[start]?start:'black'])};
    resize();applyLook();lookChanged();
    addEventListener('resize',resize);
    if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(stage);
    requestAnimationFrame(render);void loadModel();
  }catch(error){
    const message=error?.message||String(error);setStatus(`三维场景启动失败：${message}`,true);announce(false,message);console.error(error);
  }
}
