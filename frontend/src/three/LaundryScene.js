import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class LaundryScene {
  constructor(container, onSelectMachine) {
    this.container = container;
    this.onSelectMachine = onSelectMachine;
    this.machineMeshes = new Map(); // hwid -> Group
    this.activeWashers = []; // running washer vortexes to rotate
    this.activeDryers = []; // running dryer drums to rotate
    this.steamParticles = []; // steam puffs for running dryers
    this.idleMachines = []; // available idle machines to shimmer with green ambient glow
    this.floorGroups = new Map();
    this.hoveredMesh = null;

    this.floorConfig = [
      { name: '2F', y: 0 },
      { name: '4F', y: 7.5 },
      { name: '6F', y: 15.0 },
      { name: '8F', y: 22.5 }
    ];

    // Default to a high-angle bird's-eye 3D perspective to overlook all floors (2F~8F) and timers with full headroom
    this.targetCameraPos = new THREE.Vector3(18.0, 30.0, 42.0);
    this.targetLookAt = new THREE.Vector3(0, 11.5, 0);
    this.isAnimatingCamera = true;

    this.init();
    this.buildEnvironment();
    this.buildFloors();
    this.setupEvents();
    this.animate();
  }

  init() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1d);
    this.scene.fog = new THREE.FogExp2(0x0a0f1d, 0.012);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 200);
    this.camera.position.copy(this.targetCameraPos);

    // High Efficiency Energy-Optimized Renderer (Caps fillrate on 4K/Retina to save fan noise)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // Lightweight PCF instead of heavy PCFSoft
    this.renderer.shadowMap.autoUpdate = false; // Freeze shadows! Do NOT recalculate every frame!
    this.renderer.shadowMap.needsUpdate = true; // Render shadows once at start
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.copy(this.targetLookAt);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 65;

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.lastFrameTime = performance.now();

    // Shared reusable geometry for outer neon contour edge lines (ZERO extra geometry alloc per machine)
    const boxGeo = new THREE.BoxGeometry(1.63, 2.03, 1.63);
    this.sharedEdgeGeo = new THREE.EdgesGeometry(boxGeo);

    // Shared reusable ground radial aura texture (128x128 canvas, generated once)
    const baseGlowCanvas = document.createElement('canvas');
    baseGlowCanvas.width = 128;
    baseGlowCanvas.height = 128;
    const bCtx = baseGlowCanvas.getContext('2d');
    const radGrad = bCtx.createRadialGradient(64, 64, 15, 64, 64, 62);
    radGrad.addColorStop(0, 'rgba(74, 222, 128, 0.85)'); // Radiant emerald green
    radGrad.addColorStop(0.45, 'rgba(34, 197, 94, 0.45)');
    radGrad.addColorStop(0.8, 'rgba(16, 185, 129, 0.15)');
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    bCtx.fillStyle = radGrad;
    bCtx.fillRect(0, 0, 128, 128);
    this.sharedBaseGlowTex = new THREE.CanvasTexture(baseGlowCanvas);
    this.sharedBaseGlowGeo = new THREE.PlaneGeometry(2.4, 2.4);
  }

  buildEnvironment() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xddeeff, 1.3);
    dirLight.position.set(25, 40, 25);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024; // 1024x1024 is sharp and uses 75% less memory than 2048
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 85;
    dirLight.shadow.camera.left = -22;
    dirLight.shadow.camera.right = 22;
    dirLight.shadow.camera.top = 35;
    dirLight.shadow.camera.bottom = -15;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    fillLight.position.set(-25, 20, -20);
    this.scene.add(fillLight);

    const gridHelper = new THREE.GridHelper(60, 30, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -1.2;
    this.scene.add(gridHelper);

    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x070b14,
      roughness: 0.9,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.21;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  createTextTexture(text, bgColor = '#0f172a', borderColor = '#38bdf8') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 244, 116);

    ctx.font = 'bold 64px sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 64);

    return new THREE.CanvasTexture(canvas);
  }

  createFloorSignSprite(floorName) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');

    // Rounded glowing glass card background
    ctx.fillStyle = 'rgba(10, 15, 29, 0.92)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 124, 28);
    ctx.fill();

    // High luminance cyan border
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Floor text
    ctx.font = 'bold 72px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(floorName, 128, 56);

    // Subtitle
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('聯苑二期', 128, 104);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.6, 1.95, 1);
    return sprite;
  }

  buildFloors() {
    const slabGeo = new THREE.BoxGeometry(21, 0.4, 7.5);
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.3,
      metalness: 0.15
    });

    const edgeGeo = new THREE.EdgesGeometry(slabGeo);
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4 });

    const wallGeo = new THREE.BoxGeometry(21, 3.2, 0.3);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.6,
      metalness: 0.2
    });

    for (const floor of this.floorConfig) {
      const floorGroup = new THREE.Group();
      floorGroup.position.y = floor.y;

      // Slab
      const slab = new THREE.Mesh(slabGeo, slabMat);
      slab.receiveShadow = true;
      floorGroup.add(slab);

      // Edge Outline
      const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
      floorGroup.add(edgeLines);

      // Back Wall
      const backWall = new THREE.Mesh(wallGeo, wallMat);
      backWall.position.set(0, 1.6, -2.5);
      backWall.receiveShadow = true;
      floorGroup.add(backWall);

      // Right Entrance Arch Wall
      const doorArchGeo = new THREE.BoxGeometry(0.3, 3.2, 3.0);
      const doorArchMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5 });
      const rightWall = new THREE.Mesh(doorArchGeo, doorArchMat);
      rightWall.position.set(10.4, 1.6, -1.0);
      floorGroup.add(rightWall);

      // Dynamic Camera-Facing Billboard Floor Sign (Outside left slab at x=-11.8)
      const floorSignSprite = this.createFloorSignSprite(floor.name);
      floorSignSprite.position.set(-11.8, 1.8, 0.5);
      floorGroup.add(floorSignSprite);

      // Pillars
      if (floor.name !== '2F') {
        const pillarGeo = new THREE.CylinderGeometry(0.15, 0.15, 7.1, 16);
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5 });
        const corners = [
          [-10.2, 3.4],
          [10.2, 3.4],
          [-10.2, -3.4],
          [10.2, -3.4]
        ];
        for (const [cx, cz] of corners) {
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.set(cx, -3.75, cz);
          pillar.castShadow = true;
          floorGroup.add(pillar);
        }
      }

      this.scene.add(floorGroup);
      this.floorGroups.set(floor.name, floorGroup);
    }
  }

  createBadgeTexture(text, isDryer) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = isDryer ? '#334155' : '#0369a1';
    ctx.fillRect(0, 0, 128, 64);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(3, 3, 122, 58);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 32);

    return new THREE.CanvasTexture(canvas);
  }

  // 1. TOP-LOADING WASHER (直立式洗衣機 - 上掀蓋、波輪水流盤、斜背控制台)
  createTopLoadWasher(device, labelShort) {
    const group = new THREE.Group();
    group.userData = { device, hwid: device.hwid, labelShort, isDryer: false };

    // Cabinet Body (Translucent when running, solid white when idle)
    const bodyGeo = new THREE.BoxGeometry(1.6, 2.0, 1.6);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.1,
      transparent: false,
      opacity: 1.0,
      emissive: 0x000000,
      emissiveIntensity: 0.0,
      clearcoat: 0.4
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    body.receiveShadow = true;
    body.renderOrder = 2; // Renders after water so transparent yellow shell overlays cleanly!
    group.add(body);
    group.userData.bodyMesh = body;
    group.userData.bodyMat = bodyMat;

    // Outer Green Neon Contour Edges (環繞整個外殼的綠光輪廓線)
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const glowEdges = new THREE.LineSegments(this.sharedEdgeGeo, edgeMat);
    glowEdges.position.y = 1.0;
    glowEdges.visible = false;
    group.add(glowEdges);
    group.userData.glowEdges = glowEdges;
    group.userData.edgeMat = edgeMat;

    // Ground Radiant Aura (底座環繞地面綠光光暈)
    const baseGlowMat = new THREE.MeshBasicMaterial({
      map: this.sharedBaseGlowTex,
      transparent: true,
      opacity: 0.80,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const baseGlow = new THREE.Mesh(this.sharedBaseGlowGeo, baseGlowMat);
    baseGlow.rotation.x = -Math.PI / 2;
    baseGlow.position.y = 0.03;
    baseGlow.visible = false;
    group.add(baseGlow);
    group.userData.baseGlow = baseGlow;
    group.userData.baseGlowMat = baseGlowMat;

    // Angled Top Rear Console (斜背控制面板)
    const consoleGeo = new THREE.BoxGeometry(1.58, 0.32, 0.45);
    const consoleMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.6, roughness: 0.3 });
    const topConsole = new THREE.Mesh(consoleGeo, consoleMat);
    topConsole.position.set(0, 2.12, -0.55);
    topConsole.rotation.x = -0.32;
    group.add(topConsole);

    // Console Display Screen & Buttons
    const consoleScreenMat = new THREE.MeshBasicMaterial({ color: 0x0284c7 });
    const consoleScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), consoleScreenMat);
    consoleScreen.position.set(0, 2.15, -0.42);
    consoleScreen.rotation.x = -0.32;
    group.add(consoleScreen);
    group.userData.consoleScreenMat = consoleScreenMat;

    // Top Viewing Lid (透明上掀蓋)
    const lidGeo = new THREE.BoxGeometry(1.22, 0.04, 1.05);
    const lidMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.2,
      clearcoat: 0.8
    });
    const topLid = new THREE.Mesh(lidGeo, lidMat);
    topLid.position.set(0, 2.02, 0.15);
    group.add(topLid);
    group.userData.lidMat = lidMat;

    // --- Dynamic Blue Water Swirling Group Inside (運作時內部藍色水漩渦與水流) ---
    const waterGroup = new THREE.Group();
    waterGroup.position.set(0, 0.95, 0.05);
    waterGroup.visible = false; // 待機時隱藏，100% 杜絕閃爍

    // Top Chrome Rim Collar (位於頂部邊緣，絕不遮擋側面藍色水體)
    const rimGeo = new THREE.RingGeometry(0.56, 0.70, 32);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.85,
      roughness: 0.2,
      side: THREE.DoubleSide
    });
    const topRim = new THREE.Mesh(rimGeo, rimMat);
    topRim.rotation.x = -Math.PI / 2;
    topRim.position.y = 0.72;
    waterGroup.add(topRim);

    // Churning Radiant Ocean-Blue Water Volume (充盈整個機身內部，明亮純淨湛藍)
    const waterGeo = new THREE.CylinderGeometry(0.68, 0.64, 1.42, 28);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x0284c7,
      emissiveIntensity: 0.95, // 明亮湛藍自發光，絕不被暗色遮擋
      transparent: true,
      opacity: 0.92,
      roughness: 0.1,
      metalness: 0.15
    });
    const waterCylinder = new THREE.Mesh(waterGeo, waterMat);
    waterGroup.add(waterCylinder);

    // Swirling Cyan Water Foam Surface Disc
    const vortexGeo = new THREE.CircleGeometry(0.66, 28);
    const vortexMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });
    const vortexDisc = new THREE.Mesh(vortexGeo, vortexMat);
    vortexDisc.rotation.x = -Math.PI / 2;
    vortexDisc.position.y = 0.71;
    waterGroup.add(vortexDisc);

    // 4 Swirling White Foam Spray Fins
    for (let f = 0; f < 4; f++) {
      const foamFin = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 0.05, 0.03),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      foamFin.rotation.y = (f * Math.PI) / 2;
      foamFin.position.y = 0.72;
      waterGroup.add(foamFin);
    }

    group.add(waterGroup);
    group.userData.waterGroup = waterGroup;
    group.userData.waterMat = waterMat;

    // Front Recessed Handle
    const handleLine = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.05, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8 })
    );
    handleLine.position.set(0, 1.82, 0.81);
    group.add(handleLine);

    // Front Nameplate Badge
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.4),
      new THREE.MeshBasicMaterial({ map: this.createBadgeTexture(labelShort, false), side: THREE.DoubleSide })
    );
    badge.position.set(0, 1.45, 0.81);
    group.add(badge);

    // Status Halo
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 12, 32), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 2.05, 0);
    group.add(halo);
    group.userData.haloMat = haloMat;

    // Point Light (Idle is hidden to save fragment shader passes, turned on only when running)
    const pointLight = new THREE.PointLight(0xfacc15, 0, 4);
    pointLight.position.set(0, 2.3, 0);
    pointLight.visible = false;
    group.add(pointLight);
    group.userData.pointLight = pointLight;

    // 3D Timer Sprite (Elevated in front at z = 0.35, y = 3.20)
    this.attachTimerSprite(group);

    return group;
  }

  // 2. FRONT-LOADING DRUM DRYER (滾筒烘衣機 - 不銹鋼質感滾筒、自然翻滾衣物、後側冒煙防擋倒數)
  createFrontLoadDryer(device, labelShort) {
    const group = new THREE.Group();
    group.userData = { device, hwid: device.hwid, labelShort, isDryer: true };

    // Cabinet Body (White)
    const bodyGeo = new THREE.BoxGeometry(1.6, 2.0, 1.6);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.2,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    group.userData.bodyMesh = body;
    group.userData.bodyMat = bodyMat;

    // Outer Green Neon Contour Edges (環繞整個外殼的綠光輪廓線)
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const glowEdges = new THREE.LineSegments(this.sharedEdgeGeo, edgeMat);
    glowEdges.position.y = 1.0;
    glowEdges.visible = false;
    group.add(glowEdges);
    group.userData.glowEdges = glowEdges;
    group.userData.edgeMat = edgeMat;

    // Ground Radiant Aura (底座環繞地面綠光光暈)
    const baseGlowMat = new THREE.MeshBasicMaterial({
      map: this.sharedBaseGlowTex,
      transparent: true,
      opacity: 0.80,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const baseGlow = new THREE.Mesh(this.sharedBaseGlowGeo, baseGlowMat);
    baseGlow.rotation.x = -Math.PI / 2;
    baseGlow.position.y = 0.03;
    baseGlow.visible = false;
    group.add(baseGlow);
    group.userData.baseGlow = baseGlow;
    group.userData.baseGlowMat = baseGlowMat;

    // Rear Exhaust Pipe (後置金屬排氣口，後退至 z = -0.65，不遮擋前方倒數計時)
    const ventGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16);
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
    const vent = new THREE.Mesh(ventGeo, ventMat);
    vent.position.set(0.45, 2.06, -0.65);
    group.add(vent);

    // Door Chrome Bezel Ring
    const doorRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.07, 16, 32),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.15 })
    );
    doorRing.position.set(0, 0.95, 0.82);
    group.add(doorRing);

    // Front Glass Window
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.75, // 待機時深色煙燻玻璃
      roughness: 0.1,
      metalness: 0.2,
      clearcoat: 0.9
    });
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.52, 32), glassMat);
    glass.position.set(0, 0.95, 0.83);
    group.add(glass);
    group.userData.glassMat = glassMat;

    // --- High-Performance Realistic Stainless Drum ---
    const drumGroup = new THREE.Group();
    drumGroup.position.set(0, 0.95, 0.79);
    drumGroup.visible = false; // 待機時完全隱藏內部，100% 杜絕閃爍

    // Drum Base: Industrial Stainless Steel Finish
    const drumBack = new THREE.Mesh(
      new THREE.CircleGeometry(0.49, 32),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 })
    );
    drumGroup.add(drumBack);

    // Radial perforated air ring (細緻工業風散熱孔環)
    const perfRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.44, 24),
      new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    perfRing.position.z = 0.005;
    drumGroup.add(perfRing);

    // 3 Sleek Metallic Lifting Ribs (3 條金屬提升筋，均勻分佈)
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
    for (let b = 0; b < 3; b++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.09, 0.02), ribMat);
      rib.rotation.z = (b * Math.PI) / 3;
      rib.position.z = 0.01;
      drumGroup.add(rib);
    }

    group.add(drumGroup);
    group.userData.drum = drumGroup;

    // Drum Interior Heating Light (運轉時亮起溫暖紅熱烘乾光)
    const drumLight = new THREE.PointLight(0xff4422, 0, 3);
    drumLight.position.set(0, 0.95, 0.75);
    group.add(drumLight);
    group.userData.drumLight = drumLight;

    // Front Nameplate Badge
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.4),
      new THREE.MeshBasicMaterial({ map: this.createBadgeTexture(labelShort, true), side: THREE.DoubleSide })
    );
    badge.position.set(0, 1.75, 0.82);
    group.add(badge);

    // Status Halo
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 12, 32), haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 2.05, 0);
    group.add(halo);
    group.userData.haloMat = haloMat;

    // Point Light (Idle is hidden to save fragment shader passes, turned on only when running)
    const pointLight = new THREE.PointLight(0xef4444, 0, 4);
    pointLight.position.set(0, 2.3, 0);
    pointLight.visible = false;
    group.add(pointLight);
    group.userData.pointLight = pointLight;

    // Steam Emitter on Rear-Right Vent (煙霧向上並向後方飄散，絕不遮擋前方倒數看板)
    const steamGroup = new THREE.Group();
    steamGroup.position.set(0.45, 2.12, -0.65);
    const steamPuffs = [];
    const puffGeo = new THREE.SphereGeometry(0.12, 8, 8);
    for (let p = 0; p < 14; p++) {
      const puffMat = new THREE.MeshBasicMaterial({
        color: 0xf8fafc,
        transparent: true,
        opacity: 0.0
      });
      const puff = new THREE.Mesh(puffGeo, puffMat);
      puff.position.set((Math.random() - 0.5) * 0.15, Math.random() * 0.8, (Math.random() - 0.5) * 0.15);
      steamGroup.add(puff);
      steamPuffs.push({
        mesh: puff,
        mat: puffMat,
        speedY: 0.018 + Math.random() * 0.024,
        initX: (Math.random() - 0.5) * 0.12,
        initZ: (Math.random() - 0.5) * 0.12,
        lifetime: Math.random()
      });
    }
    group.add(steamGroup);
    group.userData.steamPuffs = steamPuffs;

    // 3D Timer Sprite (Elevated in front at z = 0.35, y = 3.20)
    this.attachTimerSprite(group);

    return group;
  }

  attachTimerSprite(group) {
    const timerCanvas = document.createElement('canvas');
    timerCanvas.width = 256;
    timerCanvas.height = 76;
    const timerTexture = new THREE.CanvasTexture(timerCanvas);
    const spriteMat = new THREE.SpriteMaterial({ map: timerTexture, transparent: true, depthTest: false });
    const timerSprite = new THREE.Sprite(spriteMat);
    // Positioned safely in front and higher up so steam behind never blocks it!
    timerSprite.position.set(0, 3.20, 0.35);
    timerSprite.scale.set(2.5, 0.75, 1);
    timerSprite.renderOrder = 9999;
    timerSprite.visible = false;
    group.add(timerSprite);

    group.userData.timerCanvas = timerCanvas;
    group.userData.timerTexture = timerTexture;
    group.userData.timerSprite = timerSprite;
  }

  updateTimerSprite(mesh, remainingSec, isDryer) {
    const { timerCanvas, timerTexture, timerSprite } = mesh.userData;
    if (!timerCanvas || !timerTexture || !timerSprite) return;

    if (remainingSec <= 0) {
      timerSprite.visible = false;
      return;
    }

    timerSprite.visible = true;
    const ctx = timerCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 76);

    const borderColor = isDryer ? '#ef4444' : '#facc15';
    const textColor = isDryer ? '#fca5a5' : '#fef08a';

    // Pill background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.beginPath();
    ctx.roundRect(6, 6, 244, 64, 32);
    ctx.fill();

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 5;
    ctx.stroke();

    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    const timeText = `⏳ ${m}分${s < 10 ? '0' : ''}${s}秒`;

    ctx.font = 'bold 34px monospace';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeText, 128, 38);

    timerTexture.needsUpdate = true;
  }

  populateMachines(devices) {
    for (const [hwid, mesh] of this.machineMeshes.entries()) {
      mesh.parent?.remove(mesh);
    }
    this.machineMeshes.clear();
    this.activeWashers = [];
    this.activeDryers = [];
    this.steamParticles = [];

    // Order from Right (+X) to Left (-X):
    // +6.0: 洗1, +3.6: 洗2, +1.2: 洗3, -1.2: 烘1, -3.6: 烘2, -6.0: 洗4
    const slotX = [6.0, 3.6, 1.2, -1.2, -3.6, -6.0];

    const floorDevices = { '2F': [], '4F': [], '6F': [], '8F': [] };
    for (const dev of devices) {
      if (floorDevices[dev.floor]) {
        floorDevices[dev.floor].push(dev);
      }
    }

    for (const [floorName, devs] of Object.entries(floorDevices)) {
      const floorGroup = this.floorGroups.get(floorName);
      if (!floorGroup) continue;

      const w1 = devs.find((d) => d.type === 'washer' && (d.num === 1 || d.description.includes('1號')));
      const w2 = devs.find((d) => d.type === 'washer' && (d.num === 2 || d.description.includes('2號')));
      const w3 = devs.find((d) => d.type === 'washer' && (d.num === 3 || d.description.includes('3號')));
      const d1 = devs.find((d) => d.type === 'dryer' && (d.num === 1 || d.description.includes('1號')));
      const d2 = devs.find((d) => d.type === 'dryer' && (d.num === 2 || d.description.includes('2號')));
      const w4 = devs.find((d) => d.type === 'washer' && (d.num === 4 || d.description.includes('4號')));

      const orderedSlots = [
        { dev: w1, label: '洗1', isDryer: false },
        { dev: w2, label: '洗2', isDryer: false },
        { dev: w3, label: '洗3', isDryer: false },
        { dev: d1, label: '烘1', isDryer: true },
        { dev: d2, label: '烘2', isDryer: true },
        { dev: w4, label: '洗4', isDryer: false }
      ];

      orderedSlots.forEach((slot, idx) => {
        if (!slot.dev) return;
        const mesh = slot.isDryer
          ? this.createFrontLoadDryer(slot.dev, slot.label)
          : this.createTopLoadWasher(slot.dev, slot.label);

        const xPos = slotX[idx];
        mesh.position.set(xPos, 0.2, -0.6);
        mesh.rotation.y = 0;
        floorGroup.add(mesh);
        this.machineMeshes.set(slot.dev.hwid, mesh);
      });
    }

    // Freeze shadows: bake static shadows once on populate, never recalculate per frame!
    if (this.renderer?.shadowMap?.enabled) {
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.updateMachineStatus(devices);
  }

  updateMachineStatus(devices) {
    this.activeWashers = [];
    this.activeDryers = [];
    this.steamParticles = [];
    this.idleMachines = [];

    const now = Date.now();

    for (const dev of devices) {
      const mesh = this.machineMeshes.get(dev.hwid);
      if (!mesh) continue;

      mesh.userData.device = dev;
      const { bodyMat, haloMat, pointLight, agitator, drum, timerSprite, steamPuffs, isDryer, glowEdges, baseGlow } = mesh.userData;

      let remainingSec = 0;
      if (dev.dueTime) {
        remainingSec = Math.max(0, Math.floor((new Date(dev.dueTime).getTime() - now) / 1000));
      }

      if (!dev.connection) {
        // Offline
        if (glowEdges) glowEdges.visible = false;
        if (baseGlow) baseGlow.visible = false;
        bodyMat.transparent = false;
        bodyMat.opacity = 1.0;
        bodyMat.color.setHex(0x94a3b8);
        bodyMat.emissive.setHex(0x000000);
        bodyMat.emissiveIntensity = 0.0;
        haloMat.color.setHex(0x6b7280);
        pointLight.color.setHex(0x6b7280);
        pointLight.intensity = 0.1;
        timerSprite.visible = false;
        if (mesh.userData.waterGroup) mesh.userData.waterGroup.visible = false;
        if (mesh.userData.drum) mesh.userData.drum.visible = false;
        if (mesh.userData.glassMat) mesh.userData.glassMat.opacity = 0.85;
        if (mesh.userData.drumLight) mesh.userData.drumLight.intensity = 0;
        if (mesh.userData.consoleScreenMat) mesh.userData.consoleScreenMat.color.setHex(0x334155);
        if (steamPuffs) {
          for (const p of steamPuffs) p.mat.opacity = 0;
        }
      } else if (dev.isRunning) {
        if (glowEdges) glowEdges.visible = false;
        if (baseGlow) baseGlow.visible = false;
        if (isDryer) {
          // DRYER RUNNING: VIVID HOT RED + RISING STEAM + DRUM HEATER LIGHT
          bodyMat.transparent = false;
          bodyMat.opacity = 1.0;
          bodyMat.color.setHex(0xfecaca);
          bodyMat.emissive.setHex(0xef4444);
          bodyMat.emissiveIntensity = 1.2;

          haloMat.color.setHex(0xef4444);
          pointLight.color.setHex(0xef4444);
          pointLight.intensity = 2.8;
          pointLight.visible = true;

          if (mesh.userData.drum) mesh.userData.drum.visible = true;
          if (mesh.userData.glassMat) mesh.userData.glassMat.opacity = 0.20;
          if (mesh.userData.drumLight) mesh.userData.drumLight.intensity = 2.8;

          this.activeDryers.push(drum);
          this.updateTimerSprite(mesh, remainingSec, true);

          if (steamPuffs) {
            for (const p of steamPuffs) {
              this.steamParticles.push(p);
            }
          }
        } else {
          // WASHER RUNNING: CRYSTAL TRANSLUCENT SHELL + RADIANT OCEAN-BLUE CHURNING WATER
          bodyMat.transparent = true;
          bodyMat.opacity = 0.28; // 晶透外殼，讓內部深藍色水體完全清晰透出！
          bodyMat.depthWrite = false; // 關鍵：不寫入深度，讓內部湛藍水流無遮擋完整穿透！
          bodyMat.color.setHex(0xfef08a);
          bodyMat.emissive.setHex(0xfacc15); // 外殼黃色微光
          bodyMat.emissiveIntensity = 0.35; // 柔和微光發光強度，絕不遮蓋內部藍色水

          haloMat.color.setHex(0xfacc15);
          pointLight.color.setHex(0x0284c7); // 內部映照水光
          pointLight.intensity = 3.0;
          pointLight.visible = true;

          if (mesh.userData.waterGroup) {
            mesh.userData.waterGroup.visible = true;
            this.activeWashers.push(mesh.userData.waterGroup);
          }
          if (mesh.userData.consoleScreenMat) {
            mesh.userData.consoleScreenMat.color.setHex(0xfacc15);
          }
          if (mesh.userData.lidMat) {
            mesh.userData.lidMat.color.setHex(0x38bdf8);
            mesh.userData.lidMat.emissive.setHex(0x0284c7);
            mesh.userData.lidMat.emissiveIntensity = 0.50; // 頂蓋晶透水藍光澤，俯視直視內部水體
            mesh.userData.lidMat.opacity = 0.35;
          }

          this.updateTimerSprite(mesh, remainingSec, false);
        }
      } else {
        // IDLE (可使用機台): 環繞外殼綠光、底座光暈、微光閃爍閃閃發亮
        bodyMat.transparent = false;
        bodyMat.opacity = 1.0;
        bodyMat.depthWrite = true;
        bodyMat.color.setHex(0xf0fdf4); // 清爽薄荷亮白
        bodyMat.emissive.setHex(0x10b981); // 翠綠自發光
        bodyMat.emissiveIntensity = 0.45; // 基礎微光發光強度

        haloMat.color.setHex(0x22c55e); // 明亮綠光頂部光環
        pointLight.intensity = 0;
        pointLight.visible = false; // 嚴格關閉點光源，杜絕不必要的片元著色器計算
        timerSprite.visible = false;

        // 啟動環繞外殼綠光輪廓與地面綠色光暈
        if (glowEdges) glowEdges.visible = true;
        if (baseGlow) baseGlow.visible = true;

        this.idleMachines.push(mesh);

        // 閒置時隱藏內部所有動態零件，100% 杜絕旋轉視角時的 Z-fighting 閃爍假象
        if (mesh.userData.waterGroup) mesh.userData.waterGroup.visible = false;
        if (mesh.userData.drum) mesh.userData.drum.visible = false;
        if (mesh.userData.glassMat) mesh.userData.glassMat.opacity = 0.85;
        if (mesh.userData.drumLight) mesh.userData.drumLight.intensity = 0;
        if (mesh.userData.consoleScreenMat) mesh.userData.consoleScreenMat.color.setHex(0x0284c7);
        if (mesh.userData.lidMat) {
          mesh.userData.lidMat.color.setHex(0x0284c7);
          mesh.userData.lidMat.emissive.setHex(0x000000);
          mesh.userData.lidMat.emissiveIntensity = 0.0;
        }
        if (steamPuffs) {
          for (const p of steamPuffs) p.mat.opacity = 0;
        }
      }
    }
  }

  setupEvents() {
    let hoverThrottleTimeout = null;
    const onPointerMove = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Throttle hover raycasting to at most 25 times/sec instead of 500+ times/sec
      if (!hoverThrottleTimeout) {
        hoverThrottleTimeout = setTimeout(() => {
          this.checkHover();
          hoverThrottleTimeout = null;
        }, 40);
      }
    };

    const onClick = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const clickX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const clickY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera({ x: clickX, y: clickY }, this.camera);
      const interactiveObjects = [];
      for (const mesh of this.machineMeshes.values()) {
        interactiveObjects.push(mesh.userData.bodyMesh);
      }

      const intersects = this.raycaster.intersectObjects(interactiveObjects, false);
      if (intersects.length > 0) {
        const machineGroup = intersects[0].object.parent;
        const device = machineGroup.userData.device;
        if (device && this.onSelectMachine) {
          this.focusOnMachine(machineGroup);
          this.onSelectMachine(device);
        }
      }
    };

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('pointermove', onPointerMove);
    this.renderer.domElement.addEventListener('pointerdown', onClick);
  }

  checkHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const interactiveObjects = [];
    for (const mesh of this.machineMeshes.values()) {
      interactiveObjects.push(mesh.userData.bodyMesh);
    }

    const intersects = this.raycaster.intersectObjects(interactiveObjects, false);
    if (intersects.length > 0) {
      this.renderer.domElement.style.cursor = 'pointer';
      const targetMesh = intersects[0].object;
      if (this.hoveredMesh !== targetMesh) {
        if (this.hoveredMesh && !this.hoveredMesh.parent?.userData?.device?.isRunning) {
          const isIdle = this.hoveredMesh.parent?.userData?.device?.connection;
          if (isIdle) {
            this.hoveredMesh.material.emissive?.setHex(0x10b981);
            this.hoveredMesh.material.emissiveIntensity = 0.45;
          } else {
            this.hoveredMesh.material.emissive?.setHex(0x000000);
            this.hoveredMesh.material.emissiveIntensity = 0.0;
          }
        }
        this.hoveredMesh = targetMesh;
        if (!targetMesh.parent?.userData?.device?.isRunning) {
          targetMesh.material.emissive?.setHex(0x38bdf8);
          targetMesh.material.emissiveIntensity = 0.6;
        }
      }
    } else {
      this.renderer.domElement.style.cursor = 'default';
      if (this.hoveredMesh) {
        if (!this.hoveredMesh.parent?.userData?.device?.isRunning) {
          const isIdle = this.hoveredMesh.parent?.userData?.device?.connection;
          if (isIdle) {
            this.hoveredMesh.material.emissive?.setHex(0x10b981);
            this.hoveredMesh.material.emissiveIntensity = 0.45;
          } else {
            this.hoveredMesh.material.emissive?.setHex(0x000000);
            this.hoveredMesh.material.emissiveIntensity = 0.0;
          }
        }
        this.hoveredMesh = null;
      }
    }
  }

  focusOnMachine(machineGroup) {
    const worldPos = new THREE.Vector3();
    machineGroup.getWorldPosition(worldPos);

    this.targetLookAt.copy(worldPos).add(new THREE.Vector3(0, 1.0, 0));
    this.targetCameraPos.set(worldPos.x + 3.0, worldPos.y + 2.8, worldPos.z + 5.0);
    this.isAnimatingCamera = true;
  }

  setFloorFocus(floorName) {
    if (floorName === 'all') {
      // High-angle bird's-eye 3D perspective: overlook all floors (2F~8F) and timers with full headroom
      const aspect = this.camera.aspect || (window.innerWidth / window.innerHeight);
      let distZ = 42.0;
      let distY = 30.0;
      let distX = 18.0;

      if (aspect < 1.0) {
        // Portrait mobile screens
        distZ = 58.0;
        distY = 38.0;
        distX = 24.0;
      } else if (aspect < 1.4) {
        // Tablets / narrower viewports
        distZ = 48.0;
        distY = 34.0;
        distX = 20.0;
      }

      this.targetLookAt.set(0, 11.5, 0);
      this.targetCameraPos.set(distX, distY, distZ);
    } else {
      const config = this.floorConfig.find((f) => f.name === floorName);
      if (config) {
        this.targetLookAt.set(0, config.y + 1.2, 0);
        this.targetCameraPos.set(7.5, config.y + 3.2, 17.5);
      }
    }
    this.isAnimatingCamera = true;
  }

  onResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // 1. Pause rendering completely when tab is backgrounded or hidden (0% CPU/GPU usage)
    if (document.hidden) return;

    // 2. Cap framerate to smooth 60 FPS (prevents 120Hz/144Hz/240Hz monitors from overworking GPU)
    const now = performance.now();
    const elapsed = now - this.lastFrameTime;
    if (elapsed < 16.0) return;
    this.lastFrameTime = now - (elapsed % 16.0);

    const time = Date.now() * 0.008;

    // Spin ONLY actively running washers (blue water vortex churning & bobbing)
    for (const waterGroup of this.activeWashers) {
      waterGroup.rotation.y -= 0.16;
      waterGroup.position.y = 0.95 + Math.sin(time) * 0.035;
    }

    // Spin ONLY actively running dryers (smooth tumbling drum)
    for (const drum of this.activeDryers) {
      drum.rotation.z -= 0.15;
    }

    // Gentle rising steam animation for running dryers (drifts backward away from timer)
    for (const p of this.steamParticles) {
      p.mesh.position.y += p.speedY;
      p.mesh.position.z -= 0.016; // 後方飄散，絕不遮擋前方倒數看板
      p.mesh.position.x += 0.005;
      p.lifetime += 0.022;
      const opacity = Math.sin(p.lifetime * Math.PI) * 0.65;
      p.mat.opacity = Math.max(0, opacity);
      p.mesh.scale.setScalar(1 + p.lifetime * 2.2);

      if (p.lifetime >= 1.0) {
        p.lifetime = 0;
        p.mesh.position.set(p.initX + (Math.random() - 0.5) * 0.12, 0, p.initZ + (Math.random() - 0.5) * 0.12);
      }
    }

    // Shimmering & pulsing animation for available idle machines (閃閃發亮的環繞綠光)
    // 極致效能：純材質屬性數學波形更新，0 額外光照計算、0 幾何體重算、0 陰影更新
    if (this.idleMachines.length > 0) {
      const t = time * 2.2;
      for (let i = 0; i < this.idleMachines.length; i++) {
        const mesh = this.idleMachines[i];
        const offset = i * 0.42;
        // 雙頻正弦波疊加營造自然有機的星光閃爍效果 (Multi-frequency sparkle)
        const wave1 = Math.sin(t + offset);
        const wave2 = Math.sin(t * 1.8 + offset * 1.7);
        const sparkle = 0.5 + 0.35 * wave1 + 0.15 * wave2; // 0.0 ~ 1.0

        // 1. 機身表面翡翠綠微光呼吸
        if (mesh.userData.bodyMat && this.hoveredMesh !== mesh.userData.bodyMesh) {
          mesh.userData.bodyMat.emissiveIntensity = 0.30 + sparkle * 0.45; // 0.30 ~ 0.75
        }
        // 2. 環繞整個外殼的綠色霓虹輪廓線閃亮
        if (mesh.userData.edgeMat) {
          mesh.userData.edgeMat.opacity = 0.55 + sparkle * 0.40; // 0.55 ~ 0.95
        }
        // 3. 底座環繞地面綠色光暈呼吸擴散
        if (mesh.userData.baseGlowMat) {
          mesh.userData.baseGlowMat.opacity = 0.45 + sparkle * 0.45; // 0.45 ~ 0.90
        }
      }
    }

    // Camera animation tweening
    if (this.isAnimatingCamera) {
      this.camera.position.lerp(this.targetCameraPos, 0.06);
      this.controls.target.lerp(this.targetLookAt, 0.06);

      if (
        this.camera.position.distanceTo(this.targetCameraPos) < 0.05 &&
        this.controls.target.distanceTo(this.targetLookAt) < 0.05
      ) {
        this.isAnimatingCamera = false;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
