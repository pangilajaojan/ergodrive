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

// Set untuk tracking posisi jalan yang sudah dibuat (untuk menghindari duplikasi)
const roadPositions = new Set();

function createRoad(length, width, x, z, rotationY = 0, color = 0x2a2a2a) {
  // Validasi input untuk mencegah bug
  if (!isFinite(length) || !isFinite(width) || !isFinite(x) || !isFinite(z) || length <= 0 || width <= 0) {
    console.warn('Invalid road parameters:', { length, width, x, z });
    return null;
  }
  
  // Overlap minimal untuk menghindari gap (2% dari width - lebih kecil untuk lebih rapi)
  const overlap = width * 0.02;
  const adjustedLength = length + overlap * 2;
  const adjustedWidth = width + overlap * 2;
  
  // Buat key unik untuk tracking (dengan toleransi)
  const key = `${Math.round(x * 10) / 10},${Math.round(z * 10) / 10},${Math.round(rotationY * 100) / 100}`;
  if (roadPositions.has(key)) {
    // Skip jika jalan sudah ada di posisi ini (menghindari duplikasi)
    return null;
  }
  roadPositions.add(key);
  
  // Material jalan yang lebih baik dan realistis
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.95, // Lebih kasar untuk tampilan aspal yang realistis
    metalness: 0.0, // Tidak metalik
    flatShading: false, // Smooth shading
  });
  
  const roadGeometry = new THREE.PlaneGeometry(adjustedWidth, adjustedLength);
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, 0.03, z);
  road.rotation.y = rotationY;
  road.receiveShadow = true;
  road.castShadow = false; // Jalan tidak perlu cast shadow
  scene.add(road);
  
  // Tambahkan sidewalk (trotoar) di pinggir jalan untuk tampilan yang lebih rapi
  const sidewalkWidth = 1.8; // Lebar trotoar (sedikit lebih kecil untuk lebih rapi)
  const sidewalkHeight = 0.05; // Tinggi trotoar (sedikit di atas jalan)
  const sidewalkMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a5a5a, // Abu-abu terang untuk trotoar
    roughness: 0.85,
    metalness: 0.1,
  });
  
  // Tentukan apakah jalan horizontal atau vertical
  const isHorizontal = Math.abs(rotationY) < 0.1 || Math.abs(rotationY - Math.PI) < 0.1;
  
  if (isHorizontal) {
    // Sidewalk kiri (utara)
    const sidewalkLeft = new THREE.Mesh(
      new THREE.PlaneGeometry(sidewalkWidth, adjustedLength),
      sidewalkMaterial
    );
    sidewalkLeft.rotation.x = -Math.PI / 2;
    sidewalkLeft.position.set(x - adjustedWidth / 2 - sidewalkWidth / 2, sidewalkHeight, z);
    sidewalkLeft.receiveShadow = true;
    scene.add(sidewalkLeft);
    
    // Sidewalk kanan (selatan)
    const sidewalkRight = new THREE.Mesh(
      new THREE.PlaneGeometry(sidewalkWidth, adjustedLength),
      sidewalkMaterial
    );
    sidewalkRight.rotation.x = -Math.PI / 2;
    sidewalkRight.position.set(x + adjustedWidth / 2 + sidewalkWidth / 2, sidewalkHeight, z);
    sidewalkRight.receiveShadow = true;
    scene.add(sidewalkRight);
  } else {
    // Sidewalk atas (barat)
    const sidewalkTop = new THREE.Mesh(
      new THREE.PlaneGeometry(adjustedLength, sidewalkWidth),
      sidewalkMaterial
    );
    sidewalkTop.rotation.x = -Math.PI / 2;
    sidewalkTop.position.set(x, sidewalkHeight, z - adjustedWidth / 2 - sidewalkWidth / 2);
    sidewalkTop.receiveShadow = true;
    scene.add(sidewalkTop);
    
    // Sidewalk bawah (timur)
    const sidewalkBottom = new THREE.Mesh(
      new THREE.PlaneGeometry(adjustedLength, sidewalkWidth),
      sidewalkMaterial
    );
    sidewalkBottom.rotation.x = -Math.PI / 2;
    sidewalkBottom.position.set(x, sidewalkHeight, z + adjustedWidth / 2 + sidewalkWidth / 2);
    sidewalkBottom.receiveShadow = true;
    scene.add(sidewalkBottom);
  }
  
  // Tambahkan marka jalan untuk jalan yang cukup lebar
  if (width >= 8) {
    createLaneMarkings(length, width, x, z, rotationY);
  }
  
  return road;
}

