import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2c3e50); // Dark slate grey

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000 // OPTIMIZATION: Reduced far plane
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0x404040, 2.0);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(20, 40, 20);
directionalLight.castShadow = true;
// OPTIMIZATION: Reduced shadow map resolution
directionalLight.shadow.mapSize.width = 512;
directionalLight.shadow.mapSize.height = 512;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 100;
scene.add(directionalLight);

// --- GROUND ---
const groundGeometry = new THREE.PlaneGeometry(400, 400); // Increased map size
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x080808,
  roughness: 0.8,
  metalness: 0.2,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- ROAD GENERATION ---
const mainRoadWidth = 12;
const smallRoadWidth = 8;
const roadLength = 400;

function createRoad(width, length, x, z, rotationY = 0) {
  const roadGeometry = new THREE.PlaneGeometry(width, length);
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.9,
    metalness: 0.1,
  });

  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.rotation.x = -Math.PI / 2;
  road.position.set(x, 0.01, z);
  road.rotation.y = rotationY;
  road.receiveShadow = true;
  scene.add(road);

  // Road markings removed for optimization
  return road;
}

// Main roads
createRoad(roadLength, mainRoadWidth, 0, 0, 0);
createRoad(mainRoadWidth, roadLength, 0, 0, 0);

// Smaller roads
for (let i = -180; i <= 180; i += 40) {
  if (Math.abs(i) > mainRoadWidth / 2) {
    createRoad(roadLength, smallRoadWidth, 0, i, 0);
    createRoad(smallRoadWidth, roadLength, i, 0, 0);
  }
}

// --- CITY & BUILDING GENERATION ---
const buildings = [];
const loader = new GLTFLoader();

function applyCityStyle(object) {
  const colors = [
    0x808080, 0xa9a9a9, 0x696969, 0x778899, 0xcd853f, 0x8b4513, 0x4682b4,
  ];
  object.traverse((child) => {
    if (child.isMesh) {
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      child.material = new THREE.MeshStandardMaterial({
        color: randomColor,
        roughness: 0.8,
        metalness: 0.1,
      });
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function isValidBuildingPosition(x, z, width, depth) {
  const roadMargin = 4;
  const mainRoadHalf = mainRoadWidth / 2 + roadMargin;
  const smallRoadHalf = smallRoadWidth / 2 + roadMargin;

  if (Math.abs(x) < mainRoadHalf || Math.abs(z) < mainRoadHalf) return false;

  for (let i = -180; i <= 180; i += 40) {
    if (Math.abs(i) > mainRoadHalf) {
      if (Math.abs(z - i) < smallRoadHalf) return false;
      if (Math.abs(x - i) < smallRoadHalf) return false;
    }
  }

  const minDistance = 5;
  for (const other of buildings) {
    const dist = Math.sqrt(
      (x - other.position.x) ** 2 + (z - other.position.z) ** 2
    );
    if (dist < minDistance + width / 2 + other.geometry.parameters.width / 2) {
      return false;
    }
  }

  return true;
}

loader.load("d:\\ccity_building_set_1.glb", (gltf) => {
  const sourceBuilding = gltf.scene;
  applyCityStyle(sourceBuilding);

  const box = new THREE.Box3().setFromObject(sourceBuilding);
  const center = box.getCenter(new THREE.Vector3());
  sourceBuilding.position.sub(center);

  const buildingCount = 150;
  for (let i = 0; i < buildingCount; i++) {
    let positionFound = false;
    let x, z;
    const buildingWidth = Math.random() * 8 + 6;
    const buildingDepth = Math.random() * 8 + 6;
    const buildingHeight = Math.random() * 40 + 15;

    for (let attempt = 0; attempt < 20; attempt++) {
      x = Math.random() * 380 - 190;
      z = Math.random() * 380 - 190;
      if (isValidBuildingPosition(x, z, buildingWidth, buildingDepth)) {
        positionFound = true;
        break;
      }
    }

    if (positionFound) {
      const newBuilding = sourceBuilding.clone(true);
      newBuilding.scale.set(buildingWidth, buildingHeight, buildingDepth);
      newBuilding.position.set(x, buildingHeight / 2, z);
      newBuilding.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);
      scene.add(newBuilding);
      buildings.push({
        position: newBuilding.position,
        geometry: { parameters: { width: buildingWidth } },
      });
    }
  }
});

// --- CAR ---
let car;
loader.load(
  "assets/car.glb",
  (gltf) => {
    car = gltf.scene;
    car.scale.set(2, 2, 2);
    car.position.y = 0;
    car.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    scene.add(car);
  },
  undefined,
  (error) => {
    console.error("An error happened while loading the car model:", error);
  }
);

// --- SPECIAL APARTMENT ---
loader.load(
  "assets/models/GEDUNG APARTEMENT.glb",
  (gltf) => {
    const apartment = gltf.scene;
    
    // --- Styling and Shadow ---
    apartment.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // --- Sizing and Positioning ---
    const apartmentScale = 15; // Adjust scale as needed
    apartment.scale.set(apartmentScale, apartmentScale, apartmentScale);

    // Center the model geometry
    const box = new THREE.Box3().setFromObject(apartment);
    const center = box.getCenter(new THREE.Vector3());
    apartment.position.sub(center); 

    // Get the height of the model after scaling
    const size = box.getSize(new THREE.Vector3());
    const height = size.y;
    
    // Position the apartment
    apartment.position.set(20, height / 2, 20); // x=20, z=20, y is half of height

    scene.add(apartment);
    
    // Add to buildings array for collision avoidance with other generated buildings
    buildings.push({
        position: apartment.position,
        geometry: { parameters: { width: size.x } },
    });
  },
  undefined,
  (error) => {
    console.error("An error happened while loading the apartment model:", error);
  }
);

// --- CONTROLS ---
const keyboardState = {};
window.addEventListener("keydown", (e) => (keyboardState[e.code] = true));
window.addEventListener("keyup", (e) => (keyboardState[e.code] = false));

const speed = 0.4;
const rotationSpeed = 0.04;

function updateCar() {
  if (!car) return;
  if (keyboardState["ArrowUp"] || keyboardState["KeyW"]) {
    car.position.x += Math.sin(car.rotation.y) * speed;
    car.position.z += Math.cos(car.rotation.y) * speed;
  }
  if (keyboardState["ArrowDown"] || keyboardState["KeyS"]) {
    car.position.x -= Math.sin(car.rotation.y) * speed * 0.5;
    car.position.z -= Math.cos(car.rotation.y) * speed * 0.5;
  }
  if (keyboardState["ArrowLeft"] || keyboardState["KeyA"]) {
    car.rotation.y += rotationSpeed;
  }
  if (keyboardState["ArrowRight"] || keyboardState["KeyD"]) {
    car.rotation.y -= rotationSpeed;
  }
}

// --- CAMERA ---
function updateCamera() {
  if (!car) return;
  const cameraOffset = new THREE.Vector3(0, 5, -10);
  cameraOffset.applyQuaternion(car.quaternion);
  cameraOffset.add(car.position);
  camera.position.lerp(cameraOffset, 0.1);
  camera.lookAt(car.position);
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
