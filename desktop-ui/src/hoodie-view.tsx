import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import hoodieUrl from './assets/garments/hoodie.glb?url';

type Block = {color:number[];runs:number[][][]};
type Props = {angle:number;color:string;blocks:Block[];placement:number;xMm:number;yMm:number;sizeRatio:number;zoom:number;onUnavailable:()=>void};

const textureBounds = {left:-.30,bottom:.67,width:.60,height:.78};

function paintThreads(context:CanvasRenderingContext2D, props:Props) {
  const dimension=context.canvas.width;
  const units=1/(1000*props.sizeRatio);
  const x=0;
  const y=1.205;
  context.setTransform(1,0,0,1,0,0);
  context.clearRect(0,0,dimension,dimension);
  context.translate(
    (x-textureBounds.left)*dimension/textureBounds.width,
    (textureBounds.bottom+textureBounds.height-y)*dimension/textureBounds.height,
  );
  context.scale(units*dimension/textureBounds.width,units*dimension/textureBounds.height);
  context.lineCap='round';
  context.lineJoin='round';
  for(const block of props.blocks) {
    context.beginPath();
    for(const run of block.runs) {
      if(run.length<2)continue;
      context.moveTo(run[0][0],run[0][1]);
      for(let i=1;i<run.length;i++)context.lineTo(run[i][0],run[i][1]);
    }
    context.save();context.translate(.13,.18);
    context.lineWidth=.74;
    context.strokeStyle='#1a111f71';
    context.stroke();context.restore();
    context.lineWidth=.48;
    context.strokeStyle=`rgb(${block.color.join(',')})`;
    context.stroke();
    // Batch directional highlights into four paths rather than drawing each stitch separately.
    const highlights=Array.from({length:4},()=>new Path2D());
    for(const run of block.runs)for(let i=1;i<run.length;i++){
      const a=run[i-1],b=run[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.1)continue;
      const p=highlights[Math.min(3,Math.floor(Math.abs(dx/len)*4))];p.moveTo(a[0],a[1]-.10);p.lineTo(b[0],b[1]-.10);
    }
    context.lineWidth=.14;highlights.forEach((p,i)=>{context.strokeStyle=`rgba(255,255,255,${.12+i*.09})`;context.stroke(p)});
  }
}

