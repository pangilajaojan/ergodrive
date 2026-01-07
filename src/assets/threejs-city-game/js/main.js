import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- SCENE SETUP ---
// Suasana hutan: langit biru kehijauan
const scene = new THREE.Scene();
const backgroundColor = new THREE.Color(0x87CEEB); // Sky blue untuk langit hutan
scene.background = backgroundColor;
// Fog dengan warna hijau kebiruan untuk suasana hutan
scene.fog = new THREE.FogExp2(0x9ACD32, 0.0015); // Yellow green fog

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  2500
);

// Posisi kamera akan diatur setelah car dimuat

// Optimasi: Aktifkan antialias untuk kualitas lebih baik dan naikkan frame rate
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// Set pixel ratio lebih tinggi untuk frame rate dan kualitas lebih baik
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
renderer.shadowMap.enabled = true;
// Gunakan BasicShadowMap yang lebih ringan daripada PCFSoftShadowMap
renderer.shadowMap.type = THREE.BasicShadowMap;
// Pastikan renderer tidak memiliki clear color yang berbeda
renderer.setClearColor(backgroundColor, 1);
document.body.appendChild(renderer.domElement);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

// HemisphereLight: warna biru untuk langit (atas), hijau untuk hutan (bawah)
const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x228B22, 0.9); // Sky blue ke forest green
hemiLight.position.set(0, 300, 0);
scene.add(hemiLight);

// Sunlight untuk hutan: lebih hangat dan natural
const sunLight = new THREE.DirectionalLight(0xfff5e1, 1.8); // Warm sunlight untuk hutan
sunLight.position.set(-120, 180, 80);
sunLight.castShadow = true;
// Optimasi: Naikkan shadow map size untuk kualitas lebih baik dengan frame rate tinggi
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 600;
sunLight.shadow.camera.left = -300;
sunLight.shadow.camera.right = 300;
sunLight.shadow.camera.top = 300;
sunLight.shadow.camera.bottom = -300;
scene.add(sunLight);

// Optimasi: Kurangi jumlah fill lights untuk performa lebih baik
const fillLights = [];
// Hanya gunakan 1 fill light saja untuk mengurangi beban rendering
const LIGHT_POINTS = [
  [80, 60, -40],
];
LIGHT_POINTS.forEach(([x, y, z]) => {
  const light = new THREE.PointLight(0x6fd1ff, 0.3, 380);
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
  // Hutan: Tidak ada building, hanya pohon
  density: 0, // Tidak ada building untuk hutan
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
  // Base ground: tanah coklat untuk hutan
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size, CITY.size),
    new THREE.MeshStandardMaterial({
      color: 0x8B4513, // Saddle brown - warna tanah hutan
      roughness: 0.95,
      metalness: 0.05,
    })
  );
  base.rotation.x = -Math.PI / 2;
  base.receiveShadow = true;
  scene.add(base);

  // Grass layer: rumput hijau hutan
  const grassLayer = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size * 0.98, CITY.size * 0.98),
    new THREE.MeshStandardMaterial({
      color: 0x228B22, // Forest green - warna rumput hutan
      roughness: 0.9,
    })
  );
  grassLayer.rotation.x = -Math.PI / 2;
  grassLayer.position.y = 0.005; // Lebih rendah dari jalan (0.03) sehingga jalan menutupinya
  grassLayer.receiveShadow = true;
  scene.add(grassLayer);
}

// Set untuk tracking posisi jalan yang sudah dibuat (untuk menghindari duplikasi)
const roadPositions = new Set();

