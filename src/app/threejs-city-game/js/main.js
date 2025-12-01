import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- SCENE SETUP ---
const scene = new THREE.Scene();
const backgroundColor = new THREE.Color(0x0b1120);
scene.background = backgroundColor;
scene.fog = new THREE.FogExp2(backgroundColor, 0.0026);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  2500
);

// Posisi kamera akan diatur setelah car dimuat

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Pastikan renderer tidak memiliki clear color yang berbeda
renderer.setClearColor(backgroundColor, 1);
document.body.appendChild(renderer.domElement);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

// HemisphereLight: warna biru untuk langit (atas), hijau gelap untuk ground (bawah)
// Intensitas dikurangi sedikit untuk menghindari warna yang terlalu mencolok
const hemiLight = new THREE.HemisphereLight(0x4d6fa0, 0x0b180d, 0.8);
hemiLight.position.set(0, 300, 0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff0d5, 2.1);
sunLight.position.set(-120, 180, 80);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 4096;
sunLight.shadow.mapSize.height = 4096;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 600;
sunLight.shadow.camera.left = -300;
sunLight.shadow.camera.right = 300;
sunLight.shadow.camera.top = 300;
sunLight.shadow.camera.bottom = -300;
scene.add(sunLight);

const fillLights = [];
const LIGHT_POINTS = [
  [80, 60, -40],
  [-60, 50, 120],
];
LIGHT_POINTS.forEach(([x, y, z]) => {
  const light = new THREE.PointLight(0x6fd1ff, 0.25, 380);
  light.position.set(x, y, z);
  scene.add(light);
  fillLights.push(light);
});

// --- GLOBAL CONST ---
// Konfigurasi city berdasarkan konsep dari Three.js-City repository
const CITY = {
  size: 420,
  mainRoadWidth: 16,
  secondaryRoadWidth: 9,
  diagonalRoadWidth: 7,
  blockSpacing: 56,
  blockOffset: 26,
  plazaRadius: 40,
  density: 0.65,
  // Grid system untuk city generation yang lebih dinamis (dari Three.js-City)
  // gridSize akan dihitung secara dinamis berdasarkan CITY.size
  blockUnitSize: 10, // Ukuran unit per block (dalam Three.js units)
  // Margin untuk memastikan tidak ada yang melebihi batas
  margin: 5, // Margin dari batas map
};

// Hitung gridSize secara dinamis agar mengisi seluruh area
// Grid harus mengisi dari -CITY.size/2 sampai CITY.size/2
const gridExtent = CITY.size / 2 - CITY.margin;
// GridSize dihitung berdasarkan CITY.size dan blockUnitSize
// Dengan rata-rata jarak 4 unit per block, kita butuh sekitar CITY.size / (blockUnitSize * 4) grid points
const CITY_GRID_SIZE = Math.floor((CITY.size - CITY.margin * 2) / (CITY.blockUnitSize * 4));
const loader = new GLTFLoader();
const buildings = [];
// Grid untuk menyimpan posisi building blocks (dari Three.js-City)
let cityGrid = { rows: [], cols: [] };

// Loading state untuk memastikan semua model dimuat sebelum animasi dimulai
let isCarLoaded = false;
let isSceneReady = false;

// --- HELPERS ---
const randFloat = THREE.MathUtils.randFloat;
const randInt = THREE.MathUtils.randInt;
const randSpread = THREE.MathUtils.randFloatSpread;

function createGroundLayers() {
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size, CITY.size),
    new THREE.MeshStandardMaterial({
      color: 0x050608,
      roughness: 0.95,
      metalness: 0.05,
    })
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  scene.add(base);

  const greenbelt = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size * 0.92, CITY.size * 0.92),
    new THREE.MeshStandardMaterial({
      color: 0x0d1c10,
      roughness: 0.9,
    })
  );
  greenbelt.rotation.x = -Math.PI / 2;
  greenbelt.position.y = 0.005;
  greenbelt.receiveShadow = true;
  scene.add(greenbelt);

  const plazaRing = new THREE.Mesh(
    new THREE.RingGeometry(CITY.plazaRadius - 4, CITY.plazaRadius + 6, 64),
    new THREE.MeshStandardMaterial({ color: 0x1e272e, side: THREE.DoubleSide })
  );
  plazaRing.rotation.x = -Math.PI / 2;
  plazaRing.position.y = 0.02;
  scene.add(plazaRing);
}

function createRoad(length, width, x, z, rotationY = 0, color = 0x161616) {
  const roadGeometry = new THREE.PlaneGeometry(width, length);
  const roadMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.05,
  });
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, 0.03, z);
  road.rotation.y = rotationY;
  road.receiveShadow = true;
  scene.add(road);
  return road;
}

function createLaneMarkings(length, width, x, z, rotationY = 0) {
  const stripeGeometry = new THREE.PlaneGeometry(width, length);
  const stripeMaterial = new THREE.MeshBasicMaterial({
    color: 0xfdf9c4,
    side: THREE.DoubleSide,
  });
  const stripes = new THREE.Mesh(stripeGeometry, stripeMaterial);
  stripes.rotation.x = -Math.PI / 2;
  stripes.rotation.y = rotationY;
  stripes.position.set(x, 0.04, z);
  stripes.material.transparent = true;
  stripes.material.opacity = 0.55;
  scene.add(stripes);
}