// Fungsi untuk membuat marka jalan yang rapi dan konsisten
// length: panjang jalan
// width: lebar jalan
// x, z: posisi jalan
// rotationY: rotasi jalan (0 = horizontal, Math.PI/2 = vertical)
function createLaneMarkings(length, width, x, z, rotationY = 0) {
  const markingHeight = 0.05; // Tinggi marka jalan (sedikit di atas jalan)
  const centerLineWidth = 0.25; // Lebar garis tengah (sedikit lebih tipis untuk lebih rapi)
  const edgeLineWidth = 0.2; // Lebar garis pinggir (konsisten)
  const markingColor = 0xffffff; // Warna putih untuk marka jalan
  
  // Material untuk marka jalan putih dengan glow yang lebih halus
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: markingColor,
    roughness: 0.15,
    metalness: 0.0,
    emissive: 0x444444, // Glow lebih halus
    emissiveIntensity: 0.7,
  });
  
  // Center line kuning (untuk jalan 2 arah) - lebih rapi
  const centerLineMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd700, // Kuning untuk center line
    roughness: 0.15,
    metalness: 0.0,
    emissive: 0x553300, // Glow lebih halus
    emissiveIntensity: 0.6,
  });
  
  // Tentukan apakah jalan horizontal atau vertical
  const isHorizontal = Math.abs(rotationY) < 0.1 || Math.abs(rotationY - Math.PI) < 0.1;
  
  // Parameter marka yang lebih rapi dan konsisten
  const dashLength = 4; // Panjang dash (sedikit lebih panjang untuk lebih rapi)
  const dashGap = 3; // Jarak antar dash (lebih konsisten)
  
  // Parameter untuk deteksi intersection (untuk skip marka kuning di intersection)
  const roadSpacing = 80; // Harus sama dengan di createNewRoadNetwork
  const maxRoadWidth = 18; // Harus sama dengan di createNewRoadNetwork
  const intersectionRadius = maxRoadWidth / 2 + 3; // Radius area intersection untuk skip marka kuning
  
  if (isHorizontal) {
    // Jalan horizontal - marka di tengah (garis putus-putus kuning yang rapi)
    // SKIP marka kuning di area intersection (kotak abu-abu)
    const numDashes = Math.floor(length / (dashLength + dashGap));
    const totalMarkingLength = numDashes * (dashLength + dashGap) - dashGap;
    const startOffset = -(totalMarkingLength / 2) + dashLength / 2;
    
    for (let i = 0; i < numDashes; i++) {
      const dashZ = startOffset + i * (dashLength + dashGap);
      const dashX = x;
      const dashZPos = z + dashZ;
      
      // Cek apakah dash berada di area intersection - SKIP jika ya
      let isInIntersectionArea = false;
      for (let h = -CITY.size / 2; h <= CITY.size / 2; h += roadSpacing) {
        if (Math.abs(h) < CITY.plazaRadius + 15) continue;
        for (let v = -CITY.size / 2; v <= CITY.size / 2; v += roadSpacing) {
          if (Math.abs(v) < CITY.plazaRadius + 15) continue;
          const distanceToIntersection = Math.hypot(dashX - v, dashZPos - h);
          if (distanceToIntersection < intersectionRadius) {
            isInIntersectionArea = true;
            break;
          }
        }
        if (isInIntersectionArea) break;
      }
      
      // Hanya buat dash kuning jika TIDAK berada di area intersection
      if (!isInIntersectionArea) {
        const dashGeometry = new THREE.PlaneGeometry(centerLineWidth, dashLength);
        const dash = new THREE.Mesh(dashGeometry, centerLineMaterial);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x, markingHeight, z + dashZ);
        scene.add(dash);
      }
    }
    
    // Marka pinggir kiri dan kanan (garis solid putih yang rapi)
    const leftEdge = new THREE.Mesh(
      new THREE.PlaneGeometry(edgeLineWidth, length),
      markingMaterial
    );
    leftEdge.rotation.x = -Math.PI / 2;
    leftEdge.position.set(x - width / 2 + edgeLineWidth / 2, markingHeight, z);
    scene.add(leftEdge);
    
    const rightEdge = new THREE.Mesh(
      new THREE.PlaneGeometry(edgeLineWidth, length),
      markingMaterial
    );
    rightEdge.rotation.x = -Math.PI / 2;
    rightEdge.position.set(x + width / 2 - edgeLineWidth / 2, markingHeight, z);
    scene.add(rightEdge);
  } else {
    // Jalan vertical - marka di tengah (garis putus-putus kuning yang rapi)
    // SKIP marka kuning di area intersection (kotak abu-abu)
    const numDashes = Math.floor(length / (dashLength + dashGap));
    const totalMarkingLength = numDashes * (dashLength + dashGap) - dashGap;
    const startOffset = -(totalMarkingLength / 2) + dashLength / 2;
    
    for (let i = 0; i < numDashes; i++) {
      const dashX = startOffset + i * (dashLength + dashGap);
      const dashXPos = x + dashX;
      const dashZ = z;
      
      // Cek apakah dash berada di area intersection - SKIP jika ya
      let isInIntersectionArea = false;
      for (let h = -CITY.size / 2; h <= CITY.size / 2; h += roadSpacing) {
        if (Math.abs(h) < CITY.plazaRadius + 15) continue;
        for (let v = -CITY.size / 2; v <= CITY.size / 2; v += roadSpacing) {
          if (Math.abs(v) < CITY.plazaRadius + 15) continue;
          const distanceToIntersection = Math.hypot(dashXPos - v, dashZ - h);
          if (distanceToIntersection < intersectionRadius) {
            isInIntersectionArea = true;
            break;
          }
        }
        if (isInIntersectionArea) break;
      }
      
      // Hanya buat dash kuning jika TIDAK berada di area intersection
      if (!isInIntersectionArea) {
        const dashGeometry = new THREE.PlaneGeometry(dashLength, centerLineWidth);
        const dash = new THREE.Mesh(dashGeometry, centerLineMaterial);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = Math.PI / 2;
        dash.position.set(x + dashX, markingHeight, z);
        scene.add(dash);
      }
    }
    
    // Marka pinggir atas dan bawah (garis solid putih yang rapi)
    const topEdge = new THREE.Mesh(
      new THREE.PlaneGeometry(length, edgeLineWidth),
      markingMaterial
    );
    topEdge.rotation.x = -Math.PI / 2;
    topEdge.position.set(x, markingHeight, z - width / 2 + edgeLineWidth / 2);
    scene.add(topEdge);
    
    const bottomEdge = new THREE.Mesh(
      new THREE.PlaneGeometry(length, edgeLineWidth),
      markingMaterial
    );
    bottomEdge.rotation.x = -Math.PI / 2;
    bottomEdge.position.set(x, markingHeight, z + width / 2 - edgeLineWidth / 2);
    scene.add(bottomEdge);
  }
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

      // Marka jalan dihapus sesuai permintaan
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

// Fungsi untuk mengecek apakah area overlap dengan jalan
function isOverlappingWithRoad(centerX, centerZ, width, depth, roadSpacing, maxRoadWidth) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const roadHalfWidth = maxRoadWidth / 2 + 2; // Termasuk sidewalk
  
  // Cek overlap dengan jalan horizontal (z = 0, ±roadSpacing, ±2*roadSpacing, dll)
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue; // Skip area plaza
    const roadZ = i;
    // Cek apakah area air overlap dengan jalan horizontal
    if (Math.abs(centerZ - roadZ) < (halfDepth + roadHalfWidth)) {
      return true; // Overlap dengan jalan horizontal
    }
  }
  
  // Cek overlap dengan jalan vertikal (x = 0, ±roadSpacing, ±2*roadSpacing, dll)
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue; // Skip area plaza
    const roadX = i;
    // Cek apakah area air overlap dengan jalan vertikal
    if (Math.abs(centerX - roadX) < (halfWidth + roadHalfWidth)) {
      return true; // Overlap dengan jalan vertikal
    }
  }
  
  return false;
}

