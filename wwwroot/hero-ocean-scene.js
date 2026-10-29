// Applies CloudAI-X skills: scene/Timer lifecycle, GPU vertex displacement and bounded GPU work.
export function createOcean(THREE,host,onContextLost){
  const canvas=document.createElement('canvas');
  canvas.setAttribute('aria-hidden','true');
  const context=canvas.getContext('webgl2',{alpha:true,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:false});
  if(!context)return null;
  let renderer,timer,waterGeometry,waterMaterial,observer;
  const listeners=new AbortController();
  let disposed=false,running=false,elapsed=0,lastRender=-Infinity;
  let pointerX=0,pointerY=0;
  function dispose(){
    if(disposed)return;disposed=true;
    renderer?.setAnimationLoop(null);observer?.disconnect();listeners.abort();timer?.dispose();
    waterGeometry?.dispose();waterMaterial?.dispose();
    renderer?.dispose();renderer?.forceContextLoss();canvas.remove();
  }
  try{
    renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:false,powerPreference:'low-power'});
    let shaderFailed=false;
    renderer.debug.onShaderError=()=>{if(!shaderFailed){shaderFailed=true;queueMicrotask(onContextLost)}};
    renderer.setClearColor(0x000000,0);
    renderer.toneMapping=THREE.NoToneMapping;
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(46,1,0.1,60);
    camera.position.set(0,4.2,8.5);camera.lookAt(0,-0.9,-3);
    const mobile=matchMedia('(max-width:680px)').matches;
    const uniforms={time:{value:0},sea:{value:new THREE.Color('#6fa99e')},deep:{value:new THREE.Color('#163d37')},gold:{value:new THREE.Color('#e9bd6a')}};
    waterGeometry=new THREE.PlaneGeometry(32,22,mobile?64:112,mobile?40:64);
    waterMaterial=new THREE.ShaderMaterial({
      uniforms,transparent:true,depthWrite:false,side:THREE.FrontSide,
      vertexShader:`
        uniform float time;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying float vHeight;
        void main(){
          vUv=uv;
          float a=position.x*0.62+position.y*0.37+time*0.55;
          float b=position.x*1.2-position.y*0.74-time*0.72;
          float c=position.x*2.3+position.y*1.4+time*0.9;
          float h=sin(a)*0.19+sin(b)*0.075+sin(c)*0.022;
          float dx=cos(a)*0.1178+cos(b)*0.09+cos(c)*0.0506;
          float dy=cos(a)*0.0703-cos(b)*0.0555+cos(c)*0.0308;
          vec3 p=vec3(position.xy,h);
          vHeight=h;
          vNormal=normalize(mat3(modelMatrix)*vec3(-dx,-dy,1.0));
          vec4 world=modelMatrix*vec4(p,1.0);
          vWorld=world.xyz;
          gl_Position=projectionMatrix*viewMatrix*world;
        }
      `,
      fragmentShader:`
        uniform float time;
        uniform vec3 sea;
        uniform vec3 deep;
        uniform vec3 gold;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying float vHeight;
        void main(){
          vec3 n=normalize(vNormal);
          vec3 eye=normalize(cameraPosition-vWorld);
          float fresnel=pow(1.0-max(dot(n,eye),0.0),2.0);
          float light=max(dot(n,normalize(vec3(0.4,1.0,0.6))),0.0);
          float crest=smoothstep(0.13,0.26,vHeight);
          float glint=pow(max(dot(reflect(-normalize(vec3(0.6,1.0,-0.5)),n),eye),0.0),30.0);
          float ripples=pow(0.5+0.5*sin(vWorld.x*2.0+vWorld.z*3.2+time*0.8),9.0);
          float ribbon=pow(0.5+0.5*sin(vWorld.z*2.1+sin(vWorld.x*0.35+time*0.2)*0.8+time*0.5),26.0);
          float sunPath=exp(-pow((vWorld.x-4.0)*0.16,2.0));
          vec3 color=mix(deep,sea,0.36+fresnel*0.35+light*0.15);
          color+=sea*crest*0.2+gold*(glint*0.55+ripples*crest*0.10)+mix(sea,gold,sunPath*0.75)*ribbon*0.75;
          float edge=smoothstep(0.0,0.14,vUv.x)*(1.0-smoothstep(0.86,1.0,vUv.x));
          float fade=smoothstep(0.0,0.15,vUv.y)*(1.0-smoothstep(0.5,0.95,vUv.y));
          // Only the moving wave crests are visible, with no flat tint over the photo.
          gl_FragColor=vec4(color,edge*fade*(crest*0.06+ribbon*0.12));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `
    });
    const water=new THREE.Mesh(waterGeometry,waterMaterial);
    water.rotation.x=-Math.PI/2;water.position.set(0,-1.3,-4);
    water.frustumCulled=false; // GPU displacement is outside the CPU plane's original bounds.
    scene.add(water);
    timer=new THREE.Timer();timer.connect(document);
    const target=new THREE.Vector3(0,-0.9,-3);
    function resize(){
      const width=Math.max(host.clientWidth,1),height=Math.max(host.clientHeight,1);
      renderer.setPixelRatio(Math.min(devicePixelRatio||1,mobile?1:1.5));
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    }
    function frame(timestamp){
      if(disposed||!running)return;
      timer.update();elapsed+=Math.min(timer.getDelta(),0.05);
      if(timestamp-lastRender<1000/30)return;
      lastRender=timestamp;
      uniforms.time.value=elapsed;
      camera.position.x+=(pointerX*0.18-camera.position.x)*0.04;
      camera.position.y+=(4.2+pointerY*0.09-camera.position.y)*0.04;
      camera.lookAt(target);
      try{renderer.render(scene,camera)}catch{onContextLost();return}
      host.classList.add('is-ready');
    }
    function setRunning(value){
      if(disposed||running===value)return;
      running=value;
      if(value){timer.update();lastRender=-Infinity;renderer.setAnimationLoop(frame)}
      else renderer.setAnimationLoop(null);
    }
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();onContextLost()},{signal:listeners.signal});
    observer=new ResizeObserver(resize);observer.observe(host);resize();host.append(canvas);
    const hero=host.parentElement;
    hero.addEventListener('pointermove',event=>{
      if(event.pointerType!=='mouse')return;
      const bounds=hero.getBoundingClientRect();pointerX=(event.clientX-bounds.left)/bounds.width-0.5;pointerY=(event.clientY-bounds.top)/bounds.height-0.5;
    },{passive:true,signal:listeners.signal});
    hero.addEventListener('pointerleave',()=>{pointerX=0;pointerY=0},{signal:listeners.signal});
    return {setRunning,dispose};
  }catch(error){dispose();throw error}
}