// Fungsi untuk membuat road network berdasarkan grid (dari Three.js-City)
// Road network dibuat berdasarkan grid yang sudah dibuat
// Memastikan roads tidak melebihi batas CITY.size/2
function buildRoadNetwork() {
  // Buat roads berdasarkan grid jika sudah ada
  if (cityGrid.rows.length > 0 && cityGrid.cols.length > 0) {
    const blockUnitSize = CITY.blockUnitSize;
    const roadWidth = CITY.secondaryRoadWidth;
    const maxExtent = CITY.size / 2 - CITY.margin;
    const minExtent = -CITY.size / 2 + CITY.margin;
    
    // Buat roads di kolom (x-axis) - roads vertikal
    for (let i = 0; i < cityGrid.cols.length; i++) {
      const roadX = cityGrid.cols[i] * blockUnitSize;
      
      // Pastikan roadX tidak melebihi batas
      if (roadX < minExtent || roadX > maxExtent) continue;
      
      // Hitung panjang road dari grid pertama sampai terakhir
      const firstRow = cityGrid.rows[0] * blockUnitSize;
      const lastRow = cityGrid.rows[cityGrid.rows.length - 1] * blockUnitSize;
      const roadLength = Math.min(lastRow - firstRow, maxExtent * 2);
      const roadZ = (firstRow + lastRow) * 0.5;
      
      // Pastikan road tidak melebihi batas
      const halfLength = roadLength * 0.5;
      if (roadZ + halfLength > maxExtent || roadZ - halfLength < minExtent) {
        // Sesuaikan panjang road agar tidak melebihi batas
        const adjustedLength = Math.min(
          (maxExtent - roadZ) * 2,
          (roadZ - minExtent) * 2,
          roadLength
        );
        if (adjustedLength > 0) {
          createRoad(adjustedLength, roadWidth, roadX, roadZ);
        }
      } else {
        createRoad(roadLength, roadWidth, roadX, roadZ);
      }
    }
    
    // Buat roads di baris (z-axis) - roads horizontal
    for (let i = 0; i < cityGrid.rows.length; i++) {
      const roadZ = cityGrid.rows[i] * blockUnitSize;
      
      // Pastikan roadZ tidak melebihi batas
      if (roadZ < minExtent || roadZ > maxExtent) continue;
      
      for (let j = 0; j < cityGrid.cols.length - 1; j++) {
        const firstCol = cityGrid.cols[j] * blockUnitSize;
        const lastCol = cityGrid.cols[j + 1] * blockUnitSize;
        const roadX = (firstCol + lastCol) * 0.5;
        const roadLength = (lastCol - firstCol);
        
        // Pastikan road tidak melebihi batas
        const halfLength = roadLength * 0.5;
        if (roadX + halfLength > maxExtent || roadX - halfLength < minExtent) {
          // Sesuaikan panjang road agar tidak melebihi batas
          const adjustedLength = Math.min(
            (maxExtent - roadX) * 2,
            (roadX - minExtent) * 2,
            roadLength
          );
          if (adjustedLength > 0) {
            createRoad(adjustedLength, roadWidth, roadX, roadZ);
          }
        } else {
          createRoad(roadLength, roadWidth, roadX, roadZ);
        }
      }
    }
  } else {
    // Fallback ke sistem road network yang lama jika grid belum dibuat
    // Pastikan roads tidak melebihi batas
    const maxExtent = CITY.size / 2 - CITY.margin;
    for (let i = -maxExtent; i <= maxExtent; i += CITY.blockSpacing) {
      const width =
        Math.abs(i) < 2 ? CITY.mainRoadWidth : CITY.secondaryRoadWidth;
      const roadLength = CITY.size - CITY.margin * 2;
      createRoad(roadLength, width, i, 0);
      createRoad(roadLength, width, 0, i);

      if (Math.abs(i) < 2) {
        createLaneMarkings(roadLength * 0.98, 0.8, i + width / 4, 0);
        createLaneMarkings(roadLength * 0.98, 0.8, i - width / 4, 0);
        createLaneMarkings(roadLength * 0.98, 0.8, 0, i + width / 4, Math.PI / 2);
        createLaneMarkings(roadLength * 0.98, 0.8, 0, i - width / 4, Math.PI / 2);
      }
    }
  }
}

function createRoundabout() {
  const roundabout = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY.plazaRadius, CITY.plazaRadius, 2, 48),
    new THREE.MeshStandardMaterial({
      color: 0x232c33,
      roughness: 0.7,
    })
  );
  roundabout.position.y = 1;
  scene.add(roundabout);

  const innerGarden = new THREE.Mesh(
    new THREE.CylinderGeometry(
      CITY.plazaRadius - 6,
      CITY.plazaRadius - 6,
      2,
      48
    ),
    new THREE.MeshStandardMaterial({ color: 0x20351e })
  );
  innerGarden.position.y = 2.2;
  scene.add(innerGarden);

  const monumentBase = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 8, 3, 24),
    new THREE.MeshStandardMaterial({
      color: 0x2f3841,
      metalness: 0.4,
      roughness: 0.3,
    })
  );
  monumentBase.position.y = 4;
  scene.add(monumentBase);

  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(3, 26, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd0d4dc,
      metalness: 0.8,
      roughness: 0.2,
    })
  );
  spire.position.y = 17;
  scene.add(spire);
}

