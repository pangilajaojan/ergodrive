import * as THREE from 'three';

export function createCity(scene: THREE.Scene) {
  // Ground
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Buildings
  const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });

  for (let i = 0; i < 100; i++) {
    const building = new THREE.Mesh(buildingGeometry.clone(), buildingMaterial.clone());
    building.scale.x = Math.random() * 5 + 2;
    building.scale.z = Math.random() * 5 + 2;
    building.scale.y = Math.random() * 20 + 5;

    building.position.x = Math.random() * 180 - 90;
    building.position.z = Math.random() * 180 - 90;
    building.position.y = building.scale.y / 2;

    // Avoid placing buildings on the road/center
    if (Math.abs(building.position.x) < 10 || Math.abs(building.position.z) < 10) {
        continue;
    }

    scene.add(building);
  }
}