function createWaterGarden() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  // Posisi water garden dipindahkan ke kiri (lebih negatif)
  // Ukuran: 140 x 32, jadi perlu space 70 x 16 dari center
  const waterWidth = 140;
  const waterDepth = 32;
  const roadSpacing = 60; // Harus sama dengan di createNewRoadNetwork
  const maxRoadWidth = 18; // Harus sama dengan di createNewRoadNetwork
  
  // Cari posisi yang tidak overlap dengan jalan
  let waterX = -160; // Posisi awal (ke kiri)
  let waterZ = 130; // Posisi awal
  
  // Cek dan sesuaikan posisi agar tidak overlap dengan jalan
  // Coba beberapa posisi alternatif jika overlap
  const candidatePositions = [
    { x: -160, z: 130 },
    { x: -150, z: 120 },
    { x: -150, z: 140 },
    { x: -170, z: 120 },
    { x: -170, z: 140 },
    { x: -140, z: 120 },
    { x: -140, z: 140 },
  ];
  
  let foundPosition = false;
  for (const pos of candidatePositions) {
    if (!isOverlappingWithRoad(pos.x, pos.z, waterWidth, waterDepth, roadSpacing, maxRoadWidth)) {
      waterX = pos.x;
      waterZ = pos.z;
      foundPosition = true;
      break;
    }
  }
  
  // Jika masih overlap, cari posisi yang aman secara manual
  if (!foundPosition) {
    // Cari posisi di antara grid jalan
    for (let x = minExtent + waterWidth / 2; x <= maxExtent - waterWidth / 2; x += 10) {
      for (let z = minExtent + waterDepth / 2; z <= maxExtent - waterDepth / 2; z += 10) {
        if (Math.abs(x) < CITY.plazaRadius + 20) continue;
        if (!isOverlappingWithRoad(x, z, waterWidth, waterDepth, roadSpacing, maxRoadWidth)) {
          waterX = x;
          waterZ = z;
          foundPosition = true;
          break;
        }
      }
      if (foundPosition) break;
    }
  }
  
  // Pastikan posisi dalam batas
  waterX = Math.max(minExtent + waterWidth / 2, Math.min(maxExtent - waterWidth / 2, waterX));
  waterZ = Math.max(minExtent + waterDepth / 2, Math.min(maxExtent - waterDepth / 2, waterZ));
  
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

  // Tambahkan pembatas/penanda di sekeliling air
  const barrierHeight = 0.5; // Tinggi pembatas
  const barrierWidth = 0.15; // Lebar pembatas
  const barrierSpacing = 3; // Jarak antar tiang pembatas
  const barrierColor = 0xffd700; // Warna kuning untuk pembatas (terlihat jelas)
  const barrierMaterial = new THREE.MeshStandardMaterial({
    color: barrierColor,
    metalness: 0.3,
    roughness: 0.4,
    emissive: 0x332200, // Sedikit glow
    emissiveIntensity: 0.3,
  });
  
  // Pembatas di sisi kiri (barat)
  const leftBarrierLength = waterDepth;
  const numLeftPoles = Math.floor(leftBarrierLength / barrierSpacing);
  for (let i = 0; i <= numLeftPoles; i++) {
    const poleZ = waterZ - waterDepth / 2 + (i * barrierSpacing);
    if (poleZ > waterZ + waterDepth / 2) break;
    
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(barrierWidth / 2, barrierWidth / 2, barrierHeight, 8),
      barrierMaterial
    );
    pole.position.set(waterX - waterWidth / 2 - 0.5, barrierHeight / 2, poleZ);
    scene.add(pole);
    
    // Tambahkan bar horizontal di antara tiang
    if (i < numLeftPoles) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(barrierWidth, barrierWidth * 0.3, barrierSpacing),
        barrierMaterial
      );
      bar.position.set(waterX - waterWidth / 2 - 0.5, barrierHeight * 0.7, poleZ + barrierSpacing / 2);
      scene.add(bar);
    }
  }
  
  // Pembatas di sisi kanan (timur)
  const rightBarrierLength = waterDepth;
  const numRightPoles = Math.floor(rightBarrierLength / barrierSpacing);
  for (let i = 0; i <= numRightPoles; i++) {
    const poleZ = waterZ - waterDepth / 2 + (i * barrierSpacing);
    if (poleZ > waterZ + waterDepth / 2) break;
    
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(barrierWidth / 2, barrierWidth / 2, barrierHeight, 8),
      barrierMaterial
    );
    pole.position.set(waterX + waterWidth / 2 + 0.5, barrierHeight / 2, poleZ);
    scene.add(pole);
    
    // Tambahkan bar horizontal di antara tiang
    if (i < numRightPoles) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(barrierWidth, barrierWidth * 0.3, barrierSpacing),
        barrierMaterial
      );
      bar.position.set(waterX + waterWidth / 2 + 0.5, barrierHeight * 0.7, poleZ + barrierSpacing / 2);
      scene.add(bar);
    }
  }
  
  // Pembatas di sisi depan (utara)
  const frontBarrierLength = waterWidth;
  const numFrontPoles = Math.floor(frontBarrierLength / barrierSpacing);
  for (let i = 0; i <= numFrontPoles; i++) {
    const poleX = waterX - waterWidth / 2 + (i * barrierSpacing);
    if (poleX > waterX + waterWidth / 2) break;
    
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(barrierWidth / 2, barrierWidth / 2, barrierHeight, 8),
      barrierMaterial
    );
    pole.position.set(poleX, barrierHeight / 2, waterZ - waterDepth / 2 - 0.5);
    scene.add(pole);
    
    // Tambahkan bar horizontal di antara tiang
    if (i < numFrontPoles) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(barrierSpacing, barrierWidth * 0.3, barrierWidth),
        barrierMaterial
      );
      bar.position.set(poleX + barrierSpacing / 2, barrierHeight * 0.7, waterZ - waterDepth / 2 - 0.5);
      scene.add(bar);
    }
  }
  
  // Pembatas di sisi belakang (selatan)
  const backBarrierLength = waterWidth;
  const numBackPoles = Math.floor(backBarrierLength / barrierSpacing);
  for (let i = 0; i <= numBackPoles; i++) {
    const poleX = waterX - waterWidth / 2 + (i * barrierSpacing);
    if (poleX > waterX + waterWidth / 2) break;
    
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(barrierWidth / 2, barrierWidth / 2, barrierHeight, 8),
      barrierMaterial
    );
    pole.position.set(poleX, barrierHeight / 2, waterZ + waterDepth / 2 + 0.5);
    scene.add(pole);
    
    // Tambahkan bar horizontal di antara tiang
    if (i < numBackPoles) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(barrierSpacing, barrierWidth * 0.3, barrierWidth),
        barrierMaterial
      );
      bar.position.set(poleX + barrierSpacing / 2, barrierHeight * 0.7, waterZ + waterDepth / 2 + 0.5);
      scene.add(bar);
    }
  }

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

  // Kurangi jumlah pohon di linear park (pohon akan dibuat terpencar di tempat lain)
  // Hanya tambahkan beberapa pohon untuk dekorasi
  for (let i = -90; i <= 90; i += 45) {
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

// Fungsi untuk menghapus semua gedung yang ada
function removeAllBuildings() {
  // Hapus semua building dari scene
  buildings.forEach(building => {
    if (building.parent) {
      building.parent.remove(building);
    } else {
      scene.remove(building);
    }
    // Dispose geometry dan material untuk menghemat memori
    building.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  });
  // Clear buildings array
  buildings.length = 0;
  console.log('All buildings removed');
}

// Palet warna cerah dan menarik untuk bangunan
const BUILDING_COLORS = [
  0x3498db, // Biru cerah
  0xe74c3c, // Merah cerah
  0x2ecc71, // Hijau cerah
  0xf39c12, // Orange cerah
  0x9b59b6, // Ungu cerah
  0x1abc9c, // Turquoise
  0xe67e22, // Orange gelap
  0x34495e, // Biru abu-abu
  0x16a085, // Hijau gelap
  0xc0392b, // Merah gelap
  0x8e44ad, // Ungu gelap
  0x27ae60, // Hijau muda
  0x2980b9, // Biru tua
  0xd35400, // Orange tua
  0x7f8c8d, // Abu-abu
];

// Fungsi untuk membuat gedung modern baru yang lebih bagus dan berwarna
function createModernBuilding(width, depth, x, z) {
  const buildingGroup = new THREE.Group();
  const height = randFloat(12, 25); // Dikurangi dari 30-80 menjadi 12-25
  
  // Pilih warna acak dari palet warna
  const baseColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  const accentColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  
  // Base building dengan desain modern dan warna cerah
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.4,
      metalness: 0.3,
    })
  );
  base.position.set(0, height / 2, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);
  
  // Tambahkan aksen warna di bagian bawah (ground floor)
  const groundFloor = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.02, height * 0.15, depth * 1.02),
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.5,
      metalness: 0.2,
    })
  );
  groundFloor.position.set(0, height * 0.075, 0);
  buildingGroup.add(groundFloor);
  
  // Tambahkan horizontal bands (garis horizontal) untuk detail arsitektur
  const numBands = Math.floor(height / 8);
  for (let i = 1; i < numBands; i++) {
    const bandHeight = height * 0.02;
    const bandY = (i * height) / numBands;
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.01, bandHeight, depth * 1.01),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.6,
        metalness: 0.4,
      })
    );
    band.position.set(0, bandY, 0);
    buildingGroup.add(band);
  }
  
  // Tambahkan jendela-jendela dengan variasi warna dan detail
  const windowCount = Math.floor(width / 3.5);
  const windowDepth = Math.floor(depth / 3.5);
  const windowSpacing = height / (Math.floor(height / 4) + 1);
  
  // Variasi warna jendela (kuning/orange untuk lampu menyala)
  const windowColors = [
    0xffd700, // Emas (lampu menyala)
    0xffa500, // Orange (lampu menyala)
    0xffeb3b, // Kuning (lampu menyala)
    0x1a1a2e, // Biru gelap (lampu mati)
    0x0a0e27, // Hitam (lampu mati)
  ];
  
  for (let i = 0; i < windowCount; i++) {
    for (let j = 0; j < windowDepth; j++) {
      for (let k = 1; k < Math.floor(height / windowSpacing); k++) {
        if (randFloat() > 0.4) continue; // 60% jendela terisi
        
        const windowY = k * windowSpacing;
        const windowHeight = windowSpacing * 0.6;
        const windowWidth = (width / windowCount) * 0.7;
        
        // Pilih warna jendela (70% menyala, 30% mati)
        const isLit = randFloat() > 0.3;
        const windowColor = isLit 
          ? windowColors[randInt(0, 2)] 
          : windowColors[randInt(3, 4)];
        
        const windowMaterial = new THREE.MeshStandardMaterial({
          color: windowColor,
          roughness: 0.1,
          metalness: 0.9,
          emissive: isLit ? windowColor : 0x000000,
          emissiveIntensity: isLit ? 0.8 : 0,
        });
        
        // Jendela di depan
        const windowFront = new THREE.Mesh(
          new THREE.PlaneGeometry(windowWidth, windowHeight),
          windowMaterial
        );
        windowFront.position.set(
          -width / 2 + (i + 0.5) * (width / windowCount),
          windowY,
          depth / 2 + 0.1
        );
        buildingGroup.add(windowFront);
        
        // Jendela di belakang (50% chance)
        if (randFloat() > 0.5) {
          const windowBack = new THREE.Mesh(
            new THREE.PlaneGeometry(windowWidth, windowHeight),
            windowMaterial
          );
          windowBack.rotation.y = Math.PI;
          windowBack.position.set(
            -width / 2 + (i + 0.5) * (width / windowCount),
            windowY,
            -depth / 2 - 0.1
          );
          buildingGroup.add(windowBack);
        }
      }
    }
  }
  
  // Tambahkan balconies (balkon) untuk beberapa lantai
  if (randFloat() > 0.4) {
    const balconyCount = Math.floor(height / 12);
    for (let i = 1; i < balconyCount; i++) {
      if (randFloat() > 0.6) continue; // 40% chance per lantai
      
      const balconyY = (i * height) / balconyCount;
      const balcony = new THREE.Mesh(
        new THREE.BoxGeometry(width * 1.05, 0.3, depth * 0.3),
        new THREE.MeshStandardMaterial({
          color: accentColor,
          roughness: 0.7,
          metalness: 0.1,
        })
      );
      balcony.position.set(0, balconyY, depth / 2 + 0.15);
      buildingGroup.add(balcony);
    }
  }
  
  // Roof detail (atap modern) dengan variasi
  const roofType = randFloat();
  if (roofType > 0.3) {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.1, height * 0.08, depth * 1.1),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.8,
        metalness: 0.2,
      })
    );
    roof.position.set(0, height, 0);
    buildingGroup.add(roof);
  }
  
  // Tambahkan antena atau detail atap (20% chance)
  if (randFloat() > 0.8) {
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, height * 0.3, 8),
      new THREE.MeshStandardMaterial({
        color: 0x34495e,
        roughness: 0.5,
        metalness: 0.7,
      })
    );
    antenna.position.set(width * 0.3, height + height * 0.15, depth * 0.3);
    buildingGroup.add(antenna);
  }
  
  buildingGroup.position.set(x, 0, z);
  return buildingGroup;
}