function createWaterGarden() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  // Posisi water garden di dalam batas map
  // Ukuran: 140 x 32, jadi perlu space 70 x 16 dari center
  const waterWidth = 140;
  const waterDepth = 32;
  const waterX = Math.max(minExtent + waterWidth / 2, Math.min(maxExtent - waterWidth / 2, -90));
  const waterZ = Math.max(minExtent + waterDepth / 2, Math.min(maxExtent - waterDepth / 2, 130));
  
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(waterWidth, 2, waterDepth),
    new THREE.MeshStandardMaterial({
      color: 0x1a5f73,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.85,
    })
  );
  water.position.set(waterX, 1, waterZ);
  scene.add(water);

  // Tambahkan pohon di sekitar water garden, pastikan tidak melebihi batas
  for (let i = -60; i <= 60; i += 20) {
    const treeX = waterX - 60 + randSpread(10);
    const treeZ = waterZ + i;
    // Cek batas sebelum membuat tree
    if (treeX >= minExtent && treeX <= maxExtent && 
        treeZ >= minExtent && treeZ <= maxExtent) {
      createTree(treeX, 0, treeZ, true);
    }
  }
}

// Fungsi untuk membuat tree (dapat digunakan standalone atau dalam group)
function createTree(x, y, z, addToScene = true) {
  const treeGroup = new THREE.Group();
  
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.4, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a2f10, roughness: 0.9 })
  );
  trunk.position.set(0, 3, 0);
  trunk.castShadow = true;
  treeGroup.add(trunk);

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(randFloat(3.5, 4.5), randFloat(5, 7), 12),
    new THREE.MeshStandardMaterial({ color: 0x1f5b2c, roughness: 0.6 })
  );
  canopy.position.set(0, 8.5, 0);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  treeGroup.add(canopy);
  
  treeGroup.position.set(x, y, z);
  
  if (addToScene) {
    scene.add(treeGroup);
  }
  
  return treeGroup;
}

function createLinearPark() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  // Posisi linear park di dalam batas map
  // Ukuran: 40 x 220, jadi perlu space 20 x 110 dari center
  const parkWidth = 40;
  const parkDepth = 220;
  const parkX = Math.max(minExtent + parkWidth / 2, Math.min(maxExtent - parkWidth / 2, 120));
  const parkZ = Math.max(minExtent + parkDepth / 2, Math.min(maxExtent - parkDepth / 2, -40));
  
  const park = new THREE.Mesh(
    new THREE.PlaneGeometry(parkWidth, parkDepth),
    new THREE.MeshStandardMaterial({ color: 0x1b3a1a })
  );
  park.rotation.x = -Math.PI / 2;
  park.position.set(parkX, 0.04, parkZ);
  scene.add(park);

  // Tambahkan pohon di linear park, pastikan tidak melebihi batas
  for (let i = -90; i <= 90; i += 18) {
    const treeX = parkX + randSpread(10);
    const treeZ = parkZ + i;
    // Cek batas sebelum membuat tree
    if (treeX >= minExtent && treeX <= maxExtent && 
        treeZ >= minExtent && treeZ <= maxExtent) {
      createTree(treeX, 0, treeZ, true);
    }
  }
}

function createStreetLight(x, z, rotation = 0) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.35, 8, 12),
    new THREE.MeshStandardMaterial({
      color: 0x999999,
      metalness: 0.6,
      roughness: 0.4,
    })
  );
  pole.position.set(x, 4, z);
  pole.castShadow = true;
  scene.add(pole);

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.2, 0.2),
    new THREE.MeshStandardMaterial({
      color: 0xcad3df,
      metalness: 0.5,
      roughness: 0.3,
    })
  );
  arm.position.set(
    x + Math.sin(rotation) * 1.5,
    7,
    z + Math.cos(rotation) * 1.5
  );
  arm.rotation.y = rotation;
  scene.add(arm);

  const bulb = new THREE.PointLight(0xfff3c4, 0.28, 22);
  bulb.position.set(arm.position.x, 7, arm.position.z);
  scene.add(bulb);
}

