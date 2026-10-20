import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const RINGS = 6;
const PER_RING = 12; // 6 × 12 = 72 plates
const THETA_FRONT = 0.68; // polar angle where the iris housing ends
const THETA_BACK = 2.98;
const R = 1;
const BLADES = 9;
const BLADE_R = 0.62;
const LIP_R = 0.555;

const INK = new THREE.Color('#0b0b0c');
const AMBER = new THREE.Color('#ffae4a');
const SIGNAL = new THREE.Color('#ff4d1a');

export function createEye(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = INK;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(2.3, 0.8, 7.0);
  camera.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight('#fff1dc', 2.2);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fb4ff', 0.7);
  rim.position.set(3, 3, -5);
  scene.add(rim);
  const under = new THREE.DirectionalLight(SIGNAL, 0.5);
  under.position.set(0, -5, 2);
  scene.add(under);

  // Whole assembly; `eye` is what gazes, `orbits` stay roughly in world frame.
  const world = new THREE.Group();
  scene.add(world);
  const eye = new THREE.Group();
  world.add(eye);

  // ── Core & inner cage ────────────────────────────────────────────────
  const coreLight = new THREE.PointLight(AMBER, 0, 4, 1.6);
  eye.add(coreLight);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 48, 32),
    new THREE.MeshBasicMaterial({ color: AMBER.clone(), toneMapped: false })
  );
  eye.add(core);

  const cageMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uGlow: { value: 0.3 }, uTime: { value: 0 }, uColor: { value: AMBER.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      void main(){
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow; uniform float uTime; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      float line(float x, float w){ float d = abs(fract(x) - .5); return smoothstep(.5 - w, .5, d); }
      void main(){
        float lon = line(vUv.x * 48., .035);
        float lat = line(vUv.y * 24., .04);
        float grid = max(lon, lat);
        float scan = smoothstep(.0, .02, sin(vUv.y * 90. - uTime * 3.) - .96);
        float f = pow(1. - abs(dot(normalize(-vP), vN)), 2.);
        vec3 base = vec3(.018, .016, .014);
        vec3 c = base + uColor * (grid * (.06 + 1.4 * uGlow) + scan * uGlow * .9 + f * .15 * uGlow);
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  // open at the front so the iris sits in front of a glowing chamber
  const cage = new THREE.Mesh(new THREE.SphereGeometry(0.93, 96, 64, 0, Math.PI * 2, THETA_FRONT - 0.04, Math.PI), cageMat);
  cage.rotation.x = Math.PI / 2;
  eye.add(cage);

  // ── 72 plates ───────────────────────────────────────────────────────
  const matTitanium = new THREE.MeshStandardMaterial({ color: '#bdb7ab', metalness: 1, roughness: 0.3, side: THREE.DoubleSide });
  const matGraphite = new THREE.MeshStandardMaterial({ color: '#45433f', metalness: 0.92, roughness: 0.42, side: THREE.DoubleSide });
  const matEnamel = new THREE.MeshStandardMaterial({ color: SIGNAL, metalness: 0.15, roughness: 0.38, side: THREE.DoubleSide });
  const matInner = new THREE.MeshStandardMaterial({ color: '#1a1917', metalness: 0.7, roughness: 0.6, side: THREE.DoubleSide });

  const plates = [];
  const dTheta = (THETA_BACK - THETA_FRONT) / RINGS;
  const dPhi = (Math.PI * 2) / PER_RING;
  const accent = new Set([3, 17, 40, 58]);
  for (let ring = 0; ring < RINGS; ring++) {
    const th0 = THETA_FRONT + ring * dTheta + 0.012;
    const th1 = THETA_FRONT + (ring + 1) * dTheta - 0.012;
    const geo = tileGeometry(th0, th1, dPhi, 0.035);
    // hinge on the rear edge so the front edge lifts toward the viewer
    const hinge = new THREE.Vector3(Math.sin(th1) * R, 0, Math.cos(th1) * R);
    geo.translate(-hinge.x, -hinge.y, -hinge.z);
    for (let k = 0; k < PER_RING; k++) {
      const idx = ring * PER_RING + k;
      const root = new THREE.Group();
      root.rotation.z = k * dPhi + (ring % 2) * dPhi * 0.5;
      const pivot = new THREE.Group();
      pivot.position.copy(hinge);
      const mat = accent.has(idx) ? matEnamel : (ring + k) % 3 === 0 ? matGraphite : matTitanium;
      const mesh = new THREE.Mesh(geo, [mat, matInner]);
      pivot.add(mesh);
      root.add(pivot);
      eye.add(root);
      plates.push({ pivot, ring, k, hinge, jitter: Math.random() });
    }
  }

  // rear boss
  const boss = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.26, 0.12, 48),
    new THREE.MeshStandardMaterial({ color: '#2b2a27', metalness: 1, roughness: 0.35 })
  );
  boss.rotation.x = Math.PI / 2;
  boss.position.z = -0.99;
  eye.add(boss);

  // ── Iris housing ────────────────────────────────────────────────────
  const zFront = Math.cos(THETA_FRONT);
  const housingProfile = [
    [LIP_R, zFront - 0.06],
    [LIP_R, zFront + 0.035],
    [LIP_R + 0.02, zFront + 0.06],
    [0.64, zFront + 0.065],
    [0.675, zFront + 0.035],
    [0.69, zFront - 0.04],
    [0.66, zFront - 0.12],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const housing = new THREE.Mesh(
    new THREE.LatheGeometry(housingProfile, 128),
    new THREE.MeshStandardMaterial({ color: '#2d2c29', metalness: 1, roughness: 0.28 })
  );
  housing.rotation.x = Math.PI / 2;
  eye.add(housing);

  // knurl / index ticks on the bezel
  const tickGeo = new THREE.BoxGeometry(0.006, 0.035, 0.012);
  const tickMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', metalness: 0.6, roughness: 0.4 });
  const ticks = new THREE.InstancedMesh(tickGeo, tickMat, 90);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const long = i % 10 === 0;
    m4.compose(
      new THREE.Vector3(Math.cos(a) * 0.615, Math.sin(a) * 0.615, zFront + 0.068),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2),
      new THREE.Vector3(1, long ? 1.5 : 1, 1)
    );
    ticks.setMatrixAt(i, m4);
  }
  eye.add(ticks);

  // ── 9-blade iris ────────────────────────────────────────────────────
  const ARC = 22;
  const bladeMats = [
    new THREE.MeshStandardMaterial({ color: '#59606b', metalness: 0.95, roughness: 0.3, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: '#434850', metalness: 0.95, roughness: 0.36, side: THREE.DoubleSide }),
  ];
  const blades = [];
  const edgeMat = new THREE.LineBasicMaterial({ color: '#d9d3c5', transparent: true, opacity: 0.55 });
  for (let i = 0; i < BLADES; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC * 3), 3));
    const index = [];
    for (let k = 1; k < ARC - 1; k++) index.push(0, k, k + 1);
    g.setIndex(index);
    const mesh = new THREE.Mesh(g, bladeMats[i % 2]);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const edge = new THREE.Line(edgeGeo, edgeMat);
    mesh.add(edge);
    eye.add(mesh);
    blades.push(mesh);
  }
  function setIris(aperture, twist) {
    // aperture = distance from centre to each blade's chord
    const a = THREE.MathUtils.clamp(aperture, 0.012, BLADE_R - 0.004);
    const beta = Math.acos(a / BLADE_R);
    for (let i = 0; i < BLADES; i++) {
      const phi = (i / BLADES) * Math.PI * 2 + twist;
      const pos = blades[i].geometry.attributes.position;
      const tx = -Math.sin(phi);
      const ty = Math.cos(phi);
      for (let k = 0; k < ARC; k++) {
        const ang = phi - beta + (2 * beta * k) / (ARC - 1);
        const x = Math.cos(ang) * BLADE_R;
        const y = Math.sin(ang) * BLADE_R;
        // shingle: each blade climbs along its tangent so overlaps stay consistent
        const along = (x * tx + y * ty) / BLADE_R;
        pos.setXYZ(k, x, y, zFront - 0.03 + 0.012 * (along + 1));
      }
      pos.needsUpdate = true;
      const e = blades[i].children[0].geometry.attributes.position;
      e.setXYZ(0, pos.getX(0), pos.getY(0), pos.getZ(0) + 0.002);
      e.setXYZ(1, pos.getX(ARC - 1), pos.getY(ARC - 1), pos.getZ(ARC - 1) + 0.002);
      e.needsUpdate = true;
      blades[i].geometry.computeVertexNormals();
      blades[i].geometry.computeBoundingSphere();
    }
  }

  // ── Lens ────────────────────────────────────────────────────────────
  const lens = new THREE.Group();
  eye.add(lens);
  const barrelMat = new THREE.MeshStandardMaterial({ color: '#141414', metalness: 0.9, roughness: 0.35 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.62, 64, 1, true), barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.31;
  lens.add(barrel);
  [-0.08, -0.2, -0.44].forEach((z, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.262, i === 0 ? 0.012 : 0.006, 12, 96),
      new THREE.MeshStandardMaterial({ color: i === 0 ? '#cfc8ba' : '#5b5853', metalness: 1, roughness: 0.25 })
    );
    ring.position.z = z;
    lens.add(ring);
  });
  const faceRing = new THREE.Mesh(
    new THREE.RingGeometry(0.17, 0.262, 96),
    new THREE.MeshStandardMaterial({ color: '#0e0e0e', metalness: 0.8, roughness: 0.5 })
  );
  lens.add(faceRing);
  const pupilMat = new THREE.MeshBasicMaterial({ color: AMBER.clone(), toneMapped: false });
  const pupil = new THREE.Mesh(new THREE.RingGeometry(0.115, 0.13, 96), pupilMat);
  pupil.position.z = -0.03;
  lens.add(pupil);
  const innerRings = [];
  for (let i = 0; i < 3; i++) {
    const r = 0.05 + i * 0.024;
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.004, 64),
      new THREE.MeshBasicMaterial({ color: AMBER.clone(), toneMapped: false, transparent: true, opacity: 0.6 })
    );
    m.position.z = -0.05 - i * 0.012;
    lens.add(m);
    innerRings.push(m);
  }
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 64, 16, 0, Math.PI * 2, 0, 0.62),
    new THREE.MeshPhysicalMaterial({
      color: '#0a1014',
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.55,
      envMapIntensity: 2.4,
      iridescence: 0.6,
      iridescenceIOR: 1.6,
    })
  );
  glass.rotation.x = Math.PI / 2;
  glass.position.z = -0.24;
  lens.add(glass);

  // ── Two orbit rings ─────────────────────────────────────────────────
  const orbitMat = new THREE.MeshStandardMaterial({ color: '#d9d3c5', metalness: 0.8, roughness: 0.3 });
  const orbits = [];
  const mkOrbit = (radius, tilt, yaw, tickCount, beads) => {
    const frame = new THREE.Group();
    frame.rotation.set(tilt, yaw, 0);
    world.add(frame);
    const spin = new THREE.Group();
    frame.add(spin);
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(radius, 0.0045, 8, 360), orbitMat));
    const tg = new THREE.BoxGeometry(0.004, 0.04, 0.004);
    const inst = new THREE.InstancedMesh(tg, orbitMat, tickCount);
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2;
      const long = i % 8 === 0;
      m4.compose(
        new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a),
        new THREE.Vector3(1, long ? 2.2 : 1, 1)
      );
      inst.setMatrixAt(i, m4);
    }
    spin.add(inst);
    const beadMeshes = beads.map(([a, size, color, glow]) => {
      const mat = glow
        ? new THREE.MeshBasicMaterial({ color, toneMapped: false })
        : new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.3 });
      const b = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 16), mat);
      b.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      spin.add(b);
      return b;
    });
    orbits.push({ frame, spin, beadMeshes, baseTilt: tilt, baseYaw: yaw });
  };
  mkOrbit(1.5, 1.22, 0.25, 160, [
    [0.4, 0.045, SIGNAL, true],
    [2.9, 0.026, '#d9d3c5', false],
  ]);
  mkOrbit(1.8, 1.78, -0.5, 96, [
    [1.6, 0.034, '#d9d3c5', false],
    [4.4, 0.02, AMBER, true],
  ]);

  // ── Post ────────────────────────────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.35, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ── State ───────────────────────────────────────────────────────────
  const history = new Float32Array(64);
  let hHead = 0;
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };
  const pointer = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });
  let orbitPhase = 0;
  let irisTwist = 0;

  function resize(width, height, panelWidth) {
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    // shift the optical centre into the space left of the panel
    const usable = width - panelWidth;
    const portrait = width < 820;
    camera.clearViewOffset();
    if (!portrait && panelWidth > 0) {
      // centre slightly right of the usable area, clear of the masthead
      camera.setViewOffset(width, height, panelWidth / 2 - usable * 0.085, -height * 0.015, width, height);
    } else if (portrait) {
      camera.setViewOffset(width, height, 0, height * 0.2, width, height);
    }
    camera.fov = portrait ? 58 : usable / height < 1.05 ? 37 : 32.5;
    camera.updateProjectionMatrix();
  }

  /**
   * p: { plates, iris, lens, core, orbit, gaze, flash, tremble, mood } all 0..1
   */
  function update(p, dt, time) {
    // plate wave: ring r reads the plate signal from r*2 frames ago
    history[hHead] = p.plates;
    hHead = (hHead + 1) % history.length;
    for (const pl of plates) {
      const delay = pl.ring * 2 + (pl.k % 2);
      const v = history[(hHead - 1 - delay + history.length * 4) % history.length];
      const flutter = p.tremble * 0.05 * Math.sin(time * 37 + pl.jitter * 40);
      const open = Math.max(0, v + flutter);
      pl.pivot.rotation.y = open * (0.95 - pl.ring * 0.06);
      pl.pivot.position.copy(pl.hinge).multiplyScalar(1 + open * 0.07);
    }

    // iris: blades rotate as they close
    irisTwist = THREE.MathUtils.lerp(irisTwist, (1 - p.iris) * 1.15, 1 - Math.exp(-dt * 10));
    setIris(0.02 + p.iris * 0.54, irisTwist);

    // lens can only leave the housing once the iris clears it
    const clearance = THREE.MathUtils.smoothstep(p.iris, 0.42, 0.6);
    const ext = p.lens * clearance;
    lens.position.z = zFront - 0.07 + ext * 0.55;

    // core / highs
    const glow = p.core;
    const hot = new THREE.Color().copy(AMBER).lerp(new THREE.Color('#fff4e0'), glow * 0.6);
    core.material.color.copy(hot).multiplyScalar(0.3 + glow * 1.8 + p.flash * 2);
    pupilMat.color.copy(hot).multiplyScalar(0.4 + glow * 2.2 + p.flash * 2);
    innerRings.forEach((r, i) => {
      r.material.color.copy(hot).multiplyScalar(0.15 + glow * (1.1 - i * 0.25));
    });
    cageMat.uniforms.uGlow.value = glow * 0.55 + p.flash * 0.35;
    cageMat.uniforms.uTime.value = time;
    coreLight.intensity = 0.2 + glow * 2.2 + p.flash * 3;
    bloom.strength = 0.32 + glow * 0.28 + p.flash * 0.5;

    // orbits
    orbitPhase += dt * (0.08 + p.orbit * 1.1);
    orbits.forEach((o, i) => {
      o.spin.rotation.z = orbitPhase * (i ? -0.7 : 1);
      o.frame.rotation.x = o.baseTilt + Math.sin(time * 0.11 + i * 2) * 0.06;
      o.frame.rotation.y = o.baseYaw + time * (i ? -0.03 : 0.022);
    });

    // gaze: saccades, pointer pull, and a downward "thinking" tilt when closed
    if (time > gaze.next) {
      const range = 0.12 + p.gaze * 0.35;
      gaze.tx = (Math.random() * 2 - 1) * range;
      gaze.ty = (Math.random() * 2 - 1) * range * 0.6;
      gaze.next = time + 0.6 + Math.random() * (2.6 - p.gaze * 1.6);
    }
    const think = 1 - p.mood;
    // rest pose: three-quarters toward the viewer, so the body reads as a sphere
    const tx = 0.17 + gaze.tx * (1 - think * 0.7) + pointer.x * 0.25;
    const ty = -0.06 + gaze.ty * (1 - think * 0.7) + pointer.y * 0.18 + think * 0.24;
    const k = 1 - Math.exp(-dt * (6 + p.gaze * 10));
    gaze.x += (tx - gaze.x) * k;
    gaze.y += (ty - gaze.y) * k;
    eye.rotation.y = gaze.x;
    eye.rotation.x = gaze.y;
    const breathe = 1 + Math.sin(time * 1.3) * 0.006 * (0.5 + think) + p.lens * 0.012;
    eye.scale.setScalar(breathe);
    world.position.y = Math.sin(time * 0.6) * 0.03;
    world.rotation.z = p.tremble * Math.sin(time * 61) * 0.004;

    composer.render();
  }

  setIris(0.3, 0);
  return { update, resize, renderer };
}