// Fungsi untuk membuat gedung tinggi (skyscraper) yang lebih bagus dan berwarna
function createSkyscraper(width, depth, x, z) {
  const buildingGroup = new THREE.Group();
  const height = randFloat(30, 50); // Dikurangi dari 80-150 menjadi 30-50
  
  // Pilih warna acak dari palet warna
  const baseColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  const accentColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  
  // Base structure dengan warna cerah
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.3,
      metalness: 0.6,
    })
  );
  base.position.set(0, height / 2, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);
  
  // Tambahkan vertical stripes (garis vertikal) untuk detail arsitektur
  const numStripes = Math.floor(width / 2);
  for (let i = 0; i < numStripes; i++) {
    if (randFloat() > 0.5) continue; // 50% chance per stripe
    
    const stripeWidth = width * 0.05;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(stripeWidth, height * 1.02, depth * 1.02),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.4,
        metalness: 0.5,
      })
    );
    stripe.position.set(
      -width / 2 + (i + 0.5) * (width / numStripes),
      height / 2,
      0
    );
    buildingGroup.add(stripe);
  }
  
  // Glass windows pattern dengan variasi warna yang lebih menarik
  const windowRows = Math.floor(height / 4);
  const windowCols = Math.floor(width / 2.5);
  const windowSpacing = height / windowRows;
  
  // Variasi warna jendela untuk efek yang lebih menarik
  const windowColors = [
    0xffd700, // Emas (sangat terang)
    0xffa500, // Orange terang
    0xffeb3b, // Kuning terang
    0x00ffff, // Cyan terang
    0x1a1a3e, // Biru gelap (mati)
    0x0a0e27, // Hitam (mati)
  ];
  
  for (let i = 0; i < windowRows; i++) {
    for (let j = 0; j < windowCols; j++) {
      // 70% jendela terisi
      if (randFloat() > 0.3) continue;
      
      const windowY = i * windowSpacing + windowSpacing / 2;
      const windowHeight = windowSpacing * 0.7;
      const windowWidth = (width / windowCols) * 0.8;
      
      // Pilih warna jendela (75% menyala dengan warna cerah, 25% mati)
      const isLit = randFloat() > 0.25;
      const windowColor = isLit 
        ? windowColors[randInt(0, 3)] 
        : windowColors[randInt(4, 5)];
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.05,
        metalness: 0.95,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 1.0 : 0,
      });
      
      // Jendela di depan
      const windowFront = new THREE.Mesh(
        new THREE.PlaneGeometry(windowWidth, windowHeight),
        windowMaterial
      );
      windowFront.position.set(
        -width / 2 + (j + 0.5) * (width / windowCols),
        windowY,
        depth / 2 + 0.1
      );
      buildingGroup.add(windowFront);
      
      // Jendela di belakang (60% chance)
      if (randFloat() > 0.4) {
        const windowBack = new THREE.Mesh(
          new THREE.PlaneGeometry(windowWidth, windowHeight),
          windowMaterial
        );
        windowBack.rotation.y = Math.PI;
        windowBack.position.set(
          -width / 2 + (j + 0.5) * (width / windowCols),
          windowY,
          -depth / 2 - 0.1
        );
        buildingGroup.add(windowBack);
      }
    }
  }
  
  // Tambahkan horizontal bands di beberapa level
  const numBands = Math.floor(height / 15);
  for (let i = 1; i < numBands; i++) {
    if (randFloat() > 0.6) continue; // 40% chance per band
    
    const bandHeight = height * 0.015;
    const bandY = (i * height) / numBands;
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.02, bandHeight, depth * 1.02),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.5,
        metalness: 0.6,
      })
    );
    band.position.set(0, bandY, 0);
    buildingGroup.add(band);
  }
  
  // Tambahkan aksen warna di bagian atas (top section)
  const topSection = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.05, height * 0.1, depth * 1.05),
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.6,
      metalness: 0.4,
    })
  );
  topSection.position.set(0, height * 0.95, 0);
  buildingGroup.add(topSection);
  
  // Tambahkan spire atau antena di atas (30% chance)
  if (randFloat() > 0.7) {
    const spireHeight = height * 0.2;
    const spire = new THREE.Mesh(
      new THREE.ConeGeometry(width * 0.3, spireHeight, 8),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.5,
        metalness: 0.7,
      })
    );
    spire.position.set(0, height + spireHeight / 2, 0);
    buildingGroup.add(spire);
    
    // Tambahkan bola di ujung spire
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(width * 0.15, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0xffd700, // Emas
        roughness: 0.3,
        metalness: 0.9,
        emissive: 0xffd700,
        emissiveIntensity: 0.5,
      })
    );
    sphere.position.set(0, height + spireHeight, 0);
    buildingGroup.add(sphere);
  }
  
  buildingGroup.position.set(x, 0, z);
  return buildingGroup;
}