function placeStreetLights() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  // Place street lights di dalam batas map
  for (let i = minExtent; i <= maxExtent; i += 36) {
    if (Math.abs(i) > CITY.mainRoadWidth + 20 && i % 72 !== 0) continue;
    
    // Pastikan posisi tidak melebihi batas
    if (CITY.mainRoadWidth >= minExtent && CITY.mainRoadWidth <= maxExtent && 
        i >= minExtent && i <= maxExtent) {
      createStreetLight(CITY.mainRoadWidth, i, Math.PI);
    }
    if (-CITY.mainRoadWidth >= minExtent && -CITY.mainRoadWidth <= maxExtent && 
        i >= minExtent && i <= maxExtent) {
      createStreetLight(-CITY.mainRoadWidth, i, 0);
    }
    if (Math.abs(i) < CITY.mainRoadWidth + 4) {
      if (i >= minExtent && i <= maxExtent && 
          CITY.mainRoadWidth >= minExtent && CITY.mainRoadWidth <= maxExtent) {
        createStreetLight(i, CITY.mainRoadWidth, -Math.PI / 2);
      }
      if (i >= minExtent && i <= maxExtent && 
          -CITY.mainRoadWidth >= minExtent && -CITY.mainRoadWidth <= maxExtent) {
        createStreetLight(i, -CITY.mainRoadWidth, Math.PI / 2);
      }
    }
  }
}

const ZONES = {
  civic: {
    colors: [0xdcdde1, 0xa7b0be, 0xbbc4d5],
    height: [22, 42],
    footprint: [16, 22],
    cluster: [1, 2],
    roughness: 0.4,
    metalness: 0.4,
  },
  commercial: {
    colors: [0x4d637a, 0x586f8f, 0x2f3640, 0x34495e],
    height: [35, 95],
    footprint: [12, 18],
    cluster: [2, 4],
    roughness: 0.55,
    metalness: 0.25,
  },
  residential: {
    colors: [0xcbb2a0, 0xd8c1ad, 0xa06b4d, 0xc58c5c],
    height: [12, 28],
    footprint: [10, 16],
    cluster: [2, 3],
    roughness: 0.8,
    metalness: 0.1,
  },
  industrial: {
    colors: [0x6b6b6b, 0x4a4a4a, 0x8c7b75, 0x555d60],
    height: [18, 40],
    footprint: [16, 28],
    cluster: [1, 2],
    roughness: 0.65,
    metalness: 0.2,
  },
};

function getZoneForPosition(x, z) {
  const distance = Math.hypot(x, z);
  if (distance < CITY.plazaRadius + 20) return "civic";
  if (distance < 150) return "commercial";
  if (distance < 220) return "residential";
  return "industrial";
}

// Fungsi untuk membuat building mesh dasar (dari sistem yang ada)
function createBuildingMesh(width, depth, height, color, roughness, metalness) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Fungsi untuk membuat Block building (dari Three.js-City)
// Block building terdiri dari beberapa box yang ditumpuk dengan variasi
function createBlockBuilding(width, depth, x, z) {
  const buildingGroup = new THREE.Group();
  const heights = [1, 0.8, 0.5]; // Proporsi tinggi untuk setiap level
  const totalLevels = heights.length;
  
  // Variasi warna untuk setiap level
  const levelColors = [
    0x4d637a, // Level bawah - lebih gelap
    0x586f8f, // Level tengah
    0x6b7fa0, // Level atas - lebih terang
  ];
  
  let currentY = 0;
  const baseHeight = randFloat(15, 35); // Tinggi dasar building
  
  for (let i = 0; i < totalLevels; i++) {
    // Setiap level memiliki variasi ukuran (80% dari parent dengan variasi 50-100%)
    const levelWidth = 0.8 * width * (0.5 + 0.5 * Math.random());
    const levelDepth = 0.8 * depth * (0.5 + 0.5 * Math.random());
    const levelHeight = baseHeight * heights[i] * (0.3 + 0.7 * Math.random());
    
    const level = createBuildingMesh(
      levelWidth,
      levelDepth,
      levelHeight,
      levelColors[i] || levelColors[0],
      0.55,
      0.25
    );
    
    level.position.set(
      (width - levelWidth) * 0.5,
      currentY + levelHeight / 2,
      (depth - levelDepth) * 0.5
    );
    
    buildingGroup.add(level);
    currentY += levelHeight;
  }
  
  buildingGroup.position.set(x, 0, z);
  return buildingGroup;
}

// Fungsi untuk membuat Classic building (dari Three.js-City)
// Classic building adalah building sederhana dengan satu box
function createClassicBuilding(width, depth, x, z) {
  const height = randFloat(20, 50);
  const color = ZONES.commercial.colors[randInt(0, ZONES.commercial.colors.length - 1)];
  
  const building = createBuildingMesh(
    width,
    depth,
    height,
    color,
    ZONES.commercial.roughness,
    ZONES.commercial.metalness
  );
  
  building.position.set(x, height / 2, z);
  return building;
}

// Fungsi untuk membuat RoundBlock building (dari Three.js-City)
// RoundBlock adalah building dengan bentuk silinder
function createRoundBlockBuilding(width, depth, x, z) {
  const height = randFloat(25, 60);
  const radius = Math.min(width, depth) * 0.4;
  const color = ZONES.civic.colors[randInt(0, ZONES.civic.colors.length - 1)];
  
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 16);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: ZONES.civic.roughness,
    metalness: ZONES.civic.metalness,
  });
  
  const building = new THREE.Mesh(geometry, material);
  building.castShadow = true;
  building.receiveShadow = true;
  building.position.set(x, height / 2, z);
  
  return building;
}