function applyThreadMap(material:THREE.MeshStandardMaterial, texture:THREE.CanvasTexture) {
  material.onBeforeCompile=shader=>{
    shader.uniforms.threadMap={value:texture};
    shader.uniforms.threadOffset={value:texture.offset};
    shader.vertexShader='varying vec3 vHoodiePosition;\nvarying float vHoodieFront;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvHoodiePosition = position; vHoodieFront = normal.z;');
    shader.fragmentShader='uniform sampler2D threadMap;\nuniform vec2 threadOffset;\nvarying vec3 vHoodiePosition;\nvarying float vHoodieFront;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #include <map_fragment>
      if (vHoodiePosition.z > 0.115 && vHoodieFront > 0.14 && abs(vHoodiePosition.x) < 0.24) {
        vec2 threadUV = (vHoodiePosition.xy - vec2(${textureBounds.left}, ${textureBounds.bottom})) / vec2(${textureBounds.width}, ${textureBounds.height}) - threadOffset;
        if (all(greaterThanEqual(threadUV, vec2(0.0))) && all(lessThanEqual(threadUV, vec2(1.0)))) {
          vec4 overlay = texture2D(threadMap, threadUV);
          diffuseColor.rgb = mix(diffuseColor.rgb, overlay.rgb, overlay.a);
          // Subtle yarn relief follows the stitched texture without extra geometry.
          float edge = texture2D(threadMap, threadUV + vec2(0.0007,0.0007)).a - overlay.a;
          diffuseColor.rgb *= 1.0 + clamp(edge * 0.18, -0.10, 0.12);
        }
      }
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      if (vHoodiePosition.z > 0.115 && vHoodieFront > 0.14 && abs(vHoodiePosition.x) < 0.24) {
        vec2 uvThread = (vHoodiePosition.xy - vec2(${textureBounds.left}, ${textureBounds.bottom})) / vec2(${textureBounds.width}, ${textureBounds.height}) - threadOffset;
        if (all(greaterThanEqual(uvThread, vec2(0.0))) && all(lessThanEqual(uvThread, vec2(1.0)))) {
          float coverage = texture2D(threadMap, uvThread).a;
          roughnessFactor = mix(roughnessFactor, 0.46, coverage);
        }
      }
    `);
  };
}

function disposeModel(scene:THREE.Object3D) {
  const materials=new Set<THREE.MeshStandardMaterial>();
  const textures=new Set<THREE.Texture>();
  const geometries=new Set<THREE.BufferGeometry>();
  scene.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    geometries.add(node.geometry);
    for(const material of Array.isArray(node.material)?node.material:[node.material]){
      if(material instanceof THREE.MeshStandardMaterial)materials.add(material);
    }
  });
  for(const material of materials){
    for(const texture of [material.map,material.roughnessMap,material.metalnessMap]){
      if(texture)textures.add(texture);
    }
    material.dispose();
  }
  for(const texture of textures)texture.dispose();
  for(const geometry of geometries)geometry.dispose();
}

export default function HoodieView(props:Props) {
  const host=useRef<HTMLDivElement>(null);
  const latest=useRef(props);
  latest.current=props;
  const draw=useRef<((props:Props)=>void)|null>(null);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    const element=host.current;
    if(!element)return;
    const stitchCanvas=document.createElement('canvas');
    stitchCanvas.width=stitchCanvas.height=2048;
    const threadContext=stitchCanvas.getContext('2d');
    let renderer:THREE.WebGLRenderer;
    try {
      if(!threadContext)throw Error('Canvas unavailable');
      renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
    } catch {
      latest.current.onUnavailable();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    renderer.domElement.setAttribute('aria-hidden','true');
    element.appendChild(renderer.domElement);

    const scene=new THREE.Scene();
    const pivot=new THREE.Group();
    scene.add(pivot,new THREE.HemisphereLight(0xfff1e9,0xb9acd2,2.05));
    const key=new THREE.DirectionalLight(0xfff5ee,2.35);
    key.position.set(1.4,2.5,3);
    scene.add(key);
    const fill=new THREE.DirectionalLight(0xd8defb,1.0);
    fill.position.set(-2,0,2);
    scene.add(fill);
    const rim=new THREE.DirectionalLight(0xffffff,1.1);
    rim.position.set(1,2,-2);scene.add(rim);
    const camera=new THREE.PerspectiveCamera(30,1,.05,20);
    camera.position.set(0,.025,1.88);
    camera.lookAt(0,0,0);
    const texture=new THREE.CanvasTexture(stitchCanvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
    let active=true;
    let frame=0;let lastWidth=0,lastHeight=0;
    let previous:Props|undefined;
    let fabric:THREE.MeshStandardMaterial|undefined;

    function render() {
      const {clientWidth,clientHeight}=element!;
      if(clientWidth<1||clientHeight<1)return;
      if(lastWidth!==clientWidth||lastHeight!==clientHeight){renderer.setSize(clientWidth,clientHeight,false);camera.aspect=clientWidth/clientHeight;camera.updateProjectionMatrix();lastWidth=clientWidth;lastHeight=clientHeight;}
      renderer.render(scene,camera);
    }
    const observer=new ResizeObserver(render);
    observer.observe(element);
    const contextLost=(event:Event)=>{event.preventDefault();if(active)latest.current.onUnavailable();};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    const loader=new GLTFLoader();
    void loader.loadAsync(hoodieUrl).then(model=>{
      if(!active){disposeModel(model.scene);return;}
      model.scene.traverse(node=>{
        if(node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial
          && node.material.name==='Tintable fabric')fabric=node.material;
      });
      if(!fabric){disposeModel(model.scene);latest.current.onUnavailable();return;}
      applyThreadMap(fabric,texture);
      model.scene.position.set(0,-1.054,-.129);
      pivot.add(model.scene);
      draw.current=next=>{
        if(!previous||previous.blocks!==next.blocks||previous.sizeRatio!==next.sizeRatio){
          paintThreads(threadContext!,next);
          texture.needsUpdate=true;
        }
        previous=next;
        const units=1/(1000*next.sizeRatio);
        texture.offset.set((([.108,-.108,0][next.placement]??0)+next.xMm*units)/textureBounds.width,((next.placement===2?1.098:1.205)-1.205-next.yMm*units)/textureBounds.height);
        camera.zoom=next.zoom;camera.updateProjectionMatrix();
        fabric!.color.set(next.color);
        pivot.rotation.y=THREE.MathUtils.degToRad(next.angle);
        cancelAnimationFrame(frame);frame=requestAnimationFrame(render);
      };
      draw.current(latest.current);
      setLoaded(true);
    }).catch(()=>{if(active)latest.current.onUnavailable();});

    return ()=>{
      active=false;
      cancelAnimationFrame(frame);
      draw.current=null;
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      disposeModel(scene);
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  },[]);
  useEffect(()=>{draw.current?.(props);},[props]);

  return <div className="hoodie-view" ref={host} aria-busy={!loaded} role="img" aria-label="Rotatable 3D hoodie with the current design">
    {!loaded&&<p role="status">Loading hoodie…</p>}
  </div>;
}