// Fungsi untuk membuat gedung rendah (low-rise building)
function createLowRiseBuilding(width, depth, x, z) {
  const buildingGroup = new THREE.Group();
  const height = randFloat(6, 15); // Gedung rendah
  
  const baseColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  const accentColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  
  // Base building
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.5,
      metalness: 0.2,
    })
  );
  base.position.set(0, height / 2, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);
  
  // Tambahkan jendela sederhana
  const windowCount = Math.floor(width / 2.5);
  const windowSpacing = height / (Math.floor(height / 3) + 1);
  
  for (let i = 0; i < windowCount; i++) {
    for (let k = 1; k < Math.floor(height / windowSpacing); k++) {
      if (randFloat() > 0.5) continue;
      
      const windowY = k * windowSpacing;
      const windowHeight = windowSpacing * 0.6;
      const windowWidth = (width / windowCount) * 0.7;
      
      const isLit = randFloat() > 0.4;
      const windowColor = isLit ? 0xffd700 : 0x1a1a2e;
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.1,
        metalness: 0.9,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 0.6 : 0,
      });
      
      const window = new THREE.Mesh(
        new THREE.PlaneGeometry(windowWidth, windowHeight),
        windowMaterial
      );
      window.position.set(
        -width / 2 + (i + 0.5) * (width / windowCount),
        windowY,
        depth / 2 + 0.1
      );
      buildingGroup.add(window);
    }
  }
  
  // Roof sederhana
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.05, height * 0.1, depth * 1.05),
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.8,
      metalness: 0.1,
    })
  );
  roof.position.set(0, height, 0);
  buildingGroup.add(roof);
  
  buildingGroup.position.set(x, 0, z);
  return buildingGroup;
}