// Fungsi untuk membuat Park area (dari Three.js-City)
// Park adalah area hijau dengan beberapa pohon
function createParkBuilding(width, depth, x, z) {
  const parkGroup = new THREE.Group();
  
  // Ground park (area hijau)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x1b3a1a, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(x, 0.05, z);
  ground.receiveShadow = true;
  parkGroup.add(ground);
  
  // Tambahkan beberapa pohon di park
  const treeCount = Math.floor((width * depth) / 400); // 1 pohon per 400 unit area
  for (let i = 0; i < treeCount; i++) {
    const treeX = x + randSpread(width * 0.4);
    const treeZ = z + randSpread(depth * 0.4);
    const tree = createTree(treeX, 0, treeZ, false); // false = jangan add ke scene, add ke group
    parkGroup.add(tree);
  }
  
  return parkGroup;
}

// Fungsi untuk membuat grid system (dari Three.js-City)
// Grid system ini membuat pola jalan yang lebih dinamis dan tidak teratur
// Grid terpusat di tengah (0,0) dan mengisi seluruh area CITY.size
function createCityGrid() {
  const gridSize = CITY_GRID_SIZE;
  const rows = [];
  const cols = [];
  
  // Grid dimulai dari -CITY.size/2 dan berakhir di CITY.size/2
  // Konversi ke block unit coordinates
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  const startPos = minExtent / CITY.blockUnitSize;
  const endPos = maxExtent / CITY.blockUnitSize;
  
  // Inisialisasi grid dengan posisi awal (di batas kiri/bawah)
  rows[0] = cols[0] = startPos;
  
  // Generate grid dengan variasi jarak yang tidak teratur
  // Tapi memastikan grid terakhir mencapai atau mendekati endPos
  let currentRow = startPos;
  let currentCol = startPos;
  
  for (let i = 1; i < gridSize; i++) {
    // Jarak antar grid: 3-5 unit (dalam block unit size)
    // Untuk grid terakhir, pastikan mencapai endPos
    if (i === gridSize - 1) {
      rows[i] = endPos;
      cols[i] = endPos;
    } else {
      // Hitung jarak yang tersisa
      const remainingRows = endPos - currentRow;
      const remainingCols = endPos - currentCol;
      const remainingSteps = gridSize - i;
      
      // Rata-rata jarak per step
      const avgRowStep = remainingRows / remainingSteps;
      const avgColStep = remainingCols / remainingSteps;
      
      // Variasi jarak: 80%-120% dari rata-rata
      const rowStep = avgRowStep * (0.8 + Math.random() * 0.4);
      const colStep = avgColStep * (0.8 + Math.random() * 0.4);
      
      // Pastikan minimal 3 unit
      const minStep = 3;
      rows[i] = currentRow + Math.max(minStep, rowStep);
      cols[i] = currentCol + Math.max(minStep, colStep);
      
      // Pastikan tidak melebihi endPos
      rows[i] = Math.min(rows[i], endPos);
      cols[i] = Math.min(cols[i], endPos);
      
      currentRow = rows[i];
      currentCol = cols[i];
    }
  }
  
  // Pastikan grid terakhir tidak melebihi endPos
  rows[gridSize - 1] = Math.min(rows[gridSize - 1], endPos);
  cols[gridSize - 1] = Math.min(cols[gridSize - 1], endPos);
  
  cityGrid = { rows, cols };
  return cityGrid;
}

// Fungsi untuk membuat building blocks berdasarkan grid (dari Three.js-City)
function createBuildingBlocks() {
  const grid = createCityGrid();
  const models = ['Block', 'Classic', 'RoundBlock', 'Park'];
  // Probabilitas untuk setiap tipe building
  // [0, 0.7, 0.8, 0.9, 1] berarti:
  // - 0-0.7: Block (70%)
  // - 0.7-0.8: Classic (10%)
  // - 0.8-0.9: RoundBlock (10%)
  // - 0.9-1: Park (10%)
  const probability = [0, 0.7, 0.8, 0.9, 1];
  const max = [Infinity, Infinity, 2, 1]; // Maksimal jumlah untuk setiap tipe
  const current = [0, 0, 0, 0];
  
  const blockUnitSize = CITY.blockUnitSize;
  
  // Buat building di setiap cell grid
  for (let i = 0; i < grid.rows.length - 1; i++) {
    for (let j = 0; j < grid.cols.length - 1; j++) {
      // Hitung dimensi dan posisi building block
      const x1 = grid.cols[j] + 1;
      const z1 = grid.rows[i] + 1;
      const x2 = grid.cols[j + 1] - 1;
      const z2 = grid.rows[i + 1] - 1;
      
      const width = (x2 - x1 + 1) * blockUnitSize;
      const depth = (z2 - z1 + 1) * blockUnitSize;
      const posX = x1 * blockUnitSize + width * 0.5;
      const posZ = z1 * blockUnitSize + depth * 0.5;
      
      // Cek batas: pastikan building tidak melebihi CITY.size/2
      const halfWidth = width * 0.5;
      const halfDepth = depth * 0.5;
      const maxX = CITY.size / 2 - CITY.margin;
      const maxZ = CITY.size / 2 - CITY.margin;
      const minX = -CITY.size / 2 + CITY.margin;
      const minZ = -CITY.size / 2 + CITY.margin;
      
      // Skip jika building melebihi batas
      if (posX + halfWidth > maxX || posX - halfWidth < minX ||
          posZ + halfDepth > maxZ || posZ - halfDepth < minZ) {
        continue;
      }
      
      // Skip area plaza
      if (Math.abs(posX) < CITY.plazaRadius && Math.abs(posZ) < CITY.plazaRadius) {
        continue;
      }
      
      // Pilih tipe building berdasarkan probabilitas
      let selected = 0;
      let random = Math.random();
      for (let k = 0; k < probability.length - 1; k++) {
        if (random >= probability[k] && random <= probability[k + 1]) {
          selected = k;
          break;
        }
      }
      
      // Cek apakah sudah mencapai maksimal untuk tipe ini
      if (current[selected] >= max[selected]) {
        // Fallback ke Block jika sudah mencapai maksimal
        selected = 0;
      }
      
      current[selected]++;
      
      // Buat building sesuai tipe yang dipilih
      let building;
      switch (models[selected]) {
        case 'Block':
          building = createBlockBuilding(width, depth, posX, posZ);
          break;
        case 'Classic':
          building = createClassicBuilding(width, depth, posX, posZ);
          break;
        case 'RoundBlock':
          building = createRoundBlockBuilding(width, depth, posX, posZ);
          break;
        case 'Park':
          building = createParkBuilding(width, depth, posX, posZ);
          break;
        default:
          building = createClassicBuilding(width, depth, posX, posZ);
      }
      
      scene.add(building);
      buildings.push(building);
    }
  }
  
  return grid;
}

