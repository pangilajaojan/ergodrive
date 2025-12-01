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
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x4d6fa0, 0x0b180d, 1.0);
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
const CITY = {
  size: 420,
  mainRoadWidth: 16,
  secondaryRoadWidth: 9,
  diagonalRoadWidth: 7,
  blockSpacing: 56,
  blockOffset: 26,
  plazaRadius: 40,
  density: 0.65,
};

const gridExtent = CITY.size / 2 - 20;
const loader = new GLTFLoader();
const buildings = [];

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

function buildRoadNetwork() {
  for (let i = -gridExtent; i <= gridExtent; i += CITY.blockSpacing) {
    const width =
      Math.abs(i) < 2 ? CITY.mainRoadWidth : CITY.secondaryRoadWidth;
    createRoad(CITY.size, width, i, 0);
    createRoad(CITY.size, width, 0, i);

    if (Math.abs(i) < 2) {
      createLaneMarkings(CITY.size * 0.98, 0.8, i + width / 4, 0);
      createLaneMarkings(CITY.size * 0.98, 0.8, i - width / 4, 0);
      createLaneMarkings(CITY.size * 0.98, 0.8, 0, i + width / 4, Math.PI / 2);
      createLaneMarkings(CITY.size * 0.98, 0.8, 0, i - width / 4, Math.PI / 2);
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
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(140, 2, 32),
    new THREE.MeshStandardMaterial({
      color: 0x1a5f73,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.85,
    })
  );
  water.position.set(-90, 1, 130);
  scene.add(water);

  for (let i = -60; i <= 60; i += 20) {
    createTree(-30 + randSpread(10), 0, 130 + i);
  }
}

function createTree(x, y, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.4, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a2f10, roughness: 0.9 })
  );
  trunk.position.set(x, y + 3, z);
  trunk.castShadow = true;
  scene.add(trunk);

  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(randFloat(3.5, 4.5), randFloat(5, 7), 12),
    new THREE.MeshStandardMaterial({ color: 0x1f5b2c, roughness: 0.6 })
  );
  canopy.position.set(x, y + 8.5, z);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  scene.add(canopy);
}

function createLinearPark() {
  const park = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 220),
    new THREE.MeshStandardMaterial({ color: 0x1b3a1a })
  );
  park.rotation.x = -Math.PI / 2;
  park.position.set(120, 0.04, -40);
  scene.add(park);

  for (let i = -90; i <= 90; i += 18) {
    createTree(120 + randSpread(10), 0, -40 + i);
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
  for (let i = -gridExtent; i <= gridExtent; i += 36) {
    if (Math.abs(i) > CITY.mainRoadWidth + 20 && i % 72 !== 0) continue;
    createStreetLight(CITY.mainRoadWidth, i, Math.PI);
    createStreetLight(-CITY.mainRoadWidth, i, 0);
    if (Math.abs(i) < CITY.mainRoadWidth + 4) {
      createStreetLight(i, CITY.mainRoadWidth, -Math.PI / 2);
      createStreetLight(i, -CITY.mainRoadWidth, Math.PI / 2);
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

function populateCity() {
  for (
    let x = -gridExtent + CITY.blockOffset;
    x <= gridExtent - CITY.blockOffset;
    x += CITY.blockSpacing
  ) {
    for (
      let z = -gridExtent + CITY.blockOffset;
      z <= gridExtent - CITY.blockOffset;
      z += CITY.blockSpacing
    ) {
      if (Math.abs(x) < CITY.plazaRadius && Math.abs(z) < CITY.plazaRadius)
        continue;
      if (Math.random() > CITY.density) continue;

      const zone = ZONES[getZoneForPosition(x, z)];
      const clusterCount = randInt(zone.cluster[0], zone.cluster[1]);
      for (let i = 0; i < clusterCount; i++) {
        if (Math.random() > CITY.density) continue;
        const width = randFloat(zone.footprint[0], zone.footprint[1]);
        const depth = randFloat(zone.footprint[0], zone.footprint[1]);
        const height = randFloat(zone.height[0], zone.height[1]) * 0.9;
        const color = zone.colors[randInt(0, zone.colors.length - 1)];
        const building = createBuildingMesh(
          width,
          depth,
          height,
          color,
          zone.roughness,
          zone.metalness
        );

        building.position.set(
          x + randSpread(CITY.blockSpacing * 0.35),
          height / 2,
          z + randSpread(CITY.blockSpacing * 0.35)
        );
        scene.add(building);
        buildings.push(building);
      }
    }
  }
}

function createTransitHub() {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(70, 6, 30),
    new THREE.MeshStandardMaterial({
      color: 0x2d3439,
      metalness: 0.3,
      roughness: 0.4,
    })
  );
  base.position.set(150, 3, 110);
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
  roof.position.set(150, 15, 110);
  scene.add(roof);
}

function scatterDetails() {
  createGroundLayers();
  createRoundabout();
  createWaterGarden();
  createLinearPark();
  placeStreetLights();
  createTransitHub();
  populateCity();
}

scatterDetails();

// --- CAR ---
let car;
let steeringWheel = null;
loader.load(
  "assets/car.glb",
  (gltf) => {
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
  },
  undefined,
  (error) => {
    console.error("An error happened while loading the car model:", error);
  }
);

// --- PARK ---
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
    console.error("An error happened while loading the park model:", error);
  }
);

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
    camera.position.lerp(
      new THREE.Vector3(
        car.position.x + offset.x,
        car.position.y + offset.y,
        car.position.z + offset.z
      ),
      0.15
    );
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
  } else {
    camera.position.lerp(desiredPosition, lerpSpeed);
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
  updateCar();
  updateCamera();
  renderer.render(scene, camera);
}

animate();