// Fungsi untuk membuat gedung menengah (mid-rise building)
function createMidRiseBuilding(width, depth, x, z) {
  const buildingGroup = new THREE.Group();
  const height = randFloat(18, 30); // Gedung menengah
  
  const baseColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  const accentColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  
  // Base building
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.4,
      metalness: 0.3,
    })
  );
  base.position.set(0, height / 2, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);
  
  // Horizontal bands
  const numBands = Math.floor(height / 6);
  for (let i = 1; i < numBands; i++) {
    const bandHeight = height * 0.02;
    const bandY = (i * height) / numBands;
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.01, bandHeight, depth * 1.01),
      new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.6,
        metalness: 0.4,
      })
    );
    band.position.set(0, bandY, 0);
    buildingGroup.add(band);
  }
  
  // Jendela
  const windowCount = Math.floor(width / 3);
  const windowSpacing = height / (Math.floor(height / 4) + 1);
  
  for (let i = 0; i < windowCount; i++) {
    for (let k = 1; k < Math.floor(height / windowSpacing); k++) {
      if (randFloat() > 0.4) continue;
      
      const windowY = k * windowSpacing;
      const windowHeight = windowSpacing * 0.6;
      const windowWidth = (width / windowCount) * 0.7;
      
      const isLit = randFloat() > 0.3;
      const windowColor = isLit ? 0xffa500 : 0x1a1a2e;
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.1,
        metalness: 0.9,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 0.7 : 0,
      });
      
      const window = new THREE.Mesh(
        new THREE.PlaneGeometry(windowWidth, windowHeight),
        windowMaterial
      );
      window.position.set(
        -width / 2 + (i + 0.5) * (width / windowCount),
        windowY,
        depth / 2 + 0.1
      );
      buildingGroup.add(window);
    }
  }
  
  buildingGroup.position.set(x, 0, z);
  return buildingGroup;
}

// Fungsi untuk membuat gedung komersial (commercial building)
function createCommercialBuilding(width, depth, x, z) {
  const buildingGroup = new THREE.Group();
  const height = randFloat(15, 28); // Gedung komersial
  
  const baseColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  const accentColor = BUILDING_COLORS[randInt(0, BUILDING_COLORS.length - 1)];
  
  // Base building
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.3,
      metalness: 0.5,
    })
  );
  base.position.set(0, height / 2, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  buildingGroup.add(base);
  
  // Ground floor dengan aksen berbeda
  const groundFloor = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.02, height * 0.2, depth * 1.02),
    new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.5,
      metalness: 0.2,
    })
  );
  groundFloor.position.set(0, height * 0.1, 0);
  buildingGroup.add(groundFloor);
  
  // Jendela besar untuk komersial
  const windowCount = Math.floor(width / 4);
  const windowSpacing = height / (Math.floor(height / 5) + 1);
  
  for (let i = 0; i < windowCount; i++) {
    for (let k = 2; k < Math.floor(height / windowSpacing); k++) {
      if (randFloat() > 0.3) continue;
      
      const windowY = k * windowSpacing;
      const windowHeight = windowSpacing * 0.7;
      const windowWidth = (width / windowCount) * 0.8;
      
      const isLit = randFloat() > 0.2; // Lebih banyak menyala untuk komersial
      const windowColor = isLit ? 0xffeb3b : 0x0a0e27;
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.05,
        metalness: 0.95,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 0.9 : 0,
      });
      
      const window = new THREE.Mesh(
        new THREE.PlaneGeometry(windowWidth, windowHeight),
        windowMaterial
      );
      window.position.set(
        -width / 2 + (i + 0.5) * (width / windowCount),
        windowY,
        depth / 2 + 0.1
      );
      buildingGroup.add(window);
    }
  }
  
  buildingGroup.position.set(x, 0, z);
  return buildingGroup;
}

// Fungsi untuk membuat sistem jalan baru yang lebih baik dan bebas bug
function createNewRoadNetwork() {
  // Clear road positions tracking
  roadPositions.clear();
  
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  const totalSize = CITY.size - CITY.margin * 2;
  
  // Grid system untuk jalan baru - lebih teratur, rapi, dan modern
  const roadSpacing = 80; // Jarak antar jalan utama (diperbesar dari 60 untuk mengurangi jumlah jalan)
  const mainRoadWidth = 18; // Jalan utama lebih lebar
  const secondaryRoadWidth = 14; // Jalan sekunder lebih lebar
  
  // Array untuk menyimpan posisi jalan yang dibuat (untuk intersection handling)
  const horizontalRoads = [];
  const verticalRoads = [];
  
  // Jalan utama horizontal dan vertikal dengan alignment yang lebih rapi
  // Bulatkan posisi ke grid yang lebih rapi untuk menghindari floating point error
  const gridSnap = 1; // Snap ke grid 1 unit untuk alignment yang lebih rapi
  
  for (let i = minExtent; i <= maxExtent; i += roadSpacing) {
    // Skip area plaza
    if (Math.abs(i) < CITY.plazaRadius + 15) continue;
    
    // Snap posisi ke grid untuk alignment yang lebih rapi
    const snappedI = Math.round(i / gridSnap) * gridSnap;
    
    // Tentukan lebar jalan (main road setiap 2x spacing)
    const absI = Math.abs(snappedI);
    const doubleSpacing = roadSpacing * 2;
    const remainder = absI % doubleSpacing;
    // Main road jika remainder mendekati 0 atau mendekati doubleSpacing
    const isMainRoad = remainder < 1 || remainder > (doubleSpacing - 1);
    const width = isMainRoad ? mainRoadWidth : secondaryRoadWidth;
    
    // Jalan horizontal - pastikan tidak melebihi batas
    const roadLength = totalSize;
    const roadX = snappedI; // Gunakan snapped position
    const roadZ = 0;
    
    // Validasi posisi sebelum membuat jalan
    if (roadX >= minExtent && roadX <= maxExtent && isFinite(roadX) && isFinite(roadZ)) {
      const road = createRoad(roadLength, width, roadX, roadZ, 0, 0x2a2a2a);
      if (road) {
        horizontalRoads.push({ x: roadX, z: roadZ, width, length: roadLength });
      }
    }
    
    // Jalan vertikal - pastikan tidak melebihi batas
    if (snappedI >= minExtent && snappedI <= maxExtent && isFinite(snappedI)) {
      const road = createRoad(roadLength, width, 0, snappedI, Math.PI / 2, 0x2a2a2a);
      if (road) {
        verticalRoads.push({ x: 0, z: snappedI, width, length: roadLength });
      }
    }
  }
  
  // Tambahkan jalan sekunder di antara jalan utama untuk konektivitas yang lebih baik
  // Hanya tambahkan jika diperlukan (opsional, bisa di-disable untuk performa)
  const addSecondaryRoads = false; // Set false untuk disable jalan sekunder (mengurangi jumlah jalan untuk performa)
  if (addSecondaryRoads) {
    const secondarySpacing = roadSpacing / 2;
    for (let i = minExtent + secondarySpacing; i < maxExtent; i += roadSpacing) {
      // Skip jika sudah ada jalan utama di posisi ini
      const absI = Math.abs(i);
      const remainder = absI % roadSpacing;
      if (remainder < 1 || remainder > (roadSpacing - 1)) continue;
      if (absI < CITY.plazaRadius + 15) continue;
      
      const width = secondaryRoadWidth;
      
      // Validasi sebelum membuat jalan
      if (!isFinite(i) || !isFinite(totalSize) || !isFinite(width)) continue;
      
      // Jalan horizontal sekunder
      if (i >= minExtent && i <= maxExtent) {
        const road = createRoad(totalSize, width, i, 0, 0, 0x2d2d2d);
        if (road) {
          horizontalRoads.push({ x: i, z: 0, width, length: totalSize });
        }
      }
      
      // Jalan vertikal sekunder
      if (i >= minExtent && i <= maxExtent) {
        const road = createRoad(totalSize, width, 0, i, Math.PI / 2, 0x2d2d2d);
        if (road) {
          verticalRoads.push({ x: 0, z: i, width, length: totalSize });
        }
      }
    }
  }
  
  // Tambahkan intersection surface untuk menghindari gap di persimpangan
  // Gunakan Set untuk menghindari duplikasi intersection
  const intersectionSet = new Set();
  
  horizontalRoads.forEach(hRoad => {
    verticalRoads.forEach(vRoad => {
      // Hitung titik persimpangan
      const intersectionX = vRoad.x;
      const intersectionZ = hRoad.z;
      
      // Skip jika intersection sudah dibuat (menghindari duplikasi)
      const intersectionKey = `${Math.round(intersectionX * 10) / 10},${Math.round(intersectionZ * 10) / 10}`;
      if (intersectionSet.has(intersectionKey)) return;
      intersectionSet.add(intersectionKey);
      
      // Validasi posisi intersection
      if (!isFinite(intersectionX) || !isFinite(intersectionZ)) return;
      if (intersectionX < minExtent || intersectionX > maxExtent ||
          intersectionZ < minExtent || intersectionZ > maxExtent) return;
      
      // Buat surface tambahan di persimpangan untuk menghindari gap (lebih rapi)
      const intersectionSize = Math.max(hRoad.width, vRoad.width) * 1.15; // Sedikit lebih kecil untuk lebih rapi
      if (intersectionSize <= 0 || !isFinite(intersectionSize)) return;
      
      const intersectionMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, // Warna sama dengan jalan
        roughness: 0.95,
        metalness: 0.0,
      });
      
      const intersection = new THREE.Mesh(
        new THREE.PlaneGeometry(intersectionSize, intersectionSize),
        intersectionMaterial
      );
      intersection.rotation.x = -Math.PI / 2;
      intersection.position.set(intersectionX, 0.03, intersectionZ); // Sama tinggi dengan jalan
      intersection.receiveShadow = true;
      intersection.castShadow = false;
      scene.add(intersection);
    });
  });
  
  console.log(`Road network created: ${horizontalRoads.length} horizontal, ${verticalRoads.length} vertical roads`);
}