// Fungsi untuk populate city dengan sistem grid (dari Three.js-City)
// Fungsi ini menggabungkan grid system dengan sistem zone yang ada
function populateCity() {
  // Buat building blocks menggunakan grid system
  const grid = createBuildingBlocks();
  
  // Tambahkan building tambahan di area yang tidak ter-cover grid
  // untuk mengisi area kosong dengan density yang lebih rendah
  // Pastikan semua building tidak melebihi batas CITY.size/2
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  for (
    let x = minExtent + CITY.blockOffset;
    x <= maxExtent - CITY.blockOffset;
    x += CITY.blockSpacing
  ) {
    for (
      let z = minExtent + CITY.blockOffset;
      z <= maxExtent - CITY.blockOffset;
      z += CITY.blockSpacing
    ) {
      if (Math.abs(x) < CITY.plazaRadius && Math.abs(z) < CITY.plazaRadius)
        continue;
      
      // Skip jika sudah ada building di area ini (dari grid)
      let isInGrid = false;
      for (let i = 0; i < grid.rows.length - 1; i++) {
        for (let j = 0; j < grid.cols.length - 1; j++) {
          const centerX = (grid.cols[j] + grid.cols[j + 1]) * CITY.blockUnitSize * 0.5;
          const centerZ = (grid.rows[i] + grid.rows[i + 1]) * CITY.blockUnitSize * 0.5;
          const dist = Math.hypot(x - centerX, z - centerZ);
          if (dist < CITY.blockSpacing * 0.5) {
            isInGrid = true;
            break;
          }
        }
        if (isInGrid) break;
      }
      
      if (isInGrid) continue;
      if (Math.random() > CITY.density * 0.3) continue; // Density lebih rendah untuk fill-in

      const zone = ZONES[getZoneForPosition(x, z)];
      const width = randFloat(zone.footprint[0], zone.footprint[1]);
      const depth = randFloat(zone.footprint[0], zone.footprint[1]);
      const height = randFloat(zone.height[0], zone.height[1]) * 0.9;
      const color = zone.colors[randInt(0, zone.colors.length - 1)];
      
      // Hitung posisi dengan variasi
      const offsetX = randSpread(CITY.blockSpacing * 0.35);
      const offsetZ = randSpread(CITY.blockSpacing * 0.35);
      const posX = x + offsetX;
      const posZ = z + offsetZ;
      
      // Cek batas: pastikan building tidak melebihi CITY.size/2
      const halfWidth = width * 0.5;
      const halfDepth = depth * 0.5;
      if (posX + halfWidth > maxExtent || posX - halfWidth < minExtent ||
          posZ + halfDepth > maxExtent || posZ - halfDepth < minExtent) {
        continue; // Skip building yang melebihi batas
      }
      
      const building = createBuildingMesh(
        width,
        depth,
        height,
        color,
        zone.roughness,
        zone.metalness
      );

      building.position.set(posX, height / 2, posZ);
      scene.add(building);
      buildings.push(building);
    }
  }
}

function createTransitHub() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  // Posisi transit hub di dalam batas map
  // Ukuran: 70 x 30, jadi perlu space 35 x 15 dari center
  const hubWidth = 70;
  const hubDepth = 30;
  const hubX = Math.max(minExtent + hubWidth / 2, Math.min(maxExtent - hubWidth / 2, 150));
  const hubZ = Math.max(minExtent + hubDepth / 2, Math.min(maxExtent - hubDepth / 2, 110));
  
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(hubWidth, 6, hubDepth),
    new THREE.MeshStandardMaterial({
      color: 0x2d3439,
      metalness: 0.3,
      roughness: 0.4,
    })
  );
  base.position.set(hubX, 3, hubZ);
  base.castShadow = true;
  scene.add(base);

  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 35, 18, 4, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x9db6ca,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    })
  );
  roof.rotation.z = Math.PI / 2;
  roof.position.set(hubX, 15, hubZ);
  scene.add(roof);
}