// Jalan hutan: warna coklat/tanah
function createRoad(length, width, x, z, rotationY = 0, color = 0x654321) {
  // Validasi input untuk mencegah bug
  if (!isFinite(length) || !isFinite(width) || !isFinite(x) || !isFinite(z) || length <= 0 || width <= 0) {
    console.warn('Invalid road parameters:', { length, width, x, z });
    return null;
  }
  
  // Validasi posisi tidak melebihi pagar (pagar ada di CITY.size / 2)
  const fencePosition = CITY.size / 2;
  const safetyMargin = 5; // Margin keamanan dari pagar
  const maxExtent = fencePosition - safetyMargin;
  const minExtent = -fencePosition + safetyMargin;
  
  // Cek apakah posisi jalan melebihi batas pagar
  const roadIsHorizontal = Math.abs(rotationY) < 0.1 || Math.abs(rotationY - Math.PI) < 0.1;
  if (roadIsHorizontal) {
    // Jalan horizontal - cek apakah melebihi batas X
    if (x + length / 2 > maxExtent || x - length / 2 < minExtent) {
      return null; // Skip jika melebihi batas
    }
    if (z > maxExtent || z < minExtent) {
      return null; // Skip jika posisi Z melebihi batas
    }
  } else {
    // Jalan vertikal - cek apakah melebihi batas Z
    if (z + length / 2 > maxExtent || z - length / 2 < minExtent) {
      return null; // Skip jika melebihi batas
    }
    if (x > maxExtent || x < minExtent) {
      return null; // Skip jika posisi X melebihi batas
    }
  }
  
  // Overlap minimal untuk menghindari gap (2% dari width - lebih kecil untuk lebih rapi)
  const overlap = width * 0.02;
  const adjustedLength = length + overlap * 2;
  const adjustedWidth = width + overlap * 2;
  
  // Pastikan adjusted length dan width tidak melebihi batas
  if (roadIsHorizontal) {
    if (x + adjustedLength / 2 > maxExtent || x - adjustedLength / 2 < minExtent) {
      return null;
    }
  } else {
    if (z + adjustedLength / 2 > maxExtent || z - adjustedLength / 2 < minExtent) {
      return null;
    }
  }
  
  // Buat key unik untuk tracking (dengan toleransi)
  const key = `${Math.round(x * 10) / 10},${Math.round(z * 10) / 10},${Math.round(rotationY * 100) / 100}`;
  if (roadPositions.has(key)) {
    // Skip jika jalan sudah ada di posisi ini (menghindari duplikasi)
    return null;
  }
  roadPositions.add(key);
  
  // Material jalan hutan: tanah/coklat untuk jalan hutan
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: color || 0x654321, // Brown untuk jalan hutan (default jika tidak ada color)
    roughness: 0.98, // Sangat kasar untuk tampilan tanah
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
  // Sidewalk untuk hutan: warna tanah/rumput
  const sidewalkMaterial = new THREE.MeshStandardMaterial({
    color: 0x8B7355, // Tanah coklat untuk pinggir jalan hutan
    roughness: 0.9,
    metalness: 0.05,
  });
  
  // Gunakan roadIsHorizontal yang sudah dideklarasikan di atas
  if (roadIsHorizontal) {
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
  // Roundabout untuk hutan: area tanah/rumput
  const roundabout = new THREE.Mesh(
    new THREE.CylinderGeometry(CITY.plazaRadius, CITY.plazaRadius, 2, 48),
    new THREE.MeshStandardMaterial({
      color: 0x654321, // Brown untuk area tanah hutan
      roughness: 0.9,
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
    new THREE.MeshStandardMaterial({ color: 0x228B22 }) // Forest green untuk area hijau
  );
  innerGarden.position.y = 2.2;
  scene.add(innerGarden);

  // Hutan: Ubah monument menjadi batu/area natural
  const monumentBase = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 8, 3, 24),
    new THREE.MeshStandardMaterial({
      color: 0x6B5B4A, // Brown stone untuk hutan
      metalness: 0.1,
      roughness: 0.8,
    })
  );
  monumentBase.position.y = 4;
  scene.add(monumentBase);

  // Hutan: Ubah spire menjadi pohon atau batu
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(3, 26, 16),
    new THREE.MeshStandardMaterial({
      color: 0x228B22, // Forest green untuk pohon
      metalness: 0.0,
      roughness: 0.9,
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
  // Optimasi: Nonaktifkan shadow casting pada pohon untuk performa lebih baik
  trunk.castShadow = false;
  treeGroup.add(trunk);

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(randFloat(3.5, 4.5), randFloat(5, 7), 12),
    new THREE.MeshStandardMaterial({ color: 0x1f5b2c, roughness: 0.6 })
  );
  canopy.position.set(0, 8.5, 0);
  // Optimasi: Nonaktifkan shadow casting pada pohon untuk performa lebih baik
  canopy.castShadow = false;
  canopy.receiveShadow = false;
  treeGroup.add(canopy);
  
  treeGroup.position.set(x, y, z);
  
  if (addToScene) {
    scene.add(treeGroup);
  }
  
  return treeGroup;
}

// Fungsi untuk membuat pagar pembatas di sekeliling map
function createMapBoundary() {
  const maxExtent = CITY.size / 2;
  const minExtent = -CITY.size / 2;
  
  // Parameter pagar - seperti tembok Cina (lebih tinggi dan solid)
  const poleHeight = 10; // Tinggi tiang - dinaikkan seperti tembok Cina
  const poleWidth = 0.5; // Lebar/diameter tiang - diperbesar untuk lebih solid
  const barWidth = 0.3; // Lebar bar horizontal - diperbesar
  const barThickness = 0.2; // Ketebalan bar - diperbesar
  const poleSpacing = 8; // Jarak antar tiang - dikurangi untuk lebih padat
  const numBars = 5; // Jumlah bar horizontal - ditambah untuk lebih tinggi
  
  // Material pagar
  const fenceMaterial = new THREE.MeshStandardMaterial({
    color: 0x666666, // Abu-abu untuk pagar
    metalness: 0.6,
    roughness: 0.4,
  });
  
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x8B7355, // Warna seperti batu/tembok Cina
    metalness: 0.3,
    roughness: 0.8,
  });
  
  // Material untuk dinding solid di belakang pagar (tidak bisa ditembus)
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: 0x6B5B4A, // Warna tembok yang lebih gelap
    metalness: 0.2,
    roughness: 0.9,
    side: THREE.DoubleSide, // Render kedua sisi
  });
  
  // Fungsi helper untuk membuat pagar di satu sisi
  const createFenceSide = (startX, startZ, endX, endZ, isHorizontal) => {
    const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endZ - startZ, 2));
    const numPoles = Math.floor(length / poleSpacing) + 1;
    const actualSpacing = length / (numPoles - 1);
    
    for (let i = 0; i < numPoles; i++) {
      const t = i / Math.max(1, numPoles - 1);
      const poleX = startX + (endX - startX) * t;
      const poleZ = startZ + (endZ - startZ) * t;
      
      // Tiang pagar - lebih besar dan solid
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(poleWidth / 2, poleWidth / 2, poleHeight, 8),
        poleMaterial
      );
      pole.position.set(poleX, poleHeight / 2, poleZ);
      pole.castShadow = true;
      pole.receiveShadow = true;
      scene.add(pole);
      
      // Bar horizontal (3 bar) - hanya buat jika bukan tiang terakhir
      if (i < numPoles - 1) {
        for (let barIndex = 0; barIndex < numBars; barIndex++) {
          const barY = 0.5 + (barIndex + 1) * (poleHeight / (numBars + 1));
          const barLength = actualSpacing * 0.95; // Sedikit lebih pendek dari spacing
          
          let bar;
          if (isHorizontal) {
            // Bar untuk pagar horizontal (sejajar dengan sumbu X)
            bar = new THREE.Mesh(
              new THREE.BoxGeometry(barLength, barThickness, barWidth),
              fenceMaterial
            );
            bar.position.set(poleX + actualSpacing / 2, barY, poleZ);
          } else {
            // Bar untuk pagar vertikal (sejajar dengan sumbu Z)
            bar = new THREE.Mesh(
              new THREE.BoxGeometry(barWidth, barThickness, barLength),
              fenceMaterial
            );
            bar.position.set(poleX, barY, poleZ + actualSpacing / 2);
          }
          bar.castShadow = true;
          bar.receiveShadow = true;
          scene.add(bar);
        }
      }
    }
  };
  
  // Buat pagar di 4 sisi map
  // Sisi Utara (atas) - horizontal
  createFenceSide(minExtent, maxExtent, maxExtent, maxExtent, true);
  
  // Sisi Selatan (bawah) - horizontal
  createFenceSide(minExtent, minExtent, maxExtent, minExtent, true);
  
  // Sisi Barat (kiri) - vertikal
  createFenceSide(minExtent, minExtent, minExtent, maxExtent, false);
  
  // Sisi Timur (kanan) - vertikal
  createFenceSide(maxExtent, minExtent, maxExtent, maxExtent, false);
  
  // Tambahkan dinding solid di belakang pagar (tidak bisa ditembus)
  const wallThickness = 0.5; // Ketebalan dinding
  const wallHeight = poleHeight; // Tinggi dinding sama dengan pagar
  
  // Dinding Utara (atas)
  const northWall = new THREE.Mesh(
    new THREE.BoxGeometry(CITY.size, wallHeight, wallThickness),
    wallMaterial
  );
  northWall.position.set(0, wallHeight / 2, maxExtent + wallThickness / 2);
  northWall.castShadow = true;
  northWall.receiveShadow = true;
  scene.add(northWall);
  
  // Dinding Selatan (bawah)
  const southWall = new THREE.Mesh(
    new THREE.BoxGeometry(CITY.size, wallHeight, wallThickness),
    wallMaterial
  );
  southWall.position.set(0, wallHeight / 2, minExtent - wallThickness / 2);
  southWall.castShadow = true;
  southWall.receiveShadow = true;
  scene.add(southWall);
  
  // Dinding Barat (kiri)
  const westWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, CITY.size),
    wallMaterial
  );
  westWall.position.set(minExtent - wallThickness / 2, wallHeight / 2, 0);
  westWall.castShadow = true;
  westWall.receiveShadow = true;
  scene.add(westWall);
  
  // Dinding Timur (kanan)
  const eastWall = new THREE.Mesh(
    new THREE.BoxGeometry(wallThickness, wallHeight, CITY.size),
    wallMaterial
  );
  eastWall.position.set(maxExtent + wallThickness / 2, wallHeight / 2, 0);
  eastWall.castShadow = true;
  eastWall.receiveShadow = true;
  scene.add(eastWall);
}