// Fungsi untuk mengecek apakah posisi terlalu dekat dengan jalan
function isTooCloseToRoad(x, z, roadSpacing, maxRoadWidth) {
  // Jarak minimum dari jalan (termasuk sidewalk)
  // Sidewalk width = 2, road width bisa sampai 18, jadi buffer = maxRoadWidth/2 + sidewalk + margin
  const roadMargin = maxRoadWidth / 2 + 2 + 10; // 10 unit buffer untuk memastikan tidak menyentuh
  
  // Cek jalan horizontal (z = 0, ±roadSpacing, ±2*roadSpacing, dll)
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue; // Skip area plaza
    const distanceToRoad = Math.abs(z - i);
    if (distanceToRoad < roadMargin) {
      return true; // Terlalu dekat dengan jalan horizontal
    }
  }
  
  // Cek jalan vertikal (x = 0, ±roadSpacing, ±2*roadSpacing, dll)
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue; // Skip area plaza
    const distanceToRoad = Math.abs(x - i);
    if (distanceToRoad < roadMargin) {
      return true; // Terlalu dekat dengan jalan vertikal
    }
  }
  
  return false;
}

// Fungsi untuk mengecek apakah posisi berada di area intersection (area kuning)
function isInIntersection(x, z, roadSpacing, maxRoadWidth) {
  const intersectionRadius = maxRoadWidth / 2 + 5; // Radius area intersection (termasuk buffer)
  
  // Cek semua intersection points (titik temu jalan horizontal dan vertikal)
  for (let h = -CITY.size / 2; h <= CITY.size / 2; h += roadSpacing) {
    if (Math.abs(h) < CITY.plazaRadius + 15) continue; // Skip area plaza
    
    for (let v = -CITY.size / 2; v <= CITY.size / 2; v += roadSpacing) {
      if (Math.abs(v) < CITY.plazaRadius + 15) continue; // Skip area plaza
      
      // Hitung jarak dari posisi ke intersection point
      const distanceToIntersection = Math.hypot(x - v, z - h);
      
      // Jika terlalu dekat dengan intersection, skip
      if (distanceToIntersection < intersectionRadius) {
        return true; // Berada di area intersection
      }
    }
  }
  
  return false;
}