// Fungsi untuk scatter details (dari Three.js-City)
// Urutan penting: ground dulu, lalu roads, lalu buildings
function scatterDetails() {
  createGroundLayers();
  // Road network dibuat setelah ground tapi sebelum buildings
  // karena populateCity akan membuat grid yang digunakan untuk roads
  createRoundabout();
  createWaterGarden();
  createLinearPark();
  placeStreetLights();
  createTransitHub();
  // Populate city akan membuat grid dan buildings
  // buildRoadNetwork akan dipanggil setelah populateCity jika menggunakan grid
  populateCity();
  // Build road network setelah populateCity agar bisa menggunakan grid
  buildRoadNetwork();
}

scatterDetails();

// --- CAR ---
let car;
let steeringWheel = null;

// Fungsi untuk memuat model car dengan error handling yang lebih baik
function loadCarModel() {
  // Gunakan path relatif yang benar berdasarkan lokasi file
  const carPath = "./assets/car.glb";
  
  loader.load(
    carPath,
    (gltf) => {
      try {
        car = gltf.scene;
        car.scale.set(2, 2, 2);
        car.position.set(-12, 0, -140);
        car.rotation.y = Math.PI;
        car.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
          }
          // Coba deteksi mesh setir berdasarkan nama
          if (!steeringWheel && child.name) {
            const n = child.name.toLowerCase();
            if (
              n.includes("steer") ||
              n.includes("wheel_steer") ||
              n.includes("steering")
            ) {
              steeringWheel = child;
            }
          }
        });
        scene.add(car);
        isCarLoaded = true;
        
        // Langsung set posisi kamera ke mobil saat car dimuat
        // Gunakan offset third person sebagai default (akan diupdate oleh updateCamera nanti)
        const initialOffset = new THREE.Vector3(0, 5, -10);
        initialOffset.applyQuaternion(car.quaternion);
        const desiredPosition = car.position.clone().add(initialOffset);
        camera.position.copy(desiredPosition);
        camera.lookAt(car.position);
        
        checkSceneReady();
        console.log("Car model loaded successfully");
      } catch (error) {
        console.error("Error processing car model:", error);
        isCarLoaded = true; // Set true untuk mencegah infinite loading
        checkSceneReady();
      }
    },
    (progress) => {
      // Progress callback untuk tracking loading
      if (progress.total > 0) {
        const percent = (progress.loaded / progress.total) * 100;
        console.log(`Loading car model: ${percent.toFixed(0)}%`);
      }
    },
    (error) => {
      console.error("Failed to load car model:", error);
      console.error("Attempted path:", carPath);
      // Tetap set isCarLoaded untuk mencegah infinite loading
      isCarLoaded = true;
      checkSceneReady();
    }
  );
}

// Fungsi untuk memeriksa apakah scene sudah siap
function checkSceneReady() {
  if (isCarLoaded && !isSceneReady) {
    isSceneReady = true;
    console.log("Scene is ready, starting animation");
  }
}

// Mulai memuat model car
loadCarModel();

// --- PARK ---
// Catatan: File gardening._park._landscape.13.glb tidak tersedia
// Kode ini di-comment untuk menghindari error 404
// Jika file park model tersedia di masa depan, uncomment kode di bawah ini
/*
loader.load(
  "assets/gardening._park._landscape.13.glb",
  (gltf) => {
    const park = gltf.scene;

    // Scale and position the model
    park.scale.set(20, 20, 20);
    park.position.set(60, 0, 60); // Position it in one of the city blocks

    park.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(park);
  },
  undefined,
  (error) => {
    console.warn("Park model tidak tersedia, melanjutkan tanpa park model:", error);
  }
);
*/

// --- CONTROLS ---
const keyboardState = {};
const CAMERA_MODES = ["third", "first", "top"];
const CAMERA_LABELS = {
  third: "Third Person",
  first: "First Person",
  top: "Top Down",
};
let currentCameraMode = CAMERA_MODES[0];
const cameraOffsets = {
  third: new THREE.Vector3(0, 5, -10),
  // First-person: sedikit mundur ke belakang agar setir & dashboard
  // lebih banyak kelihatan (tampilan kokpit lebih luas)
  first: new THREE.Vector3(0, 1.55, -0.8),
  top: new THREE.Vector3(0, 80, 0.2),
};

const cameraButton = document.getElementById("camera-toggle");

function updateCameraButtonLabel() {
  if (cameraButton) {
    cameraButton.textContent = `Camera: ${CAMERA_LABELS[currentCameraMode]}`;
  }
}

function cycleCameraMode() {
  const currentIndex = CAMERA_MODES.indexOf(currentCameraMode);
  currentCameraMode = CAMERA_MODES[(currentIndex + 1) % CAMERA_MODES.length];
  updateCameraButtonLabel();
}