function createLinearPark() {
  const maxExtent = CITY.size / 2 - CITY.margin;
  const minExtent = -CITY.size / 2 + CITY.margin;
  
  // Ukuran linear park
  const parkWidth = 40;
  const parkDepth = 220;
  
  // Buat taman di timur (kanan) dan barat (kiri) - simetris
  const parkPositions = [
    { x: 120, z: -40 },  // Taman timur (kanan)
    { x: -120, z: -40 }  // Taman barat (kiri) - simetris
  ];
  
  parkPositions.forEach(({ x, z }) => {
    const parkX = Math.max(minExtent + parkWidth / 2, Math.min(maxExtent - parkWidth / 2, x));
    const parkZ = Math.max(minExtent + parkDepth / 2, Math.min(maxExtent - parkDepth / 2, z));
    
    const park = new THREE.Mesh(
      new THREE.PlaneGeometry(parkWidth, parkDepth),
      new THREE.MeshStandardMaterial({ color: 0x1b3a1a })
    );
    park.rotation.x = -Math.PI / 2;
    park.position.set(parkX, 0.04, parkZ);
    scene.add(park);

    // Tambahkan pohon di taman
    for (let i = -90; i <= 90; i += 45) {
      const treeX = parkX + randSpread(10);
      const treeZ = parkZ + i;
      // Cek batas sebelum membuat tree
      if (treeX >= minExtent && treeX <= maxExtent && 
          treeZ >= minExtent && treeZ <= maxExtent) {
        createTree(treeX, 0, treeZ, true);
      }
    }
  });
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
  // Gunakan batas pagar sebagai referensi - pagar ada di CITY.size / 2
  const fencePosition = CITY.size / 2;
  const safetyMargin = 5; // Margin keamanan dari pagar untuk lampu jalan
  const maxExtent = fencePosition - safetyMargin;
  const minExtent = -fencePosition + safetyMargin;
  
  // Optimasi: Kurangi frekuensi street lights (dari setiap 36 unit menjadi 60 unit)
  for (let i = minExtent; i <= maxExtent; i += 60) {
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
  
  // Optimasi: Kurangi jumlah pohon di park (dari 400 menjadi 800 unit area per pohon)
  const treeCount = Math.floor((width * depth) / 800); // 1 pohon per 800 unit area
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

// Fungsi untuk membuat taman bermain (playground)
function createPlayground() {
  const fencePosition = CITY.size / 2;
  const safetyMargin = 20; // Margin keamanan dari pagar
  const maxExtent = fencePosition - safetyMargin;
  const minExtent = -fencePosition + safetyMargin;
  
  // Ukuran taman bermain
  const playgroundWidth = 50;
  const playgroundDepth = 50;
  
  // Cari posisi yang tidak overlap dengan jalan
  const roadSpacing = 80;
  const maxRoadWidth = 18;
  
  // Posisi taman bermain (di area yang aman)
  let playgroundX = 150;
  let playgroundZ = 150;
  
  // Cek beberapa posisi kandidat
  const candidatePositions = [
    { x: 150, z: 150 },
    { x: -150, z: 150 },
    { x: 150, z: -150 },
    { x: -150, z: -150 },
    { x: 120, z: 120 },
    { x: -120, z: 120 },
  ];
  
  let foundPosition = false;
  for (const pos of candidatePositions) {
    if (!isOverlappingWithRoad(pos.x, pos.z, playgroundWidth, playgroundDepth, roadSpacing, maxRoadWidth) &&
        pos.x >= minExtent + playgroundWidth / 2 && pos.x <= maxExtent - playgroundWidth / 2 &&
        pos.z >= minExtent + playgroundDepth / 2 && pos.z <= maxExtent - playgroundDepth / 2) {
      playgroundX = pos.x;
      playgroundZ = pos.z;
      foundPosition = true;
      break;
    }
  }
  
  if (!foundPosition) return; // Skip jika tidak ada posisi yang aman
  
  // Ground area (area bermain dengan warna terang)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(playgroundWidth, playgroundDepth),
    new THREE.MeshStandardMaterial({
      color: 0x4a9f4a, // Hijau terang untuk area bermain
      roughness: 0.9,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(playgroundX, 0.02, playgroundZ);
  ground.receiveShadow = true;
  scene.add(ground);
  
  // Material untuk peralatan playground
  const slideMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6b6b, // Merah untuk slide
    roughness: 0.3,
    metalness: 0.7,
  });
  
  const swingMaterial = new THREE.MeshStandardMaterial({
    color: 0x4ecdc4, // Cyan untuk ayunan
    roughness: 0.4,
    metalness: 0.6,
  });
  
  const structureMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd93d, // Kuning untuk struktur
    roughness: 0.5,
    metalness: 0.5,
  });
  
  // 1. SLIDE (Perosotan) - Lebih detail dan jelas
  const slideGroup = new THREE.Group();
  
  // Tiang penyangga utama (lebih besar dan jelas)
  const mainSupportPoles = [
    { x: -1.5, z: -1.5 },
    { x: 1.5, z: -1.5 },
    { x: -1.5, z: 2.5 },
    { x: 1.5, z: 2.5 },
  ];
  mainSupportPoles.forEach(({ x, z }) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 4.5, 8),
      structureMaterial
    );
    pole.position.set(x, 2.25, z);
    slideGroup.add(pole);
  });
  
  // Platform atas slide (lebih besar)
  const slidePlatform = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.3, 3.5),
    structureMaterial
  );
  slidePlatform.position.set(0, 4.5, 0);
  slideGroup.add(slidePlatform);
  
  // Rail/guard di platform
  const platformRails = [
    { x: -1.5, z: -1.5 },
    { x: 1.5, z: -1.5 },
    { x: -1.5, z: 1.5 },
    { x: 1.5, z: 1.5 },
  ];
  platformRails.forEach(({ x, z }) => {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6),
      structureMaterial
    );
    rail.position.set(x, 4.8, z);
    slideGroup.add(rail);
  });
  
  // Tangga slide (lebih detail)
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.2, 0.5),
      structureMaterial
    );
    step.position.set(-1.2, i * 0.6 + 0.5, -1.8 + i * 0.35);
    slideGroup.add(step);
    
    // Handrail untuk tangga
    if (i < steps - 1) {
      const handrail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6),
        structureMaterial
      );
      handrail.position.set(-2, i * 0.6 + 0.8, -1.8 + i * 0.35);
      slideGroup.add(handrail);
    }
  }
  
  // Slide ramp (perosotan) - lebih lebar dan jelas
  const slideRamp = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.25, 6),
    slideMaterial
  );
  slideRamp.rotation.x = -Math.PI / 5.5; // Miring sekitar 33 derajat
  slideRamp.position.set(0, 2.2, 3);
  slideGroup.add(slideRamp);
  
  // Side rails untuk slide
  const slideRails = [
    { x: -1.4, z: 3 },
    { x: 1.4, z: 3 },
  ];
  slideRails.forEach(({ x, z }) => {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 6, 6),
      structureMaterial
    );
    rail.rotation.x = -Math.PI / 5.5;
    rail.position.set(x, 2.2, z);
    slideGroup.add(rail);
  });
  
  slideGroup.position.set(playgroundX - 15, 0, playgroundZ - 15);
  slideGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  scene.add(slideGroup);
  
  // 2. SWING (Ayunan) - Lebih detail dengan 2 ayunan
  const swingPositions = [
    { x: playgroundX + 10, z: playgroundZ - 10 },
    { x: playgroundX + 10, z: playgroundZ + 10 },
  ];
  
  swingPositions.forEach(({ x, z }) => {
    const swingGroup = new THREE.Group();
    
    // Tiang ayunan (A-frame structure)
    const swingPoles = [
      { x: -1.8, z: 0, angle: Math.PI / 12 }, // Miring ke dalam
      { x: 1.8, z: 0, angle: -Math.PI / 12 },
    ];
    swingPoles.forEach(({ x: px, z: pz, angle }) => {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 4, 8),
        structureMaterial
      );
      pole.rotation.z = angle;
      pole.position.set(px, 2, pz);
      swingGroup.add(pole);
    });
    
    // Bar horizontal (untuk menggantung ayunan) - lebih tebal
    const topBar = new THREE.Mesh(
      new THREE.BoxGeometry(4, 0.25, 0.25),
      structureMaterial
    );
    topBar.position.set(0, 4, 0);
    swingGroup.add(topBar);
    
    // Kursi ayunan (lebih detail)
    const swingSeat = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.2, 1),
      swingMaterial
    );
    swingSeat.position.set(0, 2.2, 0);
    swingGroup.add(swingSeat);
    
    // Backrest untuk kursi
    const backrest = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 0.15),
      swingMaterial
    );
    backrest.rotation.x = Math.PI / 8;
    backrest.position.set(0, 2.6, -0.4);
    swingGroup.add(backrest);
    
    // Rantai/tali ayunan (4 rantai untuk lebih realistis)
    const chains = [
      { x: -0.6, z: -0.4 },
      { x: 0.6, z: -0.4 },
      { x: -0.6, z: 0.4 },
      { x: 0.6, z: 0.4 },
    ];
    chains.forEach(({ x: cx, z: cz }) => {
      const chain = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6),
        new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8 })
      );
      chain.position.set(cx, 3.1, cz);
      swingGroup.add(chain);
    });
    
    swingGroup.position.set(x, 0, z);
    swingGroup.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(swingGroup);
  });
  
  // 3. CLIMBING STRUCTURE (Struktur panjat) - Lebih detail dan menarik
  const climbingGroup = new THREE.Group();
  
  // Tiang utama (lebih besar)
  const mainPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 3.5, 8),
    structureMaterial
  );
  mainPole.position.set(0, 1.75, 0);
  climbingGroup.add(mainPole);
  
  // Platform panjat (lebih besar dengan rail)
  const climbingPlatform = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.25, 3),
    structureMaterial
  );
  climbingPlatform.position.set(0, 3.5, 0);
  climbingGroup.add(climbingPlatform);
  
  // Rail di platform
  const climbingPlatformRails = [
    { x: -1.3, z: -1.3 },
    { x: 1.3, z: -1.3 },
    { x: -1.3, z: 1.3 },
    { x: 1.3, z: 1.3 },
  ];
  climbingPlatformRails.forEach(({ x, z }) => {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6),
      structureMaterial
    );
    rail.position.set(x, 3.7, z);
    climbingGroup.add(rail);
  });
  
  // Tiang penyangga (lebih banyak)
  const supportPoles = [
    { x: -1.5, z: -1.5 },
    { x: 1.5, z: -1.5 },
    { x: -1.5, z: 1.5 },
    { x: 1.5, z: 1.5 },
    { x: 0, z: -1.5 },
    { x: 0, z: 1.5 },
    { x: -1.5, z: 0 },
    { x: 1.5, z: 0 },
  ];
  supportPoles.forEach(({ x, z }) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.5, 6),
      structureMaterial
    );
    pole.position.set(x, 1.75, z);
    climbingGroup.add(pole);
  });
  
  // Tangga panjat (lebih detail dengan side rails)
  const ladderSteps = 6;
  for (let i = 0; i < ladderSteps; i++) {
    const rung = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.12, 0.12),
      structureMaterial
    );
    rung.position.set(0, i * 0.55 + 0.5, -1.2);
    rung.rotation.y = Math.PI / 4;
    climbingGroup.add(rung);
  }
  
  // Side rails untuk tangga
  const ladderRails = [
    { x: -0.8, z: -1.2 },
    { x: 0.8, z: -1.2 },
  ];
  ladderRails.forEach(({ x, z }) => {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 3.3, 6),
      structureMaterial
    );
    rail.rotation.y = Math.PI / 4;
    rail.position.set(x, 1.65, z);
    climbingGroup.add(rail);
  });
  
  // Climbing holds (pegangan panjat) di tiang utama
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const hold = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6b6b, roughness: 0.3 })
    );
    hold.position.set(
      Math.cos(angle) * 0.3,
      i * 0.4 + 0.8,
      Math.sin(angle) * 0.3
    );
    climbingGroup.add(hold);
  }
  
  climbingGroup.position.set(playgroundX + 15, 0, playgroundZ - 15);
  climbingGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  scene.add(climbingGroup);
  
  // 4. SEESAW (Jungkat-jungkit) - Lebih detail dan realistis
  const seesawGroup = new THREE.Group();
  
  // Base/pivot (lebih besar dan stabil)
  const seesawBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.6, 8),
    structureMaterial
  );
  seesawBase.position.set(0, 0.3, 0);
  seesawGroup.add(seesawBase);
  
  // Support untuk base
  const baseSupports = [
    { x: -0.3, z: 0 },
    { x: 0.3, z: 0 },
  ];
  baseSupports.forEach(({ x, z }) => {
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.3, 0.2),
      structureMaterial
    );
    support.position.set(x, 0.15, z);
    seesawGroup.add(support);
  });
  
  // Papan jungkat-jungkit (lebih lebar dan detail)
  const seesawBoard = new THREE.Mesh(
    new THREE.BoxGeometry(7, 0.25, 1),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7 }) // Coklat untuk papan
  );
  seesawBoard.position.set(0, 0.75, 0);
  seesawBoard.rotation.z = Math.PI / 18; // Sedikit miring
  seesawGroup.add(seesawBoard);
  
  // Pivot point di tengah papan
  const pivotPoint = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.3, 8),
    structureMaterial
  );
  pivotPoint.position.set(0, 0.9, 0);
  seesawGroup.add(pivotPoint);
  
  // Handle/grip di ujung (lebih besar dan jelas)
  const handles = [
    { x: -3.2, z: 0 },
    { x: 3.2, z: 0 },
  ];
  handles.forEach(({ x, z }) => {
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8),
      structureMaterial
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(x, 0.95, z);
    seesawGroup.add(handle);
    
    // Support untuk handle
    const handleSupport = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.3, 0.15),
      structureMaterial
    );
    handleSupport.position.set(x, 0.8, z);
    seesawGroup.add(handleSupport);
  });
  
  // Footrest di ujung papan
  const footrests = [
    { x: -3, z: 0 },
    { x: 3, z: 0 },
  ];
  footrests.forEach(({ x, z }) => {
    const footrest = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.1, 0.3),
      structureMaterial
    );
    footrest.position.set(x, 0.7, z);
    seesawGroup.add(footrest);
  });
  
  seesawGroup.position.set(playgroundX - 15, 0, playgroundZ + 15);
  seesawGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  scene.add(seesawGroup);
  
  // 5. BENCH (Bangku)
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.4, 1),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 })
  );
  bench.position.set(playgroundX + 15, 0.2, playgroundZ + 15);
  bench.castShadow = true;
  scene.add(bench);
  
  // 6. Tambahkan beberapa pohon kecil di sekitar playground
  const treePositions = [
    { x: playgroundX - 20, z: playgroundZ - 20 },
    { x: playgroundX + 20, z: playgroundZ - 20 },
    { x: playgroundX - 20, z: playgroundZ + 20 },
  ];
  
  treePositions.forEach(({ x, z }) => {
    if (x >= minExtent && x <= maxExtent && z >= minExtent && z <= maxExtent) {
      createTree(x, 0, z, true);
    }
  });
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
  
  // Variasi warna jendela yang lebih terang dan cerah (kempling)
  const windowColors = [
    0xffff00, // Kuning sangat terang
    0xffd700, // Emas terang
    0xffeb3b, // Kuning lemon terang
    0xffa500, // Orange terang
    0x00ffff, // Cyan terang
    0x87ceeb, // Sky blue terang
    0xff69b4, // Pink terang
    0x1a1a2e, // Biru gelap (mati)
    0x0a0e27, // Hitam (mati)
  ];
  
  for (let i = 0; i < windowCount; i++) {
    for (let j = 0; j < windowDepth; j++) {
      for (let k = 1; k < Math.floor(height / windowSpacing); k++) {
        if (randFloat() > 0.4) continue; // 60% jendela terisi
        
        const windowY = k * windowSpacing;
        const windowHeight = windowSpacing * 0.6;
        const windowWidth = (width / windowCount) * 0.7;
        
        // Pilih warna jendela (80% menyala dengan warna terang, 20% mati)
        const isLit = randFloat() > 0.2;
        const windowColor = isLit 
          ? windowColors[randInt(0, 6)] 
          : windowColors[randInt(7, 8)];
        
        const windowMaterial = new THREE.MeshStandardMaterial({
          color: windowColor,
          roughness: 0.05,
          metalness: 0.95,
          emissive: isLit ? windowColor : 0x000000,
          emissiveIntensity: isLit ? 1.2 : 0,
          transparent: isLit,
          opacity: isLit ? 0.9 : 0.3,
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
  
  // Variasi warna jendela yang lebih terang dan cerah (kempling)
  const windowColors = [
    0xffff00, // Kuning sangat terang
    0xffd700, // Emas terang
    0xffeb3b, // Kuning lemon terang
    0xffa500, // Orange terang
    0x00ffff, // Cyan terang
    0x87ceeb, // Sky blue terang
    0xff69b4, // Pink terang
    0x90ee90, // Light green terang
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
      
      // Pilih warna jendela (85% menyala dengan warna terang, 15% mati)
      const isLit = randFloat() > 0.15;
      const windowColor = isLit 
        ? windowColors[randInt(0, 7)] 
        : windowColors[randInt(8, 9)];
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.05,
        metalness: 0.95,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 1.3 : 0,
        transparent: isLit,
        opacity: isLit ? 0.9 : 0.3,
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
      
      const isLit = randFloat() > 0.3;
      // Warna jendela yang lebih terang dan cerah
      const brightColors = [0xffff00, 0xffd700, 0xffeb3b, 0xffa500, 0x00ffff, 0x87ceeb];
      const windowColor = isLit 
        ? brightColors[randInt(0, brightColors.length - 1)]
        : 0x1a1a2e;
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.05,
        metalness: 0.95,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 1.1 : 0,
        transparent: isLit,
        opacity: isLit ? 0.9 : 0.3,
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
      
      const isLit = randFloat() > 0.25;
      // Warna jendela yang lebih terang dan cerah
      const brightColors = [0xffff00, 0xffd700, 0xffeb3b, 0xffa500, 0x00ffff, 0x87ceeb, 0xff69b4];
      const windowColor = isLit 
        ? brightColors[randInt(0, brightColors.length - 1)]
        : 0x1a1a2e;
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.05,
        metalness: 0.95,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 1.2 : 0,
        transparent: isLit,
        opacity: isLit ? 0.9 : 0.3,
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
      
      const isLit = randFloat() > 0.15; // Lebih banyak menyala untuk komersial
      // Warna jendela yang lebih terang dan cerah untuk komersial
      const brightColors = [0xffff00, 0xffd700, 0xffeb3b, 0xffa500, 0x00ffff, 0x87ceeb, 0xff69b4];
      const windowColor = isLit 
        ? brightColors[randInt(0, brightColors.length - 1)]
        : 0x0a0e27;
      
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: windowColor,
        roughness: 0.05,
        metalness: 0.95,
        emissive: isLit ? windowColor : 0x000000,
        emissiveIntensity: isLit ? 1.4 : 0,
        transparent: isLit,
        opacity: isLit ? 0.9 : 0.3,
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
  
  // Gunakan batas pagar sebagai referensi - pagar ada di CITY.size / 2
  // Jadi semua elemen harus berada di dalam dengan margin yang cukup
  const fencePosition = CITY.size / 2;
  const safetyMargin = 10; // Margin keamanan dari pagar
  const maxExtent = fencePosition - safetyMargin;
  const minExtent = -fencePosition + safetyMargin;
  const totalSize = (maxExtent - minExtent);
  
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
      const road = createRoad(roadLength, width, roadX, roadZ, 0, 0x654321); // Brown untuk jalan hutan
      if (road) {
        horizontalRoads.push({ x: roadX, z: roadZ, width, length: roadLength });
      }
    }
    
    // Jalan vertikal - pastikan tidak melebihi batas
    if (snappedI >= minExtent && snappedI <= maxExtent && isFinite(snappedI)) {
      const road = createRoad(roadLength, width, 0, snappedI, Math.PI / 2, 0x654321); // Brown untuk jalan hutan
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
        color: 0x654321, // Brown untuk intersection jalan hutan
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
  // Jarak minimum dari jalan (termasuk sidewalk dan median)
  // Sidewalk width = 2, road width bisa sampai 18, jadi buffer = maxRoadWidth/2 + sidewalk + margin
  // Buffer diperbesar lebih besar untuk memastikan pohon tidak di atas jalan
  const roadMargin = maxRoadWidth / 2 + 2 + 20; // 20 unit buffer untuk memastikan tidak di atas jalan
  
  // Cek jalan horizontal (z = 0, ±roadSpacing, ±2*roadSpacing, dll)
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue; // Skip area plaza
    const distanceToRoad = Math.abs(z - i);
    // Cek apakah terlalu dekat dengan jalan horizontal
    if (distanceToRoad < roadMargin) {
      return true; // Terlalu dekat dengan jalan horizontal
    }
  }
  
  // Cek jalan vertikal (x = 0, ±roadSpacing, ±2*roadSpacing, dll)
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue; // Skip area plaza
    const distanceToRoad = Math.abs(x - i);
    // Cek apakah terlalu dekat dengan jalan vertikal
    if (distanceToRoad < roadMargin) {
      return true; // Terlalu dekat dengan jalan vertikal
    }
  }
  
  // Cek tambahan: pastikan tidak di tengah jalan (median area) dengan buffer lebih besar
  // Untuk jalan horizontal, cek apakah z terlalu dekat dengan posisi jalan
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue;
    // Cek apakah berada di area median (sangat dekat dengan garis tengah jalan)
    // Buffer diperbesar untuk memastikan tidak di atas jalan
    if (Math.abs(z - i) < maxRoadWidth / 2 + 10) {
      return true; // Berada di area median atau di atas jalan
    }
  }
  
  // Untuk jalan vertikal, cek apakah x terlalu dekat dengan posisi jalan
  for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
    if (Math.abs(i) < CITY.plazaRadius + 15) continue;
    // Cek apakah berada di area median (sangat dekat dengan garis tengah jalan)
    // Buffer diperbesar untuk memastikan tidak di atas jalan
    if (Math.abs(x - i) < maxRoadWidth / 2 + 10) {
      return true; // Berada di area median atau di atas jalan
    }
  }
  
  return false;
}

// Fungsi untuk mengecek apakah posisi berada di area intersection (area kuning)
function isInIntersection(x, z, roadSpacing, maxRoadWidth) {
  const intersectionRadius = maxRoadWidth / 2 + 8; // Radius area intersection (termasuk buffer, diperbesar)
  
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
  // Gunakan batas pagar sebagai referensi - pagar ada di CITY.size / 2
  const fencePosition = CITY.size / 2;
  const safetyMargin = 10; // Margin keamanan dari pagar untuk pohon
  const maxExtent = fencePosition - safetyMargin;
  const minExtent = -fencePosition + safetyMargin;
  const roadSpacing = 80; // Harus sama dengan di createNewRoadNetwork
  const maxRoadWidth = 18; // Harus sama dengan di createNewRoadNetwork
  
  // Hutan: Tambahkan lebih banyak pohon untuk suasana hutan yang lebat
  const treeCount = 80; // Jumlah pohon untuk suasana hutan
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
    
    // Skip area linear park (sudah ada pohon di sana) - timur dan barat
    if ((Math.abs(x - 120) < 25 || Math.abs(x + 120) < 25) && Math.abs(z + 40) < 115) continue;
    
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
  
  // Hapus pohon yang berada di atas jalan setelah semua pohon dibuat
  removeTreesOnRoads(roadSpacing, maxRoadWidth);
}

// Fungsi untuk menghapus pohon yang berada di atas jalan
function removeTreesOnRoads(roadSpacing, maxRoadWidth) {
  const roadMargin = maxRoadWidth / 2 + 2; // Margin untuk area jalan (termasuk sidewalk)
  let removedCount = 0;
  
  // Iterasi semua objek di scene
  const objectsToRemove = [];
  scene.traverse((object) => {
    // Cek apakah ini adalah tree group (memiliki trunk dan canopy)
    if (object.isGroup && object.children.length > 0) {
      const hasTrunk = object.children.some(child => 
        child.isMesh && child.geometry && child.geometry.type === 'CylinderGeometry'
      );
      const hasCanopy = object.children.some(child => 
        child.isMesh && child.geometry && child.geometry.type === 'ConeGeometry'
      );
      
      if (hasTrunk && hasCanopy) {
        // Ini adalah pohon, cek posisinya
        const x = object.position.x;
        const z = object.position.z;
        
        // Cek apakah berada di atas jalan horizontal
        for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
          if (Math.abs(i) < CITY.plazaRadius + 15) continue;
          if (Math.abs(z - i) < roadMargin) {
            objectsToRemove.push(object);
            break;
          }
        }
        
        // Cek apakah berada di atas jalan vertikal
        if (!objectsToRemove.includes(object)) {
          for (let i = -CITY.size / 2; i <= CITY.size / 2; i += roadSpacing) {
            if (Math.abs(i) < CITY.plazaRadius + 15) continue;
            if (Math.abs(x - i) < roadMargin) {
              objectsToRemove.push(object);
              break;
            }
          }
        }
        
        // Cek apakah berada di intersection
        if (!objectsToRemove.includes(object)) {
          if (isInIntersection(x, z, roadSpacing, maxRoadWidth)) {
            objectsToRemove.push(object);
          }
        }
      }
    }
  });
  
  // Hapus pohon yang berada di atas jalan
  objectsToRemove.forEach(tree => {
    // Dispose geometry dan material
    tree.traverse((child) => {
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
    scene.remove(tree);
    removedCount++;
  });
  
  if (removedCount > 0) {
    console.log(`Removed ${removedCount} trees that were on roads`);
  }
}

// Fungsi untuk mengecek apakah posisi terlalu dekat dengan taman
function isTooCloseToPark(x, z, buildingHalfWidth = 12, buildingHalfDepth = 12) {
  const parkBuffer = 35; // Buffer zone yang lebih besar agar tidak menghalangi pemandangan taman
  
  // Linear Park: posisi x=120 (timur) dan x=-120 (barat), z=-40, ukuran 40 x 220
  const linearParkPositions = [
    { x: 120, z: -40 },   // Taman timur
    { x: -120, z: -40 }   // Taman barat
  ];
  const linearParkWidth = 40;
  const linearParkDepth = 220;
  
  // Cek apakah gedung terlalu dekat dengan linear park (timur atau barat)
  for (const park of linearParkPositions) {
    const linearParkMinX = park.x - linearParkWidth / 2 - parkBuffer - buildingHalfWidth;
    const linearParkMaxX = park.x + linearParkWidth / 2 + parkBuffer + buildingHalfWidth;
    const linearParkMinZ = park.z - linearParkDepth / 2 - parkBuffer - buildingHalfDepth;
    const linearParkMaxZ = park.z + linearParkDepth / 2 + parkBuffer + buildingHalfDepth;
    
    if (x >= linearParkMinX && x <= linearParkMaxX && 
        z >= linearParkMinZ && z <= linearParkMaxZ) {
      return true; // Terlalu dekat dengan linear park
    }
  }
  
  // Water Garden: posisi sekitar x=-160, z=130, ukuran 140 x 32
  const waterGardenX = -160;
  const waterGardenZ = 130;
  const waterGardenWidth = 140;
  const waterGardenDepth = 32;
  
  // Cek apakah gedung terlalu dekat dengan water garden
  const waterGardenMinX = waterGardenX - waterGardenWidth / 2 - parkBuffer - buildingHalfWidth;
  const waterGardenMaxX = waterGardenX + waterGardenWidth / 2 + parkBuffer + buildingHalfWidth;
  const waterGardenMinZ = waterGardenZ - waterGardenDepth / 2 - parkBuffer - buildingHalfDepth;
  const waterGardenMaxZ = waterGardenZ + waterGardenDepth / 2 + parkBuffer + buildingHalfDepth;
  
  if (x >= waterGardenMinX && x <= waterGardenMaxX && 
      z >= waterGardenMinZ && z <= waterGardenMaxZ) {
    return true; // Terlalu dekat dengan water garden
  }
  
  return false;
}

// Fungsi untuk populate city dengan gedung baru
function populateNewCity() {
  // Gunakan batas pagar sebagai referensi - pagar ada di CITY.size / 2
  const fencePosition = CITY.size / 2;
  const safetyMargin = 15; // Margin keamanan dari pagar untuk gedung
  const maxExtent = fencePosition - safetyMargin;
  const minExtent = -fencePosition + safetyMargin;
  const buildingSpacing = 55; // Jarak antar gedung (diperbesar untuk memberi ruang lebih)
  const roadSpacing = 80; // Harus sama dengan di createNewRoadNetwork
  const maxRoadWidth = 18; // Lebar jalan maksimum untuk perhitungan jarak
  
  // Buat grid gedung baru dengan jarak yang lebih besar dari jalan
  for (let x = minExtent + 30; x <= maxExtent - 30; x += buildingSpacing) {
    for (let z = minExtent + 30; z <= maxExtent - 30; z += buildingSpacing) {
      // Skip area plaza dan area khusus
      if (Math.abs(x) < CITY.plazaRadius + 20 && Math.abs(z) < CITY.plazaRadius + 20) continue;
      
      // Cek apakah terlalu dekat dengan taman (sebelum menghitung ukuran gedung)
      // Gunakan ukuran maksimum gedung untuk safety check
      if (isTooCloseToPark(x, z, 12.5, 12.5)) {
        continue; // Skip jika terlalu dekat dengan taman
      }
      
      // Cek apakah terlalu dekat dengan jalan
      if (isTooCloseToRoad(x, z, roadSpacing, maxRoadWidth)) {
        continue; // Skip jika terlalu dekat dengan jalan
      }
      
      // Cek juga apakah gedung akan overlap dengan jalan berdasarkan ukuran gedung
      const buildingWidth = randFloat(12, 25);
      const buildingDepth = randFloat(12, 25);
      const buildingHalfWidth = buildingWidth / 2;
      const buildingHalfDepth = buildingDepth / 2;
      
      // Cek ulang dengan ukuran gedung yang sebenarnya apakah terlalu dekat dengan taman
      if (isTooCloseToPark(x, z, buildingHalfWidth, buildingHalfDepth)) {
        continue; // Skip jika gedung dengan ukuran sebenarnya terlalu dekat dengan taman
      }
      
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
  
  // Buat pagar pembatas di sekeliling map
  createMapBoundary();
  
  // Road network dibuat setelah ground tapi sebelum buildings
  // karena populateCity akan membuat grid yang digunakan untuk roads
  createRoundabout();
  // createLinearPark(); // Dihapus sesuai permintaan
  // createWaterGarden(); // Dihapus sesuai permintaan
  // Hutan: Hapus elemen kota (playground, street lights, transit hub, buildings)
  // createPlayground(); // Tidak perlu untuk hutan
  // placeStreetLights(); // Tidak perlu untuk hutan
  // createTransitHub(); // Tidak perlu untuk hutan
  
  // Buat jalan baru terlebih dahulu
  createNewRoadNetwork();
  
  // Hutan: Tidak perlu building, hanya pohon
  // populateNewCity(); // Tidak perlu building untuk hutan
  
  // Sebarkan pohon secara terpencar di seluruh kota (setelah gedung dibuat)
  scatterTrees();
  
  // Hapus pohon dan rumput yang berada di atas jalan
  removeTreesOnRoads(80, 18); // roadSpacing = 80, maxRoadWidth = 18
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
            // Optimasi: Nonaktifkan shadow casting pada car untuk performa lebih baik
            child.castShadow = false;
            
            // Deteksi dan ubah material jendela mobil
            const name = child.name ? child.name.toLowerCase() : "";
            if (
              name.includes("window") ||
              name.includes("glass") ||
              name.includes("windshield") ||
              name.includes("jendela") ||
              name.includes("kaca")
            ) {
              // Buat material jendela yang lebih terang dan cerah (kempling)
              // Warna-warna terang untuk jendela mobil
              const brightWindowColors = [
                0x87ceeb, // Sky blue terang
                0x00bfff, // Deep sky blue
                0x4a90e2, // Biru terang
                0x5dade2, // Light blue
                0x7fb3d3, // Sky blue
              ];
              const windowColor = brightWindowColors[Math.floor(Math.random() * brightWindowColors.length)];
              
              const windowMaterial = new THREE.MeshStandardMaterial({
                color: windowColor,
                roughness: 0.05,
                metalness: 0.2,
                transparent: true,
                opacity: 0.5, // Lebih transparan untuk efek kaca yang lebih baik
                emissive: windowColor,
                emissiveIntensity: 0.5, // Lebih terang
              });
              child.material = windowMaterial;
            }
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
  // Y dinaikkan sedikit untuk posisi yang lebih tinggi
  first: new THREE.Vector3(0, 1.7, -0.8),
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

  // Parameter mobil untuk collision detection
  const carLength = 3.5; // Panjang mobil (dari center ke depan/belakang)
  const carWidth = 1.8; // Lebar mobil
  const safetyMargin = 1.5; // Margin keamanan dari pagar (dikurangi agar lebih dekat)
  
  // Batas map dengan margin yang cukup untuk mencegah bagian depan mobil menembus
  const maxExtent = CITY.size / 2 - safetyMargin - carLength / 2; // Kurangi dengan setengah panjang mobil
  const minExtent = -CITY.size / 2 + safetyMargin + carLength / 2;
  
  // Simpan posisi sebelumnya untuk collision detection
  const prevX = car.position.x;
  const prevZ = car.position.z;
  
  // Hitung posisi depan mobil berdasarkan rotasi
  const frontOffsetX = Math.sin(car.rotation.y) * (carLength / 2);
  const frontOffsetZ = Math.cos(car.rotation.y) * (carLength / 2);
  const rearOffsetX = -Math.sin(car.rotation.y) * (carLength / 2);
  const rearOffsetZ = -Math.cos(car.rotation.y) * (carLength / 2);
  
  const frontX = car.position.x + frontOffsetX;
  const frontZ = car.position.z + frontOffsetZ;
  const rearX = car.position.x + rearOffsetX;
  const rearZ = car.position.z + rearOffsetZ;

  // Cek collision SEBELUM bergerak - khusus untuk bagian depan mobil
  let canMoveForward = true;
  let canMoveBackward = true;
  
  if (movingForward) {
    // Cek apakah bagian depan akan menembus pagar jika bergerak maju
    const nextFrontX = frontX + Math.sin(car.rotation.y) * speed;
    const nextFrontZ = frontZ + Math.cos(car.rotation.y) * speed;
    
    if (nextFrontX > maxExtent || nextFrontX < minExtent || 
        nextFrontZ > maxExtent || nextFrontZ < minExtent) {
      canMoveForward = false;
    }
  }
  
  if (movingBackward) {
    // Cek apakah bagian belakang akan menembus pagar jika bergerak mundur
    const nextRearX = rearX - Math.sin(car.rotation.y) * speed * 0.5;
    const nextRearZ = rearZ - Math.cos(car.rotation.y) * speed * 0.5;
    
    if (nextRearX > maxExtent || nextRearX < minExtent || 
        nextRearZ > maxExtent || nextRearZ < minExtent) {
      canMoveBackward = false;
    }
  }

  // Hanya bergerak jika tidak akan menembus pagar
  if (movingForward && canMoveForward) {
    car.position.x += Math.sin(car.rotation.y) * speed;
    car.position.z += Math.cos(car.rotation.y) * speed;
  }
  if (movingBackward && canMoveBackward) {
    car.position.x -= Math.sin(car.rotation.y) * speed * 0.5;
    car.position.z -= Math.cos(car.rotation.y) * speed * 0.5;
  }
  
  // Pastikan bagian depan mobil tidak melewati batas pagar (cek setelah pergerakan)
  const fenceBoundary = CITY.size / 2 - safetyMargin;
  const currentFrontX = car.position.x + Math.sin(car.rotation.y) * (carLength / 2);
  const currentFrontZ = car.position.z + Math.cos(car.rotation.y) * (carLength / 2);
  
  // Hitung ulang posisi center mobil jika bagian depan menembus batas
  if (currentFrontX > fenceBoundary) {
    // Geser mobil mundur agar bagian depan tepat di batas
    car.position.x = fenceBoundary - Math.sin(car.rotation.y) * (carLength / 2);
  } else if (currentFrontX < -fenceBoundary) {
    // Geser mobil mundur agar bagian depan tepat di batas
    car.position.x = -fenceBoundary - Math.sin(car.rotation.y) * (carLength / 2);
  }
  
  if (currentFrontZ > fenceBoundary) {
    // Geser mobil mundur agar bagian depan tepat di batas
    car.position.z = fenceBoundary - Math.cos(car.rotation.y) * (carLength / 2);
  } else if (currentFrontZ < -fenceBoundary) {
    // Geser mobil mundur agar bagian depan tepat di batas
    car.position.z = -fenceBoundary - Math.cos(car.rotation.y) * (carLength / 2);
  }
  
  // Safety net: pastikan center mobil tidak melewati batas yang lebih ketat
  if (car.position.x > maxExtent) {
    car.position.x = maxExtent;
  }
  if (car.position.x < minExtent) {
    car.position.x = minExtent;
  }
  if (car.position.z > maxExtent) {
    car.position.z = maxExtent;
  }
  if (car.position.z < minExtent) {
    car.position.z = minExtent;
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
// Optimasi untuk frame rate lebih tinggi
let lastTime = performance.now();
const targetFPS = 60;
const frameTime = 1000 / targetFPS;

function animate() {
  requestAnimationFrame(animate);
  
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;
  
  // Hanya render dan update jika car sudah dimuat
  if (car && isSceneReady) {
    // Update dengan delta time untuk frame rate konsisten dan lebih tinggi
    updateCar();
    updateCamera();
    renderer.render(scene, camera);
  }
  // Tidak render apapun sampai car dimuat
  
  lastTime = currentTime;
}

// Mulai animasi loop
animate();