/**
 * A thick spherical tile centred on φ=0, spanning polar angles th0..th1.
 * Group 0: outer face, group 1: underside and walls.
 */
function tileGeometry(th0, th1, dPhi, thickness) {
  const positions = [];
  const indices = [];
  const uvs = [];
  const groups = [];
  const P = (th, ph, r) => [Math.sin(th) * Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r, Math.cos(th) * r];
  const gap = (th) => 0.02 / Math.max(0.15, Math.sin(th));
  const phiAt = (th, v) => {
    const half = dPhi / 2 - gap(th);
    return -half + 2 * half * v;
  };
  const grid = (U, V, f) => {
    const base = positions.length / 3;
    for (let j = 0; j <= V; j++) {
      for (let i = 0; i <= U; i++) {
        positions.push(...f(i / U, j / V));
        uvs.push(i / U, j / V);
      }
    }
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < U; i++) {
        const a = base + j * (U + 1) + i;
        const b = a + 1;
        const c = a + U + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  };
  const ro = R;
  const ri = R - thickness;
  const th = (u) => th0 + (th1 - th0) * u;
  let start = 0;
  // outer face (u: theta, v: phi)
  grid(8, 8, (u, v) => P(th(u), phiAt(th(u), v), ro));
  groups.push([start, indices.length - start, 0]);
  start = indices.length;
  // inner face (reversed winding)
  grid(8, 8, (u, v) => P(th(u), phiAt(th(u), 1 - v), ri));
  // walls
  grid(8, 1, (u, v) => P(th(u), phiAt(th(u), 0), ri + (ro - ri) * v));
  grid(8, 1, (u, v) => P(th(u), phiAt(th(u), 1), ro - (ro - ri) * v));
  grid(8, 1, (u, v) => P(th0, phiAt(th0, 1 - u), ri + (ro - ri) * v));
  grid(8, 1, (u, v) => P(th1, phiAt(th1, u), ri + (ro - ri) * v));
  groups.push([start, indices.length - start, 1]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  groups.forEach(([s, c, m]) => g.addGroup(s, c, m));
  g.computeVertexNormals();
  return g;
}