window.addEventListener("keydown", (e) => {
  // Cegah aksi default browser (scroll, fokus tombol, dll)
  // agar kombinasi tombol (maju + belok) tetap responsif
  const movementKeys = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
  ];

  if (movementKeys.includes(e.code)) {
    e.preventDefault();
  }

  if (e.code === "KeyC") {
    cycleCameraMode();
    return;
  }

  keyboardState[e.code] = true;
});
window.addEventListener("keyup", (e) => (keyboardState[e.code] = false));

if (cameraButton) {
  cameraButton.addEventListener("click", () => {
    cycleCameraMode();
  });
  updateCameraButtonLabel();
}

const speed = 0.4; // Slightly increased speed
const rotationSpeed = 0.04;
let steeringVisualAngle = 0; // derajat semu untuk animasi setir
let isFirstCameraFrame = true; // Flag untuk menandai frame pertama kamera

function updateCar() {
  if (!car) return;

  const movingForward = keyboardState["ArrowUp"] || keyboardState["KeyW"];
  const movingBackward = keyboardState["ArrowDown"] || keyboardState["KeyS"];
  const isMoving = movingForward || movingBackward;

  if (movingForward) {
    car.position.x += Math.sin(car.rotation.y) * speed;
    car.position.z += Math.cos(car.rotation.y) * speed;
  }
  if (movingBackward) {
    car.position.x -= Math.sin(car.rotation.y) * speed * 0.5;
    car.position.z -= Math.cos(car.rotation.y) * speed * 0.5;
  }

  // Hanya boleh belok ketika mobil sedang bergerak (maju atau mundur)
  if (isMoving) {
    if (keyboardState["ArrowLeft"] || keyboardState["KeyA"]) {
      car.rotation.y += rotationSpeed;
      steeringVisualAngle = THREE.MathUtils.clamp(
        steeringVisualAngle + 3,
        -45,
        45
      );
    }
    if (keyboardState["ArrowRight"] || keyboardState["KeyD"]) {
      car.rotation.y -= rotationSpeed;
      steeringVisualAngle = THREE.MathUtils.clamp(
        steeringVisualAngle - 3,
        -45,
        45
      );
    }
  }

  // Perlahan kembalikan setir ke tengah jika tidak membelok
  if (
    !keyboardState["ArrowLeft"] &&
    !keyboardState["KeyA"] &&
    !keyboardState["ArrowRight"] &&
    !keyboardState["KeyD"]
  ) {
    steeringVisualAngle *= 0.85;
    if (Math.abs(steeringVisualAngle) < 0.1) steeringVisualAngle = 0;
  }

  // Terapkan rotasi ke mesh setir (jika ditemukan)
  if (steeringWheel) {
    // Balik arah rotasi agar kiri/kanan sesuai dengan belokan mobil
    steeringWheel.rotation.y = -THREE.MathUtils.degToRad(steeringVisualAngle);
  }
}

// --- CAMERA ---
function updateCamera() {
  if (!car) return;

  if (currentCameraMode === "top") {
    const offset = cameraOffsets.top.clone();
    const desiredTopPosition = new THREE.Vector3(
      car.position.x + offset.x,
      car.position.y + offset.y,
      car.position.z + offset.z
    );
    
    if (isFirstCameraFrame) {
      // Frame pertama: langsung set posisi tanpa zoom
      camera.position.copy(desiredTopPosition);
      isFirstCameraFrame = false;
    } else {
      camera.position.lerp(desiredTopPosition, 0.15);
    }
    
    const lookTarget = car.position.clone();
    lookTarget.y += 0.5;
    camera.lookAt(lookTarget);
    return;
  }

  const baseOffset = cameraOffsets[currentCameraMode].clone();
  baseOffset.applyQuaternion(car.quaternion);
  const desiredPosition = car.position.clone().add(baseOffset);
  const lerpSpeed = 0.12;

  if (currentCameraMode === "first") {
    // Di mode first-person, kamera "menempel" ke interior mobil:
    // tidak ada lerp sehingga tidak terasa maju–mundur relatif ke dashboard.
    camera.position.copy(desiredPosition);

    const forward = new THREE.Vector3(0, 0.05, 10);
    forward.applyQuaternion(car.quaternion);
    camera.lookAt(car.position.clone().add(forward));
    
    if (isFirstCameraFrame) {
      isFirstCameraFrame = false;
    }
  } else {
    // Mode third-person
    if (isFirstCameraFrame) {
      // Frame pertama: langsung set posisi tanpa zoom
      camera.position.copy(desiredPosition);
      isFirstCameraFrame = false;
    } else {
      // Setelah frame pertama, gunakan lerp untuk smooth follow
      camera.position.lerp(desiredPosition, lerpSpeed);
    }
    camera.lookAt(car.position);
  }
}

// --- RESIZE ---
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);
  
  // Hanya render dan update jika car sudah dimuat
  if (car && isSceneReady) {
    updateCar();
    updateCamera();
    renderer.render(scene, camera);
  }
  // Tidak render apapun sampai car dimuat
}

// Mulai animasi loop
animate();
