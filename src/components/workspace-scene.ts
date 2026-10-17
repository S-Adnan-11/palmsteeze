import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries, mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {createTimeline} from 'animejs';

export type WorkspaceScene = {setPlaying: (playing: boolean) => void; setVisible: (visible: boolean) => void; renderAt: (milliseconds: number) => void; dispose: () => void};
const DURATION = 12000;
const FRAME = 1000 / 30;

// Everything in this room, including its textures, is built here. No models,
// photographs, environment downloads, scroll listeners or second animation clock.
function buildRoom(scene: T.Scene, camera: T.PerspectiveCamera) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const own = <G extends T.BufferGeometry>(g: G) => {geometries.add(g); return g;};
  const material = (options: T.MeshStandardMaterialParameters) => {
    const m = new T.MeshStandardMaterial(options); materials.add(m); return m;
  };
  let seed = 2319;
  const random = () => {seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296;};
  function texture(kind: 'wood' | 'plaster' | 'fabric' | 'shadow') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    if (kind === 'shadow') {
      const gradient = ctx.createRadialGradient(128,128,5,128,128,125);
      gradient.addColorStop(0,'#241c13aa'); gradient.addColorStop(.35,'#241c1355'); gradient.addColorStop(1,'#241c1300');
      ctx.fillStyle = gradient; ctx.fillRect(0,0,256,256);
    } else {
      ctx.fillStyle = kind === 'wood' ? '#bda080' : '#e9e4d5'; ctx.fillRect(0,0,256,256);
      for (let i=0; i<5000; i++) {
        const shade = Math.floor(80+random()*140);
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${kind === 'wood' ? .12 : .065})`;
        if (kind === 'wood') ctx.fillRect(random()*256,random()*256,random()*.8+.2,8+random()*120);
        else ctx.fillRect(random()*256,random()*256,kind === 'fabric' ? 1 : 2,1);
      }
      if (kind === 'fabric') for(let i=0;i<256;i+=2) {
        ctx.fillStyle='#ffffff0a';ctx.fillRect(i,0,1,256);ctx.fillRect(0,i,256,1);
      }
    }
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping;
    if(kind !== 'shadow') map.repeat.set(kind === 'wood' ? 2 : 3,kind === 'wood' ? 1 : 3);
    textures.add(map); return map;
  }
  const woodMap = texture('wood'), plasterMap = texture('plaster'), fabricMap = texture('fabric');
  const oak = material({color:'#b88d61',map:woodMap,roughness:.54});
  const walnut = material({color:'#806044',map:woodMap,roughness:.57});
  const plaster = material({color:'#eee4cf',map:plasterMap,roughness:1});
  const trim = material({color:'#c9b99b',roughness:.88});
  const green = material({color:'#42654c',map:fabricMap,roughness:.95});
  const deepGreen = material({color:'#203f30',roughness:.75});
  const brass = material({color:'#99825a',metalness:.65,roughness:.35});
  const ceramic = material({color:'#e8dcc3',roughness:.7});
  const terra = material({color:'#a06f51',map:plasterMap,roughness:.95});
  const paper = material({color:'#e5dfc9',roughness:1});
  const rugMat = material({color:'#bfb79a',map:fabricMap,roughness:1});
  const dayCanvas=document.createElement('canvas');dayCanvas.width=256;dayCanvas.height=512;
  const day=dayCanvas.getContext('2d')!;
  const sky=day.createLinearGradient(0,0,0,512);sky.addColorStop(0,'#e7ecda');sky.addColorStop(.52,'#f7efd3');sky.addColorStop(1,'#b8c5a1');day.fillStyle=sky;day.fillRect(0,0,256,512);
  // Soft silhouettes beyond the glazing are drawn from deterministic geometry.
  day.filter='blur(9px)';
  for(let i=0;i<30;i++) {day.fillStyle=i%2?'#71875b33':'#a5b18566';day.beginPath();day.ellipse(random()*290,330+random()*180,15+random()*45,25+random()*65,-.4,0,Math.PI*2);day.fill();}
  const daylight=new T.CanvasTexture(dayCanvas);daylight.colorSpace=T.SRGBColorSpace;textures.add(daylight);
  const glass = material({color:'#f4efd8',map:daylight,emissive:'#e4e3c5',emissiveMap:daylight,emissiveIntensity:.45,roughness:.5});
  const leafMats = ['#284d31','#3f6239','#527343'].map(color=>material({color,roughness:.68,side:T.DoubleSide}));
  const shadowMat = new T.MeshBasicMaterial({map:texture('shadow'),transparent:true,depthWrite:false,opacity:.45});materials.add(shadowMat);

  // Merge static meshes by material, retaining individual authored shapes while
  // keeping draw calls bounded on software-rendered and integrated GPUs.
  function consolidate(group: T.Group) {
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    const buckets = new Map<T.Material,{parts:T.BufferGeometry[];cast:boolean;receive:boolean}>();
    group.traverse(object=>{
      if (!(object instanceof T.Mesh) || Array.isArray(object.material)) return;
      const bucket = buckets.get(object.material) || {parts:[],cast:false,receive:false};
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.deleteAttribute('uv1');
      geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,object.matrixWorld));
      bucket.parts.push(geometry);bucket.cast ||= object.castShadow;bucket.receive ||= object.receiveShadow;
      buckets.set(object.material,bucket);
    });
    group.clear();
    for(const [mat,bucket] of buckets) {
      const combined = mergeGeometries(bucket.parts);
      bucket.parts.forEach(part=>part.dispose());
      if(!combined) throw new Error('Room geometry could not be assembled');
      const mesh = new T.Mesh(own(combined),mat);mesh.castShadow=bucket.cast;mesh.receiveShadow=bucket.receive;group.add(mesh);
    }
  }
  const room = new T.Group();scene.add(room);
  function mesh(parent: T.Object3D, geometry: T.BufferGeometry, mat: T.Material, x=0,y=0,z=0) {
    const object = new T.Mesh(own(geometry),mat);object.position.set(x,y,z);
    object.castShadow=mat!==shadowMat && mat!==glass;
    object.receiveShadow=mat===oak || mat===plaster || mat===rugMat;
    parent.add(object); return object;
  }
  function box(parent:T.Object3D,mat:T.Material,x:number,y:number,z:number,w:number,h:number,d:number,r=.015) {
    return mesh(parent,new RoundedBoxGeometry(w,h,d,1,Math.min(r,w/3,h/3,d/3)),mat,x,y,z);
  }
  function cylinder(parent:T.Object3D,mat:T.Material,x:number,y:number,z:number,top:number,bottom:number,height:number) {
    return mesh(parent,new T.CylinderGeometry(top,bottom,height,24),mat,x,y,z);
  }
  function rod(parent:T.Object3D,mat:T.Material,a:T.Vector3,b:T.Vector3,r:number) {
    const object = mesh(parent,new T.CylinderGeometry(r,r,a.distanceTo(b),8),mat);
    object.position.copy(a).add(b).multiplyScalar(.5);object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),b.clone().sub(a).normalize());return object;
  }
  function contact(x:number,z:number,w:number,d:number,opacity=1) {
    const object=mesh(room,new T.PlaneGeometry(w,d),shadowMat,x,.012,z);object.rotation.x=-Math.PI/2;object.scale.setScalar(opacity);
  }
  function arch(width:number,height:number) {
    const shape = new T.Shape(), r=width/2;
    shape.moveTo(-r,0);shape.lineTo(r,0);shape.lineTo(r,height-r);
    shape.absarc(0,height-r,r,0,Math.PI,false);shape.lineTo(-r,0);return shape;
  }

  box(room,plaster,0,2.5,-10.3,10,5,.28);
  box(room,plaster,-5,2.5,-2.2,.22,5,16);
  box(room,plaster,5,2.5,-2.2,.22,5,16);
  box(room,plaster,0,5,-2.3,10,.18,16);
  box(room,walnut,0,-.07,-2.1,10,.12,16);
  // Staggered wide oak boards, not a single flat floor.
  for(let col=0;col<15;col++)for(let row=0;row<5;row++) {
    const z=5.7-row*3.3-(col%2)*1.65;
    box(room,oak,-4.65+col*.665,0,z,.655,.055,3.28,.004);
  }
  for(const x of [-4.86,4.86])box(room,trim,x,.13,-2.2,.1,.24,16);
  box(room,trim,0,.13,-10.1,10,.24,.1);

  // Tall arched windows with a recessed reveal, mullions and warm daylight.
  for(const x of [-3.15,0,3.15]) {
    mesh(room,new T.ShapeGeometry(arch(2.45,3.9)),trim,x,.65,-10.1);
    const pane=new T.ShapeGeometry(arch(2.18,3.65));
    const panePosition=pane.getAttribute('position'),paneUv=pane.getAttribute('uv');
    for(let i=0;i<paneUv.count;i++)paneUv.setXY(i,(panePosition.getX(i)+1.09)/2.18,panePosition.getY(i)/3.65);
    mesh(room,pane,glass,x,.76,-10.06);
    box(room,deepGreen,x,2.56,-10.01,.035,3.5,.04,.003);
    box(room,deepGreen,x,2.25,-10.0,2.18,.035,.04,.003);
    box(room,trim,x,.71,-9.91,2.6,.12,.28);
  }
  // Rhythm of structural timber and a softly curved threshold to the meeting area.
  for(const x of [-4.6,4.6]) {
    box(room,oak,x,2.35,-3.55,.18,4.7,.2);
    box(room,oak,x,2.35,1.9,.18,4.7,.2);
  }
  box(room,oak,0,4.66,-3.55,9.4,.18,.25);
  for(let i=0;i<12;i++)box(room,walnut,-4.5+i*.16,1.64,-3.55,.06,3.2,.12);
  const archWall = new T.Shape();archWall.moveTo(-2.4,0);archWall.lineTo(2.4,0);archWall.lineTo(2.4,4.6);archWall.lineTo(-2.4,4.6);archWall.closePath();
  const hole = new T.Path();hole.moveTo(-1.6,0);hole.lineTo(-1.6,2.5);hole.absarc(0,2.5,1.6,Math.PI,0,true);hole.lineTo(1.6,0);hole.closePath();archWall.holes.push(hole);
  mesh(room,new T.ExtrudeGeometry(archWall,{depth:.22,bevelEnabled:false,curveSegments:32}),plaster,1.7,0,-4.55);
  // Wall shelf and original abstract relief artwork.
  box(room,walnut,4.78,1.13,-5.8,.38,.07,4.8);
  for(let i=0;i<7;i++)box(room,i%2?paper:green,4.72,1.34,-4.2-i*.13,.25,.37,.08);
  box(room,oak,4.84,2.8,-.8,.08,1.5,1.12);
  box(room,paper,4.78,2.8,-.8,.04,1.35,.98);
  const art=mesh(room,new T.CircleGeometry(.36,40),terra,4.75,2.9,-.8);art.rotation.y=-Math.PI/2;art.scale.y=1.25;
  box(room,deepGreen,4.73,2.56,-.62,.03,.39,.25,.09);

  function chair(x:number,z:number,rotation=0) {
    const group=new T.Group();group.position.set(x,0,z);group.rotation.y=rotation;room.add(group);
    box(group,green,0,.52,0,.65,.14,.62,.065);
    // Curved upholstered back with a separate timber shell and welt.
    const shape=new T.Shape();shape.moveTo(-.34,.6);shape.lineTo(-.34,1.07);shape.quadraticCurveTo(0,1.32,.34,1.07);shape.lineTo(.34,.6);shape.quadraticCurveTo(0,.54,-.34,.6);
    const shell=mergeVertices(own(new T.ExtrudeGeometry(shape,{depth:.095,bevelEnabled:true,bevelSize:.025,bevelThickness:.02,bevelSegments:3,curveSegments:16})));
    const shellPositions=shell.getAttribute('position');
    for(let i=0;i<shellPositions.count;i++)shellPositions.setZ(i,shellPositions.getZ(i)-shellPositions.getX(i)**2*1.1);
    shell.computeVertexNormals();
    const back=mesh(group,shell,green,0,0,.24);back.rotation.x=-.08;
    for(const side of [-1,1])for(const front of [-1,1])rod(group,walnut,new T.Vector3(side*.24,.48,front*.22),new T.Vector3(side*.30,.04,front*.30),.029);
    for(const side of [-1,1]) {
      rod(group,brass,new T.Vector3(side*.32,.57,.18),new T.Vector3(side*.32,.78,-.19),.012);
      box(group,walnut,side*.33,.79,-.02,.07,.05,.45,.025);
    }
    contact(x,z,1.4,1.4);
  }
  function cup(parent:T.Object3D,x:number,y:number,z:number) {
    cylinder(parent,ceramic,x,y+.05,z,.075,.058,.11);
    const handle=mesh(parent,new T.TorusGeometry(.035,.011,6,16),ceramic,x+.075,y+.065,z);handle.rotation.y=0;
    cylinder(parent,walnut,x,y+.109,z,.059,.059,.002);
    cylinder(parent,ceramic,x,y-.006,z,.11,.11,.012);
  }
  function desk(x:number,z:number) {
    box(room,oak,x,.81,z,2.65,.105,1.14,.045);
    for(const side of [-1,1]) {
      box(room,walnut,x+side*1.08,.39,z,.12,.76,.92,.025);
      box(room,walnut,x,.17,z,2.2,.07,.09);
    }
    box(room,deepGreen,x-.08,.875,z-.06,.65,.025,.4,.025);
    box(room,paper,x-.06,.895,z-.06,.57,.012,.34,.01);
    const pencil=box(room,brass,x+.3,.887,z+.13,.16,.016,.018);pencil.rotation.y=.3;
    cup(room,x+.8,.875,z+.14);
    // Closed notebook, brass reading lamp and a dark inset laptop screen.
    box(room,terra,x-.8,.88,z+.1,.33,.035,.44,.012);
    cylinder(room,brass,x-.88,.89,z-.32,.13,.13,.025);
    rod(room,brass,new T.Vector3(x-.88,.9,z-.32),new T.Vector3(x-.88,1.47,z-.32),.012);
    const shade=mesh(room,new T.SphereGeometry(.19,24,12,0,Math.PI*2,0,Math.PI/2),deepGreen,x-.88,1.46,z-.32);shade.rotation.z=.1;
    const screen=box(room,deepGreen,x+.17,1.08,z-.32,.56,.36,.025,.018);screen.rotation.x=-.16;
    box(room,brass,x+.17,.881,z-.15,.58,.012,.38,.01);
    chair(x+.1,z+.95);contact(x,z,3.3,2.3);
  }
  desk(-1.8,.15);desk(-2.45,-2.4);
  // A large rounded communal table and six individual upholstered seats.
  box(room,rugMat,1.4,.04,-7.35,5,.025,4.2,.28);
  const tabletop=mesh(room,new T.CylinderGeometry(1,1,.12,64),oak,1.4,.83,-7.35);tabletop.scale.set(1.65,1,1.08);
  for(const side of [-1,1])cylinder(room,walnut,1.4+side*.85,.41,-7.35,.16,.24,.77);
  for(const x of [.48,2.32]) {chair(x,-6.02);chair(x,-8.68,Math.PI);}
  chair(-.64,-7.35,-Math.PI/2);chair(3.44,-7.35,Math.PI/2);
  cup(room,.75,.9,-7.3);cup(room,2.35,.9,-7.48);
  box(room,paper,1.45,.912,-7.03,.47,.02,.35);
  cylinder(room,terra,1.35,1.05,-7.54,.09,.14,.29);
  for(let i=0;i<5;i++)rod(room,deepGreen,new T.Vector3(1.35,1.1,-7.54),new T.Vector3(1.2+i*.07,1.56+(i%2)*.12,-7.5),.007);
  contact(1.4,-7.35,4.7,3.5);

  function pendant(x:number,z:number,y:number,r:number) {
    rod(room,brass,new T.Vector3(x,4.9,z),new T.Vector3(x,y,z),.009);
    const shade=mesh(room,new T.SphereGeometry(r,32,16,0,Math.PI*2,0,Math.PI/2),trim,x,y,z);shade.scale.y=.65;
    cylinder(room,ceramic,x,y-.01,z,r*.91,r*.91,.014);
    for(let i=0;i<24;i++) {
      const a=i/24*Math.PI*2;
      rod(room,brass,new T.Vector3(x+Math.cos(a)*r,y,z+Math.sin(a)*r),new T.Vector3(x+Math.cos(a)*r*.24,y+r*.60,z+Math.sin(a)*r*.24),.004);
    }
  }
  pendant(-1.8,.15,2.9,.46);pendant(1.4,-7.35,3.1,.7);
  // Low banquette, linen cushions and a slatted credenza.
  box(room,walnut,-3.9,.27,-7.5,1.35,.44,3.6,.06);
  box(room,green,-3.85,.56,-7.5,1.24,.22,3.5,.10);
  box(room,green,-4.4,1.0,-7.5,.22,.85,3.5,.10);
  for(const z of [-6.5,-7.6,-8.5]) {const cushion=box(room,paper,-4.15,.91,z,.23,.48,.53,.09);cushion.rotation.z=-.24;}
  box(room,walnut,3.9,.5,-9.35,1.7,.9,.66);
  for(let i=0;i<19;i++)box(room,oak,3.09+i*.09,.5,-8.995,.035,.78,.04);
  cylinder(room,ceramic,3.6,1.1,-9.35,.08,.16,.3);

  // Curved palm leaflets: folded midrib, pointed ends, tapered silhouette.
  const blade=own(new T.BufferGeometry());
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let i=0;i<=16;i++) {
    const t=i/16,width=Math.pow(Math.sin(Math.PI*t),.8)*.055;
    for(const s of [-1,0,1]) {positions.push(t,width*s,.12*Math.sin(Math.PI*t)-Math.abs(s)*width*.25);uvs.push(t,(s+1)/2);}
  }
  for(let i=0;i<16;i++)for(let j=0;j<2;j++) {const a=i*3+j;indices.push(a,a+3,a+1,a+1,a+3,a+4);}
  blade.setAttribute('position',new T.Float32BufferAttribute(positions,3));blade.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));blade.setIndex(indices);blade.computeVertexNormals();
  function frond(parent:T.Object3D,length:number,mat:T.Material) {
    const group=new T.Group();parent.add(group);
    const curve=new T.QuadraticBezierCurve3(new T.Vector3(),new T.Vector3(.05,length*.8,0),new T.Vector3(length*.55,length*.72,-.12));
    mesh(group,new T.TubeGeometry(curve,18,.009,5,false),mat);
    for(let i=2;i<17;i++)for(const side of [-1,1]) {
      const t=i/18,point=curve.getPoint(t),leaf=mesh(group,blade,mat,point.x,point.y,point.z);
      leaf.scale.set(length*(.34*Math.sin(t*Math.PI)+.04),length*.48,1);
      leaf.rotation.z=side>0?-.35:Math.PI+.5;leaf.rotation.y=side*.22;
    }
    return group;
  }
  const palms:T.Group[]=[];
  function palm(x:number,z:number,height:number) {
    cylinder(room,terra,x,.35,z,.34,.25,.7);cylinder(room,walnut,x,.70,z,.31,.31,.035);contact(x,z,1.7,1.7);
    const group=new T.Group();group.position.set(x,.7,z);scene.add(group);
    for(let i=0;i<7;i++) {
      const stem=new T.Group();group.add(stem);stem.rotation.y=i*2.4;stem.rotation.z=(i%2?1:-1)*.17;
      const f=frond(stem,height*(.8+(i%3)*.1),leafMats[i%3]);f.rotation.x=.28+(i%3)*.14;
    }
    consolidate(group);palms.push(group);
  }
  palm(-3.8,3.0,2.55);palm(3.8,1.7,2.8);palm(-3.1,-9.4,2.0);palm(4.1,-4.6,2.3);
  consolidate(room);

  // Camera-local fronds close over the lens at both ends. At full closure they
  // occlude the room entirely, so the camera can reset behind real geometry.
  const leafCanvas=document.createElement('canvas');leafCanvas.width=512;leafCanvas.height=128;
  const leafPaint=leafCanvas.getContext('2d')!;
  const leafLight=leafPaint.createLinearGradient(0,0,0,128);leafLight.addColorStop(0,'#63835a');leafLight.addColorStop(.47,'#c0c99a');leafLight.addColorStop(.5,'#e3d6a7');leafLight.addColorStop(.54,'#94b17a');leafLight.addColorStop(1,'#4b764e');leafPaint.fillStyle=leafLight;leafPaint.fillRect(0,0,512,128);
  for(let i=0;i<60;i++)for(const side of [-1,1]) {const x=i*9;leafPaint.strokeStyle='#183c222a';leafPaint.lineWidth=1;leafPaint.beginPath();leafPaint.moveTo(x,64);leafPaint.quadraticCurveTo(x-16,64+side*30,x-40,64+side*64);leafPaint.stroke();}
  const leafTexture=new T.CanvasTexture(leafCanvas);leafTexture.colorSpace=T.SRGBColorSpace;textures.add(leafTexture);
  const veilMaterials=['#3e603c','#4f7049','#5f7f50'].map(color=>{
    const mat=new T.MeshBasicMaterial({color,map:leafTexture,side:T.DoubleSide,depthTest:false});materials.add(mat);return mat;
  });
  const veils=[-1,1].map(side=>{
    const group=new T.Group();camera.add(group);group.position.set(side*.1,0,-1.2);
    for(let i=0;i<8;i++) {
      const leaf=mesh(group,blade,veilMaterials[i%3],side*1.65,-1.2+i*.34,.02*i);
      leaf.scale.set(3.65,7.5,1);leaf.rotation.z=side<0?-.12:Math.PI+.12;
      // The fine midrib adds a soft highlight to each foreground leaf.
      const vein=mesh(group,new T.TubeGeometry(new T.QuadraticBezierCurve3(new T.Vector3(),new T.Vector3(1.82,0,.12),new T.Vector3(3.65,0,0)),18,.002,4,false),veilMaterials[(i+1)%3],side*1.65,-1.2+i*.34,.02*i+.005);
      vein.rotation.z=leaf.rotation.z;
    }
    consolidate(group);group.traverse(o=>{if(o instanceof T.Mesh){o.renderOrder=10;o.castShadow=false;o.receiveShadow=false;}});return group;
  });

  // Sparse, sunlit dust is world geometry on the same clock as the camera.
  const dustGeometry=own(new T.BufferGeometry()),dustPositions=new Float32Array(90);
  for(let i=0;i<90;i+=3){dustPositions[i]=random()*8-4;dustPositions[i+1]=random()*3+.5;dustPositions[i+2]=random()*13-9;}
  dustGeometry.setAttribute('position',new T.BufferAttribute(dustPositions,3));
  const dustMaterial=new T.PointsMaterial({color:'#fff6cf',size:.016,transparent:true,opacity:.42,depthWrite:false});materials.add(dustMaterial);
  const dust=new T.Points(dustGeometry,dustMaterial);scene.add(dust);
  return {palms,veils,dust,dispose:()=>{geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());scene.clear();}};
}

export function createWorkspaceScene(host:HTMLElement, onFailure:()=>void, options:{visible:boolean;autoplay:boolean;exportSize?:{width:number;height:number}}={visible:true,autoplay:false}): WorkspaceScene | undefined {
  let renderer:T.WebGLRenderer | undefined;
  let composer:EffectComposer | undefined;
  let antialias:ShaderPass | undefined;
  let room:ReturnType<typeof buildRoom> | undefined;
  let timeline:ReturnType<typeof createTimeline> | undefined;
  let resize:ResizeObserver | undefined;
  let raf=0,stillRaf=0,disposed=false,failed=false,playing=false,hasPlayed=false,last=0,lastRender=0,elapsed=0;
  let visible=options.visible,sizePending=true,widthBefore=0,heightBefore=0,ratioBefore=0;
  let frames=0,drawnTime=0,lastDiagnostic=0,drawCalls=0,triangles=0;
  // Opt-in browser proof only. Ordinary playback never updates the DOM per frame.
  const diagnostics=host.hasAttribute('data-scene-diagnostics');
  function publishDiagnostics(force=false) {
    if(!diagnostics||(!force&&performance.now()-lastDiagnostic<500))return;
    lastDiagnostic=performance.now();
    host.dataset.sceneTime=String(Math.round(drawnTime));
    host.dataset.drawCalls=String(drawCalls);host.dataset.triangles=String(triangles);
    host.dataset.frames=String(frames);
  }
  // Begin below the maximum pixel budget, then earn more pixels from measured
  // headroom. Sustained slow delivery can trade resolution down to a .5 floor.
  let quality=options.autoplay ? .65 : 1,frameCost=0,costSamples=0,frameGap=0,gapSamples=0;
  const scene=new T.Scene();
  const camera=new T.PerspectiveCamera(48,1,.05,45);scene.add(camera);
  function disposeResources() {
    cancelAnimationFrame(raf);cancelAnimationFrame(stillRaf);resize?.disconnect();timeline?.revert();
    renderer?.domElement.removeEventListener('webglcontextlost',contextLost);
    composer?.passes.forEach(pass=>pass.dispose());composer?.dispose();
    scene.traverse(o=>{if(o instanceof T.Light && 'shadow' in o)(o as T.DirectionalLight).shadow?.dispose();});
    room?.dispose();
    renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();
  }
  function failure() {
    if(failed||disposed)return;failed=true;playing=false;disposeResources();
    host.dataset.renderState='failed';
    console.error('[PalmSteeze workspace] WebGL rendering failed; still poster displayed.');
    onFailure();
  }
  function contextLost(event:Event){event.preventDefault();failure();}
  try {
    renderer=new T.WebGLRenderer({antialias:false,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:Boolean(options.exportSize)});
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.16;
    renderer.setClearColor('#e4d8bc');renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
    renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.style.visibility='hidden';renderer.domElement.addEventListener('webglcontextlost',contextLost);host.append(renderer.domElement);
    scene.fog=new T.Fog('#e6dbc4',14,32);
    scene.add(new T.HemisphereLight('#fff2d4','#8c967d',2.8));
    const sun=new T.DirectionalLight('#fff0ce',2.7);sun.position.set(-3.5,7,2);sun.target.position.set(1,0,-5);scene.add(sun,sun.target);
    sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.normalBias=.045;sun.shadow.bias=-.0005;sun.shadow.camera.far=28;
    const fill=new T.DirectionalLight('#edf4e2',1.1);fill.position.set(2,3,-9);scene.add(fill);
    room=buildRoom(scene,camera);
    // A five-tap, contrast-limited edge filter softens silhouettes without MSAA
    // or an iterative postprocessing kernel on software GPUs.
    composer=new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene,camera));composer.addPass(new OutputPass());
    antialias=new ShaderPass({
      uniforms:{tDiffuse:{value:null},resolution:{value:new T.Vector2()}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;
        void main(){
          vec4 c=texture2D(tDiffuse,vUv);
          vec3 n=texture2D(tDiffuse,vUv+vec2(0.0,resolution.y)).rgb;
          vec3 s=texture2D(tDiffuse,vUv-vec2(0.0,resolution.y)).rgb;
          vec3 e=texture2D(tDiffuse,vUv+vec2(resolution.x,0.0)).rgb;
          vec3 w=texture2D(tDiffuse,vUv-vec2(resolution.x,0.0)).rgb;
          vec3 lo=min(c.rgb,min(min(n,s),min(e,w))),hi=max(c.rgb,max(max(n,s),max(e,w)));
          float edge=smoothstep(0.06,0.28,dot(hi-lo,vec3(0.299,0.587,0.114)));
          gl_FragColor=vec4(mix(c.rgb,(n+s+e+w)*0.25,edge*0.45),c.a);
        }`,
    });composer.addPass(antialias);
    const pose={travel:0,cover:1};
    timeline=createTimeline({autoplay:false,defaults:{ease:'linear'}})
      .add(pose,{travel:[0,1],duration:DURATION},0)
      .add(pose,{cover:[1,0],duration:1500,ease:'inOutSine'},200)
      .add(pose,{cover:[0,1],duration:1400,ease:'inOutSine'},10400);
    const route=new T.CatmullRomCurve3([
      new T.Vector3(.95,1.85,5.1),new T.Vector3(.7,1.62,2.7),new T.Vector3(.48,1.58,.5),new T.Vector3(.6,1.85,-1.8),new T.Vector3(.95,2.12,-3.5),
    ]);
    const gaze=new T.CatmullRomCurve3([
      new T.Vector3(-1.1,1.45,-1.4),new T.Vector3(-1.55,.98,-.3),new T.Vector3(-1.2,1.03,-2.8),new T.Vector3(1.35,1.25,-7.2),new T.Vector3(1.45,1.2,-7.5),
    ]);
    const cameraPoint=new T.Vector3(),targetPoint=new T.Vector3();
    const draw=()=>{
      if(disposed||failed||!visible)return;
      timeline!.seek(elapsed,true);
      route.getPoint(pose.travel,cameraPoint);gaze.getPoint(pose.travel,targetPoint);
      camera.position.copy(cameraPoint);camera.lookAt(targetPoint);
      const phase=elapsed/DURATION*Math.PI*2;
      room!.palms.forEach((p,i)=>{p.rotation.z=Math.sin(phase+i)*.012;p.rotation.y=Math.sin(phase+i*.8)*.014;});
      room!.veils.forEach((v,i)=>{const side=i===0?-1:1;v.position.x=side*(.10+(1-pose.cover)*2.6);v.rotation.z=side*(1-pose.cover)*.35;});
      room!.dust.position.y=Math.sin(phase)*.055;
      const started=performance.now();renderer!.info.autoReset=false;renderer!.info.reset();composer!.render();
      frameCost+=performance.now()-started;costSamples++;
      if(!frames)renderer!.domElement.style.visibility='';
      frames++;drawnTime=elapsed;drawCalls=renderer!.info.render.calls;triangles=renderer!.info.render.triangles;
      publishDiagnostics();
    };
    const size=()=>{
      if(disposed||failed||!visible)return false;
      const {width,height}=host.getBoundingClientRect();if(!width||!height)return false;
      // DPR and total pixels are bounded independently of viewport or session type.
      const ratio=options.exportSize ? options.exportSize.width/width : Math.min(devicePixelRatio||1,1.5,Math.sqrt(850000/(width*height)))*quality;
      sizePending=false;
      if(width===widthBefore&&height===heightBefore&&ratio===ratioBefore)return false;
      widthBefore=width;heightBefore=height;ratioBefore=ratio;
      renderer!.setPixelRatio(ratio);renderer!.setSize(width,height,false);
      composer!.setPixelRatio(ratio);composer!.setSize(width,height);
      antialias!.uniforms.resolution.value.set(1/(width*ratio),1/(height*ratio));
      camera.aspect=width/height;camera.fov=T.MathUtils.lerp(57,45,T.MathUtils.clamp((camera.aspect-.6)/1.2,0,1));camera.updateProjectionMatrix();
      host.dataset.renderPixels=String(renderer!.domElement.width*renderer!.domElement.height);
      return true;
    };
    const queueSize=()=>{
      sizePending=true;
      if(!visible||playing||stillRaf)return;
      stillRaf=requestAnimationFrame(()=>{
        stillRaf=0;
        if(disposed||failed||!visible||playing)return;
        try{if(size()){draw();publishDiagnostics(true);}}catch{failure();}
      });
    };
    if(!options.exportSize){resize=new ResizeObserver(queueSize);resize.observe(host);}
    renderer.shadowMap.needsUpdate=true;
    // A composed still is rendered even when the user's preference stops autoplay.
    // Export initializes the cached shadow map at the normal loop entrance.
    elapsed=options.autoplay||options.exportSize?0:4500;
    host.dataset.renderState='paused';
    host.dataset.renderQuality=quality.toFixed(2);
    if(visible){size();draw();publishDiagnostics(true);}
    function tick(now:number) {
      if(!playing||disposed||failed)return;
      const delta=last?now-last:0;
      if(last)elapsed=(elapsed+delta)%DURATION;
      last=now;
      // Include frame delivery as well as JS submission cost: software GL can
      // defer work. Average a window so one calendar click cannot lower quality.
      if(costSamples>=30) {
        const cost=frameCost/costSamples,gap=gapSamples?frameGap/gapSamples:FRAME;
        const next=cost>38||gap>50?Math.max(.5,quality*.84):cost<14&&gap<38?Math.min(1,quality/.84):quality;
        frameCost=0;costSamples=0;frameGap=0;gapSamples=0;
        if(next!==quality){quality=next;sizePending=true;host.dataset.renderQuality=quality.toFixed(2);}
      }
      if(now-lastRender>=FRAME-1){
        if(lastRender){frameGap+=now-lastRender;gapSamples++;}
        lastRender=now;
        try{if(sizePending)size();draw();}catch{failure();return;}
      }
      raf=requestAnimationFrame(tick);
    }
    return {
      // Offline export uses exact timestamps, never wall time, RAF or adaptive
      // resolution. Camera, foliage, veils and dust all pass through draw().
      renderAt(milliseconds) {
        if(!options.exportSize)throw new Error('Explicit exportSize required');
        if(!Number.isFinite(milliseconds)||milliseconds<0||milliseconds>DURATION)throw new Error('Timestamp outside workspace loop');
        if(disposed||failed)throw new Error('Workspace export is unavailable');
        elapsed=milliseconds;size();draw();
        renderer!.getContext().finish();
      },
      setPlaying(value) {
        if(options.exportSize&&value)throw new Error('Offline export cannot use realtime playback');
        if(disposed||failed||playing===value)return;
        playing=value;last=0;lastRender=0;
        frameCost=0;costSamples=0;frameGap=0;gapSamples=0;
        host.dataset.renderState=value?'playing':'paused';
        if(value){
          cancelAnimationFrame(stillRaf);stillRaf=0;
          if(!hasPlayed){elapsed=0;hasPlayed=true;if(quality>.65){quality=.65;sizePending=true;host.dataset.renderQuality=quality.toFixed(2);}}
          raf=requestAnimationFrame(tick);
        }
        else {cancelAnimationFrame(raf);publishDiagnostics(true);}
      },
      setVisible(value) {
        if(disposed||failed||visible===value)return;
        visible=value;
        if(value)queueSize();else {cancelAnimationFrame(stillRaf);stillRaf=0;}
      },
      dispose() {if(disposed)return;disposed=true;if(!failed)disposeResources();delete host.dataset.renderState;},
    };
  } catch {failure();return undefined;}
}
