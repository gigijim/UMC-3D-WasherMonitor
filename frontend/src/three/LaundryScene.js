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
    this.floorGroups = new Map();
    this.hoveredMesh = null;

    this.floorConfig = [
      { name: '2F', y: 0 },
      { name: '4F', y: 7.5 },
      { name: '6F', y: 15.0 },
      { name: '8F', y: 22.5 }
    ];

    this.currentFocusFloor = 'all';

    // 視角動態巡航與圖釘固定機制 (預設開啟用質感緩慢正面150度弧形巡航)
    this.isAutoOrbiting = true;
    this.isPinned = false;
    this.isUserInteracting = false;
    this.orbitStartTime = performance.now();

    // 根據當前螢幕尺寸比例精確計算全棟 3D 鏡頭最佳角度與放大比例（重心下移，更加一目了然）
    const initialAspect = (this.container?.clientWidth || window.innerWidth) / (this.container?.clientHeight || window.innerHeight);
    const initialCam = this.computeAllFloorsCamera(initialAspect);
    this.targetCameraPos = initialCam.cameraPos.clone();
    this.targetLookAt = initialCam.lookAt.clone();
    this.orbitLookAt = initialCam.lookAt.clone();
    this.orbitCamY = initialCam.cameraPos.y;
    this.orbitRadius = Math.hypot(initialCam.cameraPos.x - initialCam.lookAt.x, initialCam.cameraPos.z - initialCam.lookAt.z);
    this.orbitBaseAngle = 0; // 核心修正：巡航基準正對中央正面 (0度)，絕不偏斜到側牆！
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

    // Controls (Unrestricted zoom range & free inspection)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.copy(this.targetLookAt);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 0.5; // 允許極近距離自由縮放檢視機台細節
    this.controls.maxDistance = 280; // 允許自由直接縮小至全域大視野，絕不被鎖定在特定區間
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 1.2;

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.lastFrameTime = performance.now();

    // --- Shared High-Performance Spotlight & FREE Badge Resources (Generated Once, Shared Across 24 Machines) ---
    // 1. Volumetric spotlight cone geometry (top radius 0.16, bottom radius 1.15, height 3.0, open-ended)
    this.sharedSpotConeGeo = new THREE.CylinderGeometry(0.16, 1.15, 3.0, 24, 1, true);

    // 2. Ceiling spotlight fixture lens geometry
    this.sharedSpotLensGeo = new THREE.CircleGeometry(0.20, 16);

    // 3. Machine top light puddle geometry
    this.sharedSpotPuddleGeo = new THREE.CircleGeometry(0.80, 24);

    // 4. Volumetric spotlight beam gradient texture (Smooth vertical fade from apex to machine top)
    const spotCanvas = document.createElement('canvas');
    spotCanvas.width = 64;
    spotCanvas.height = 256;
    const sCtx = spotCanvas.getContext('2d');
    const grad = sCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, 'rgba(74, 222, 128, 0.08)');
    grad.addColorStop(0.15, 'rgba(74, 222, 128, 0.55)');
    grad.addColorStop(0.70, 'rgba(34, 197, 94, 0.28)');
    grad.addColorStop(1.0, 'rgba(16, 185, 129, 0.0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 64, 256);
    this.sharedSpotBeamTex = new THREE.CanvasTexture(spotCanvas);

    // 5. Machine top light puddle radial gradient texture
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 128;
    pCanvas.height = 128;
    const pCtx = pCanvas.getContext('2d');
    const pGrad = pCtx.createRadialGradient(64, 64, 5, 64, 64, 60);
    pGrad.addColorStop(0.0, 'rgba(74, 222, 128, 0.85)');
    pGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.35)');
    pGrad.addColorStop(1.0, 'rgba(16, 185, 129, 0.0)');
    pCtx.fillStyle = pGrad;
    pCtx.fillRect(0, 0, 128, 128);
    this.sharedSpotPuddleTex = new THREE.CanvasTexture(pCanvas);

    // 6. "FREE ⬇" Badge Canvas Texture
    this.sharedFreeBadgeTex = this.createFreeBadgeTexture();
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

  // 依需求：純粹 2 個字 "2F" / "4F" / "6F" / "8F"，無方框、無多餘文字、無 UMC 字樣
  createSideWallFloorBadge(floorName) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // 巨大、立體、極簡無框純字體
    ctx.font = '900 170px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 立體深黑陰影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
    ctx.fillText(floorName, 131, 131);

    // 半透明淡青立體主字
    ctx.fillStyle = 'rgba(186, 230, 253, 0.55)';
    ctx.fillText(floorName, 128, 128);

    // 微光輪廓光圈
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.50)';
    ctx.strokeText(floorName, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const badgeGeo = new THREE.PlaneGeometry(3.6, 3.6);
    const badgeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    return new THREE.Mesh(badgeGeo, badgeMat);
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

    const wallGeo = new THREE.BoxGeometry(21, 5.2, 0.3);
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
      backWall.position.set(0, 2.6, -2.5);
      backWall.receiveShadow = true;
      floorGroup.add(backWall);

      // 依需求：移動並複製到後牆左、右兩側空白區域 (x = -8.2 與 x = 8.2)，完全避開中間 spot light 與機台！
      const leftBadge = this.createSideWallFloorBadge(floor.name);
      leftBadge.position.set(-8.2, 2.6, -2.33);
      floorGroup.add(leftBadge);

      const rightBadge = this.createSideWallFloorBadge(floor.name);
      rightBadge.position.set(8.2, 2.6, -2.33);
      floorGroup.add(rightBadge);

      // Right Entrance Arch Wall
      const doorArchGeo = new THREE.BoxGeometry(0.3, 5.2, 3.0);
      const doorArchMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5 });
      const rightWall = new THREE.Mesh(doorArchGeo, doorArchMat);
      rightWall.position.set(10.4, 2.6, -1.0);
      floorGroup.add(rightWall);

      // Dynamic Camera-Facing Billboard Floor Sign (Outside left slab at x=-11.8)
      const floorSignSprite = this.createFloorSignSprite(floor.name);
      floorSignSprite.position.set(-11.8, 1.8, 0.5);
      floorGroup.add(floorSignSprite);

      // Pillars (依需求移除各樓層左前方柱子 [-10.2, 3.4]，全面敞開視角，絕不遮擋機台)
      if (floor.name !== '2F') {
        const pillarGeo = new THREE.CylinderGeometry(0.15, 0.15, 7.1, 16);
        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5 });
        const corners = [
          [10.2, 3.4],   // 右前方柱子
          [-10.2, -3.4], // 左後方柱子
          [10.2, -3.4]   // 右後方柱子
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

    // 初始化時即刻生成 24 台機台網格，保證第一幀即刻完整呈現，解決「先顯示樓層再顯示機台」二次載入卡頓感
    this.buildInitialMachines();
  }

  buildInitialMachines() {
    const defaultDevices = [];
    const floors = ['2F', '4F', '6F', '8F'];
    for (const floor of floors) {
      for (let i = 1; i <= 3; i++) {
        defaultDevices.push({
          hwid: `${floor}_washer_${i}`,
          floor,
          type: 'washer',
          num: i,
          description: `${floor}洗衣機${i}號`,
          connection: true,
          isRunning: false
        });
      }
      for (let i = 1; i <= 2; i++) {
        defaultDevices.push({
          hwid: `${floor}_dryer_${i}`,
          floor,
          type: 'dryer',
          num: i,
          description: `${floor}烘衣機${i}號`,
          connection: true,
          isRunning: false
        });
      }
      defaultDevices.push({
        hwid: `${floor}_washer_4`,
        floor,
        type: 'washer',
        num: 4,
        description: `${floor}洗衣機4號`,
        connection: true,
        isRunning: false
      });
    }
    this.populateMachines(defaultDevices);
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

  createFreeBadgeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // 1. Rounded container pill with dark glossy background & glowing neon green border
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 18;

    const x = 30, y = 22, w = 196, h = 90, r = 24;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();

    ctx.fillStyle = 'rgba(5, 36, 20, 0.95)';
    ctx.fill();

    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 6;
    ctx.stroke();

    // 2. Bold radiant green text "FREE"
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#4ade80';
    ctx.font = '900 56px Arial, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FREE', 128, 68);

    // 3. Dynamic Downward Arrow (⬇)
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#22c55e';

    // Arrow stem
    ctx.beginPath();
    ctx.rect(114, 122, 28, 44);
    ctx.fill();

    // Arrow head (pointing down)
    ctx.beginPath();
    ctx.moveTo(80, 162);
    ctx.lineTo(176, 162);
    ctx.lineTo(128, 224);
    ctx.closePath();
    ctx.fill();

    // Pure white core highlight for maximum contrast
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(98, 166);
    ctx.lineTo(158, 166);
    ctx.lineTo(128, 210);
    ctx.closePath();
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
  }

  attachFreeSpotlight(group) {
    const spotGroup = new THREE.Group();
    spotGroup.visible = false;

    // 1. Volumetric Spotlight Beam Cone (Descending from ceiling at y=5.1 down to y=2.1)
    const coneMat = new THREE.MeshBasicMaterial({
      map: this.sharedSpotBeamTex,
      color: 0x4ade80,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const cone = new THREE.Mesh(this.sharedSpotConeGeo, coneMat);
    cone.position.set(0, 3.6, 0); // Centered at y=3.6, height 3.0 -> covers y=2.1 to y=5.1
    spotGroup.add(cone);

    // 2. Ceiling Spotlight Fixture Lens Disk (at y=5.1)
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x86efac });
    const lens = new THREE.Mesh(this.sharedSpotLensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 5.1, 0);
    spotGroup.add(lens);

    // 3. Machine Top Spotlight Light Puddle (at y=2.06)
    const puddleMat = new THREE.MeshBasicMaterial({
      map: this.sharedSpotPuddleTex,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const puddle = new THREE.Mesh(this.sharedSpotPuddleGeo, puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(0, 2.06, 0);
    spotGroup.add(puddle);

    // 4. "FREE ⬇" Bouncing Billboard Sprite (floats directly above the machine)
    const spriteMat = new THREE.SpriteMaterial({
      map: this.sharedFreeBadgeTex,
      transparent: true,
      depthTest: false
    });
    const freeSprite = new THREE.Sprite(spriteMat);
    freeSprite.position.set(0, 3.4, 0.35);
    freeSprite.scale.set(1.9, 1.9, 1.0);
    freeSprite.renderOrder = 9998;
    spotGroup.add(freeSprite);

    group.add(spotGroup);

    group.userData.freeSpotlight = {
      group: spotGroup,
      coneMat,
      freeSprite,
      baseY: 3.4
    };
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

    // Spotlight & Bouncing "FREE ⬇" Indicator (閒置可用時啟用)
    this.attachFreeSpotlight(group);

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

    // Spotlight & Bouncing "FREE ⬇" Indicator (閒置可用時啟用)
    this.attachFreeSpotlight(group);

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
      if (timerSprite.visible) timerSprite.visible = false;
      mesh.userData.lastTimerText = '';
      return;
    }

    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    const timeText = `⏳ ${m}分${s < 10 ? '0' : ''}${s}秒`;

    // 效能優化：字串相同時直接略過 Canvas 重繪與 GPU 貼圖上傳
    if (mesh.userData.lastTimerText === timeText && timerSprite.visible) return;
    mesh.userData.lastTimerText = timeText;

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

    ctx.font = 'bold 34px monospace';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeText, 128, 38);

    timerTexture.needsUpdate = true;
  }

  // 解決洗衣機時間 3D 動畫不會倒數計時問題：每秒精準滴答更新所有運轉中機台的 3D 倒數看板
  tickSecond(devices) {
    if (!devices || devices.length === 0) return;
    const now = Date.now();
    for (const dev of devices) {
      if (dev.isRunning) {
        const mesh = this.machineMeshes.get(dev.hwid);
        if (mesh) {
          let remSec = 0;
          if (dev.dueTime) {
            remSec = Math.max(0, Math.floor((new Date(dev.dueTime).getTime() - now) / 1000));
          } else if (typeof dev.remainingSec === 'number') {
            remSec = dev.remainingSec;
          }
          this.updateTimerSprite(mesh, remSec, mesh.userData.isDryer);
        }
      }
    }
  }

  populateMachines(devices) {
    if (!devices || devices.length === 0) return;

    // 若 24 台機台網格已生成，只需更新數據映射與即時狀態，絕不重複重建 Mesh，消除卡頓與二次讀取感！
    if (this.machineMeshes.size === 24) {
      for (const dev of devices) {
        let existingMesh = this.machineMeshes.get(dev.hwid);
        if (!existingMesh) {
          for (const [key, mesh] of this.machineMeshes.entries()) {
            const mDev = mesh.userData.device;
            if (mDev && mDev.floor === dev.floor && mDev.type === dev.type && (mDev.num === dev.num || mDev.description === dev.description)) {
              existingMesh = mesh;
              this.machineMeshes.delete(key);
              this.machineMeshes.set(dev.hwid, existingMesh);
              existingMesh.userData.hwid = dev.hwid;
              break;
            }
          }
        }
        if (existingMesh) {
          existingMesh.userData.device = dev;
        }
      }
      this.updateMachineStatus(devices);
      return;
    }

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

    const now = Date.now();

    for (const dev of devices) {
      const mesh = this.machineMeshes.get(dev.hwid);
      if (!mesh) continue;

      mesh.userData.device = dev;
      const { bodyMat, haloMat, pointLight, agitator, drum, timerSprite, steamPuffs, isDryer, freeSpotlight } = mesh.userData;

      let remainingSec = 0;
      if (dev.dueTime) {
        remainingSec = Math.max(0, Math.floor((new Date(dev.dueTime).getTime() - now) / 1000));
      }

      if (!dev.connection) {
        // Offline
        if (freeSpotlight) freeSpotlight.group.visible = false;
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
        if (freeSpotlight) freeSpotlight.group.visible = false;
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
        // IDLE (可使用機台): 乾淨白底機身、開啟聚光燈與跳動的 FREE ⬇ 標籤
        bodyMat.transparent = false;
        bodyMat.opacity = 1.0;
        bodyMat.depthWrite = true;
        bodyMat.color.setHex(0xf8fafc);
        bodyMat.emissive.setHex(0x000000);
        bodyMat.emissiveIntensity = 0.0;

        haloMat.color.setHex(0x10b981);
        pointLight.intensity = 0;
        pointLight.visible = false;
        timerSprite.visible = false;

        if (freeSpotlight) {
          freeSpotlight.group.visible = true;
          freeSpotlight.freeSprite.position.y = freeSpotlight.baseY;
          freeSpotlight.coneMat.opacity = 0.50;
        }

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

    let pointerDownPos = { x: 0, y: 0, time: 0 };

    const onPointerDown = (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
    };

    const onPointerUp = (e) => {
      // 區分「點擊」與「旋轉/縮放拖曳」：移動超過 7px 或按住超過 350ms 視為視角操作，不觸發機台選取
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      const dist = Math.hypot(dx, dy);
      const dt = performance.now() - pointerDownPos.time;

      if (dist > 7 || dt > 350) return;

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

    // 使用者任何滾輪、手勢觸控或拖曳操作，立即解除鏡頭自動過渡鎖定，賦予 100% 自由檢視操作權
    let wheelTimeout = null;
    const releaseCameraLock = () => {
      this.isAnimatingCamera = false;
      this.isUserInteracting = true;
    };

    const onControlsEnd = () => {
      this.isUserInteracting = false;
      if (this.currentFocusFloor === 'all' && !this.isPinned) {
        // 放開手勢後，若尚未釘選固定，以當前視角為基準平滑銜接慢速弧形巡航
        this.orbitBaseAngle = Math.atan2(
          this.camera.position.x - this.controls.target.x,
          this.camera.position.z - this.controls.target.z
        );
        this.orbitRadius = Math.hypot(
          this.camera.position.x - this.controls.target.x,
          this.camera.position.z - this.controls.target.z
        );
        this.orbitCamY = this.camera.position.y;
        this.orbitLookAt.copy(this.controls.target);
        this.orbitStartTime = performance.now();
      }
    };

    this.controls.addEventListener('start', releaseCameraLock);
    this.controls.addEventListener('end', onControlsEnd);

    this.renderer.domElement.addEventListener('wheel', () => {
      releaseCameraLock();
      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(onControlsEnd, 300);
    }, { passive: true });

    this.renderer.domElement.addEventListener('touchstart', releaseCameraLock, { passive: true });
    this.renderer.domElement.addEventListener('touchmove', releaseCameraLock, { passive: true });
    this.renderer.domElement.addEventListener('touchend', onControlsEnd, { passive: true });

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('pointermove', onPointerMove);
    this.renderer.domElement.addEventListener('pointerdown', onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', onPointerUp);
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
          this.hoveredMesh.material.emissive?.setHex(0x000000);
          this.hoveredMesh.material.emissiveIntensity = 0.0;
        }
        this.hoveredMesh = targetMesh;
        if (!targetMesh.parent?.userData?.device?.isRunning) {
          targetMesh.material.emissive?.setHex(0x0284c7);
          targetMesh.material.emissiveIntensity = 0.4;
        }
      }
    } else {
      this.renderer.domElement.style.cursor = 'default';
      if (this.hoveredMesh) {
        if (!this.hoveredMesh.parent?.userData?.device?.isRunning) {
          this.hoveredMesh.material.emissive?.setHex(0x000000);
          this.hoveredMesh.material.emissiveIntensity = 0.0;
        }
        this.hoveredMesh = null;
      }
    }
  }

  focusOnMachine(machineGroup) {
    this.currentFocusFloor = 'machine';
    const worldPos = new THREE.Vector3();
    machineGroup.getWorldPosition(worldPos);

    // 視角適度拉開，抬高注視中心 (y + 1.85)，確保機台上方的倒數計時看板 (y = 3.20) 擁有充裕留白、絕不遮蔽
    const aspect = (this.container?.clientWidth || window.innerWidth) / (this.container?.clientHeight || window.innerHeight);
    const isMobile = aspect < 1.0;

    const offsetX = isMobile ? 4.0 : 4.6;
    const offsetY = isMobile ? 4.2 : 3.8;
    const offsetZ = isMobile ? 12.8 : 9.8;

    this.targetLookAt.set(worldPos.x, worldPos.y + 1.85, worldPos.z);
    this.targetCameraPos.set(worldPos.x + offsetX, worldPos.y + offsetY, worldPos.z + offsetZ);
    this.isAnimatingCamera = true;
  }

  // 根據當前螢幕長寬比動態計算「全部」全棟 3D 視角：放大畫面，重心下移，機台更清晰一目了然
  computeAllFloorsCamera(aspect) {
    let lookAt;
    let cameraPos;

    if (aspect >= 1.2) {
      // 電腦寬螢幕 (16:9, 16:10, 21:9 超寬螢幕)
      // 正面重心下移視角，相機略微偏右 4.5 營造立體層次，絕不偏轉過度
      lookAt = new THREE.Vector3(0, 16.5, 0);
      cameraPos = new THREE.Vector3(4.5, 17.2, 37.5);
    } else if (aspect >= 0.95) {
      // 平板電腦 / 方正螢幕 (e.g. iPad 4:3)
      lookAt = new THREE.Vector3(0, 15.5, 0);
      cameraPos = new THREE.Vector3(4.0, 17.5, 41.0);
    } else {
      // 直式手機螢幕 (aspect < 0.95, 9:16 ~ 9:20 直長比例)
      lookAt = new THREE.Vector3(0, 15.0, 0);
      cameraPos = new THREE.Vector3(2.5, 17.8, 39.0);
    }

    return {
      cameraPos,
      lookAt
    };
  }

  setFloorFocus(floorName) {
    this.currentFocusFloor = floorName;
    const aspect = this.camera?.aspect || (window.innerWidth / window.innerHeight);
    const isMobile = aspect < 1.0;

    if (floorName === 'all') {
      const { cameraPos, lookAt } = this.computeAllFloorsCamera(aspect);
      this.targetLookAt.copy(lookAt);
      this.targetCameraPos.copy(cameraPos);
      this.orbitLookAt.copy(lookAt);
      this.orbitCamY = cameraPos.y;
      this.orbitRadius = Math.hypot(cameraPos.x - lookAt.x, cameraPos.z - lookAt.z);
      this.orbitBaseAngle = 0; // 正面基準 (0度)
      this.orbitStartTime = performance.now();
    } else {
      const config = this.floorConfig.find((f) => f.name === floorName);
      if (config) {
        if (isMobile) {
          // 手機直式比例：選取 2, 4, 6, 8 樓層時，視角中心移至選取樓層
          this.targetLookAt.set(-0.5, config.y + 1.2, -0.5);
          this.targetCameraPos.set(-16.5, config.y + 7.5, 21.5);
        } else {
          // 電腦桌面寬螢幕：微俯瞰視角
          this.targetLookAt.set(0, config.y + 1.2, 0);
          this.targetCameraPos.set(7.5, config.y + 3.2, 17.5);
        }
      }
    }
    this.isAnimatingCamera = true;
  }

  togglePinView(pinned) {
    if (typeof pinned === 'boolean') {
      this.isPinned = pinned;
    } else {
      this.isPinned = !this.isPinned;
    }
    if (!this.isPinned) {
      this.orbitBaseAngle = 0; // 恢復巡航時以正面為基準
      this.orbitRadius = Math.hypot(
        this.camera.position.x - this.controls.target.x,
        this.camera.position.z - this.controls.target.z
      );
      this.orbitCamY = this.camera.position.y;
      this.orbitLookAt.copy(this.controls.target);
      this.orbitStartTime = performance.now();
    }
    return this.isPinned;
  }

  onResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // 當目前處於「全部」全棟視野時，動態適應新的螢幕長寬比與縮放
    if (this.currentFocusFloor === 'all') {
      const { cameraPos, lookAt } = this.computeAllFloorsCamera(this.camera.aspect);
      this.targetCameraPos.copy(cameraPos);
      this.targetLookAt.copy(lookAt);
      this.orbitLookAt.copy(lookAt);
      this.orbitCamY = cameraPos.y;
      this.orbitRadius = Math.hypot(cameraPos.x - lookAt.x, cameraPos.z - lookAt.z);
      this.orbitBaseAngle = 0;
      this.isAnimatingCamera = true;
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    // 1. 頁面切到背景時完全停止渲染，0% CPU/GPU 負擔
    if (document.hidden) return;

    // 2. 鎖定 60 FPS 幀率上限（杜絕高刷螢幕過載發熱）
    const now = performance.now();
    const elapsed = now - this.lastFrameTime;
    if (elapsed < 16.0) return;
    this.lastFrameTime = now - (elapsed % 16.0);

    const time = Date.now() * 0.008;

    // 僅對運轉中的洗衣機更新水流渦流
    for (const waterGroup of this.activeWashers) {
      waterGroup.rotation.y -= 0.16;
      waterGroup.position.y = 0.95 + Math.sin(time) * 0.035;
    }

    // 僅對運轉中的烘衣機更新滾筒旋轉
    for (const drum of this.activeDryers) {
      drum.rotation.z -= 0.15;
    }

    // 烘衣機熱氣粒子
    for (const p of this.steamParticles) {
      p.mesh.position.y += p.speedY;
      p.mesh.position.z -= 0.016;
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

    // 鏡頭動畫平滑差值
    if (this.isAnimatingCamera) {
      this.camera.position.lerp(this.targetCameraPos, 0.08);
      this.controls.target.lerp(this.targetLookAt, 0.08);

      if (
        this.camera.position.distanceTo(this.targetCameraPos) < 0.06 &&
        this.controls.target.distanceTo(this.targetLookAt) < 0.06
      ) {
        this.camera.position.copy(this.targetCameraPos);
        this.controls.target.copy(this.targetLookAt);
        this.isAnimatingCamera = false;
      }
    } else if (
      this.currentFocusFloor === 'all' &&
      !this.isPinned &&
      !this.isUserInteracting
    ) {
      // 依需求：維持在正面視野內緩慢弧形巡航，擺幅適中 (±24度)，絕不轉到側牆平行
      const t = (performance.now() - this.orbitStartTime) * 0.00015; // 極慢舒適週期 (~42秒)
      const sway = Math.sin(t) * 0.42; // 最大左右擺動約 ±24度，正面全景機台一目了然
      const angle = this.orbitBaseAngle + sway;

      const targetX = this.orbitLookAt.x + this.orbitRadius * Math.sin(angle);
      const targetZ = this.orbitLookAt.z + this.orbitRadius * Math.cos(angle);

      this.camera.position.x += (targetX - this.camera.position.x) * 0.035;
      this.camera.position.z += (targetZ - this.camera.position.z) * 0.035;
      this.camera.position.y += (this.orbitCamY - this.camera.position.y) * 0.035;
      this.controls.target.lerp(this.orbitLookAt, 0.035);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
