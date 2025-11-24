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

// --- CIRCUIT GENERATION ---
const roadWidth = 12;
const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.9,
    metalness: 0.1,
});

// Straight sections
const straightLength = 200;
const straightGeometry = new THREE.PlaneGeometry(straightLength, roadWidth);

const straight1 = new THREE.Mesh(straightGeometry, roadMaterial);
straight1.rotation.x = -Math.PI / 2;
straight1.position.set(0, 0.01, 50); // z position is radius of curve
scene.add(straight1);

const straight2 = new THREE.Mesh(straightGeometry, roadMaterial);
straight2.rotation.x = -Math.PI / 2;
straight2.position.set(0, 0.01, -50); // z position is -radius of curve
scene.add(straight2);

// Curved sections
const curveRadius = 50 - roadWidth / 2;
const curveGeometry = new THREE.RingGeometry(curveRadius, curveRadius + roadWidth, 32, 1, 0, Math.PI);

const curve1 = new THREE.Mesh(curveGeometry, roadMaterial);
curve1.rotation.x = -Math.PI / 2;
curve1.rotation.z = Math.PI / 2;
curve1.position.set(straightLength / 2, 0.01, 0);
scene.add(curve1);

const curve2 = new THREE.Mesh(curveGeometry, roadMaterial);
curve2.rotation.x = -Math.PI / 2;
curve2.rotation.z = -Math.PI / 2;
curve2.position.set(-straightLength / 2, 0.01, 0);
scene.add(curve2);

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

  const buildingCount = 0;
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