// Fungsi untuk menempatkan pohon secara terpencar di seluruh kota
function scatterTrees() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  const roadSpacing = 80; // Harus sama dengan di createNewRoadNetwork
  const maxRoadWidth = 18; // Harus sama dengan di createNewRoadNetwork
  
  // Jumlah pohon yang akan dibuat (dikurangi dari 150 menjadi 60)
  const treeCount = 60; // Jumlah pohon total (dikurangi agar tidak terlalu banyak)
  const treeSpacing = 30; // Jarak minimum antar pohon (diperbesar dari 25)
  
  // Set untuk tracking posisi pohon yang sudah dibuat (menghindari duplikasi)
  const treePositions = new Set();
  
  let treesCreated = 0;
  let attempts = 0;
  const maxAttempts = treeCount * 15; // Maksimal percobaan untuk menemukan posisi yang valid
  
  while (treesCreated < treeCount && attempts < maxAttempts) {
    attempts++;
    
    // Generate posisi random di seluruh area kota
    const x = randFloat(minExtent + 20, maxExtent - 20);
    const z = randFloat(minExtent + 20, maxExtent - 20);
    
    // Skip area plaza
    if (Math.abs(x) < CITY.plazaRadius + 20 && Math.abs(z) < CITY.plazaRadius + 20) continue;
    
    // Skip area linear park (sudah ada pohon di sana)
    if (Math.abs(x - 120) < 25 && Math.abs(z + 40) < 115) continue;
    
    // Cek apakah berada di area intersection (area kuning) - KOSONGKAN
    if (isInIntersection(x, z, roadSpacing, maxRoadWidth)) {
      continue; // Skip jika berada di area intersection
    }
    
    // Cek apakah terlalu dekat dengan jalan
    if (isTooCloseToRoad(x, z, roadSpacing, maxRoadWidth)) {
      continue; // Skip jika terlalu dekat dengan jalan
    }
    
    // Cek apakah terlalu dekat dengan pohon lain
    const key = `${Math.round(x / treeSpacing) * treeSpacing},${Math.round(z / treeSpacing) * treeSpacing}`;
    if (treePositions.has(key)) {
      continue; // Skip jika sudah ada pohon di area ini
    }
    
    // Cek apakah terlalu dekat dengan gedung
    let tooCloseToBuilding = false;
    for (const building of buildings) {
      if (building.position) {
        const distance = Math.hypot(x - building.position.x, z - building.position.z);
        if (distance < 15) { // Minimal 15 unit dari gedung
          tooCloseToBuilding = true;
          break;
        }
      }
    }
    
    if (tooCloseToBuilding) continue;
    
    // Buat pohon di posisi ini
    createTree(x, 0, z, true);
    treePositions.add(key);
    treesCreated++;
  }
  
  console.log(`Scattered ${treesCreated} trees across the city`);
}

// Fungsi untuk populate city dengan gedung baru
function populateNewCity() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  const buildingSpacing = 55; // Jarak antar gedung (diperbesar untuk memberi ruang lebih)
  const roadSpacing = 80; // Harus sama dengan di createNewRoadNetwork
  const maxRoadWidth = 18; // Lebar jalan maksimum untuk perhitungan jarak
  
  // Buat grid gedung baru dengan jarak yang lebih besar dari jalan
  for (let x = minExtent + 30; x <= maxExtent - 30; x += buildingSpacing) {
    for (let z = minExtent + 30; z <= maxExtent - 30; z += buildingSpacing) {
      // Skip area plaza dan area khusus
      if (Math.abs(x) < CITY.plazaRadius + 20 && Math.abs(z) < CITY.plazaRadius + 20) continue;
      if (Math.abs(x - 120) < 20 && Math.abs(z + 40) < 110) continue; // Skip linear park
      
      // Cek apakah terlalu dekat dengan jalan
      if (isTooCloseToRoad(x, z, roadSpacing, maxRoadWidth)) {
        continue; // Skip jika terlalu dekat dengan jalan
      }
      
      // Cek juga apakah gedung akan overlap dengan jalan berdasarkan ukuran gedung
      const buildingWidth = randFloat(12, 25);
      const buildingDepth = randFloat(12, 25);
      const buildingHalfWidth = buildingWidth / 2;
      const buildingHalfDepth = buildingDepth / 2;
      
      // Cek apakah gedung akan menyentuh jalan di semua sisi
      let tooClose = false;
      for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
        if (Math.abs(i) < CITY.plazaRadius + 15) continue;
        const roadMargin = maxRoadWidth / 2 + 2 + 8; // Sidewalk + buffer
        
        // Cek horizontal road
        if (Math.abs(z - i) < roadMargin + buildingHalfDepth) {
          tooClose = true;
          break;
        }
        // Cek vertical road
        if (Math.abs(x - i) < roadMargin + buildingHalfWidth) {
          tooClose = true;
          break;
        }
      }
      
      if (tooClose) continue; // Skip jika gedung akan menyentuh jalan
      
      // Pilih tipe gedung dengan lebih banyak variasi
      const distance = Math.hypot(x, z);
      let building;
      
      // Variasi tipe bangunan berdasarkan posisi dan random
      const buildingType = randFloat();
      const width = randFloat(12, 25);
      const depth = randFloat(12, 25);
      
      if (distance < 80 && buildingType > 0.75) {
        // Skyscraper di area tengah (25% chance di area tengah)
        building = createSkyscraper(width, depth, x, z);
      } else if (buildingType < 0.25) {
        // Low-rise building (25% chance)
        building = createLowRiseBuilding(width, depth, x, z);
      } else if (buildingType < 0.5) {
        // Mid-rise building (25% chance)
        building = createMidRiseBuilding(width, depth, x, z);
      } else if (buildingType < 0.75) {
        // Commercial building (25% chance)
        building = createCommercialBuilding(width, depth, x, z);
      } else {
        // Modern building (25% chance)
        building = createModernBuilding(width, depth, x, z);
      }
      
      scene.add(building);
      buildings.push(building);
    }
  }
  
  console.log(`New city populated with ${buildings.length} buildings`);
}

// Fungsi untuk scatter details (dari Three.js-City)
// Urutan penting: ground dulu, lalu roads, lalu buildings
function scatterDetails() {
  createGroundLayers();
  
  // Hapus semua gedung lama terlebih dahulu
  removeAllBuildings();
  
  // Road network dibuat setelah ground tapi sebelum buildings
  // karena populateCity akan membuat grid yang digunakan untuk roads
  createRoundabout();
  createLinearPark();
  placeStreetLights();
  createTransitHub();
  
  // Buat jalan baru terlebih dahulu
  createNewRoadNetwork();
  
  // Populate city dengan gedung baru
  populateNewCity();
  
  // Sebarkan pohon secara terpencar di seluruh kota (setelah gedung dibuat)
  scatterTrees();
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
    // Kamera top-down mengikuti posisi mobil dan arah menghadap
    const offset = cameraOffsets.top.clone();
    
    // Posisi kamera di atas mobil (mengikuti posisi mobil)
    const desiredTopPosition = new THREE.Vector3(
      car.position.x + offset.x,
      car.position.y + offset.y,
      car.position.z + offset.z
    );
    
    if (isFirstCameraFrame) {
      // Frame pertama: langsung set posisi tanpa lerp
      camera.position.copy(desiredTopPosition);
      isFirstCameraFrame = false;
    } else {
      camera.position.lerp(desiredTopPosition, 0.15);
    }
    
    // Kamera melihat ke arah mobil menghadap (bukan hanya ke bawah)
    // Hitung arah depan mobil berdasarkan rotasi
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyQuaternion(car.quaternion);
    
    // Target untuk lookAt: posisi mobil + arah depan mobil (untuk melihat ke arah mobil menghadap)
    const lookTarget = car.position.clone();
    lookTarget.add(forward.multiplyScalar(10)); // 10 unit ke depan dari mobil
    lookTarget.y += 0.5; // Sedikit di atas mobil
    
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

