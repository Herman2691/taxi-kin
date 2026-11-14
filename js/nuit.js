// La nuit (l'auteur, 10/11 : « les lumières la nuit ne sont pas suffisantes, et les phares du véhicule ou de la moto doivent fonctionner
// pour voir la route ») : les halos des phares et des feux de toutes les voitures d'une route en deux nuages de points (avant blanc,
// arrière rouge : deux appels de dessin pour toute la circulation), et le faisceau des phares du véhicule du joueur, une tache de lumière
// allongée posée sur la chaussée devant lui (plan additif, pas de vraie lumière : trop lourd pour le téléphone).
import * as THREE from 'three';
import { lampSpots } from './models.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let GLOW = null;
const glowTex = () => GLOW ??= canvasTex(64, 64, (x, w, h) => {
  const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, w, h);
});

/** Halos des phares et des feux des véhicules d'une route (group : le groupe de cette route, où ses voitures sont posées). */
export class NightGlow {
  constructor(group, max = 220) {
    this.max = max;
    const mk = (size, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      g.setDrawRange(0, 0);
      const m = new THREE.PointsMaterial({ size, map: glowTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false; p.visible = false; p.renderOrder = 6;
      group.add(p);
      return p;
    };
    this.front = mk(1.25, 0xfff1c8);
    this.rear = mk(0.7, 0xff3b30);
  }
  /** vehicles : { mesh, len, wid } posés dans le groupe (mesh.position, mesh.rotation.y) ; k : 0 le jour, 1 la nuit. */
  update(vehicles, k) {
    const vis = k > 0.04;
    this.front.visible = this.rear.visible = vis;
    if (!vis) return;
    const F = this.front.geometry.attributes.position, R = this.rear.geometry.attributes.position, FA = F.array, RA = R.array;
    let nf = 0, nr = 0;
    for (const v of vehicles) {
      const m = v.mesh;
      if (!m || !m.visible) continue;
      const S = lampSpots(v.len, v.wid), p = m.position, c = Math.cos(m.rotation.y), s = Math.sin(m.rotation.y);
      for (const [x, y, z] of S.front) {
        if (nf >= this.max) break;
        FA[nf * 3] = p.x + x * c + z * s; FA[nf * 3 + 1] = p.y + y; FA[nf * 3 + 2] = p.z - x * s + z * c; nf++;
      }
      for (const [x, y, z] of S.rear) {
        if (nr >= this.max) break;
        RA[nr * 3] = p.x + x * c + z * s; RA[nr * 3 + 1] = p.y + y; RA[nr * 3 + 2] = p.z - x * s + z * c; nr++;
      }
    }
    this.front.geometry.setDrawRange(0, nf); F.needsUpdate = true;
    this.rear.geometry.setDrawRange(0, nr); R.needsUpdate = true;
    const o = Math.min(1, k * 1.6);
    this.front.material.opacity = 0.9 * o; this.rear.material.opacity = 0.8 * o;
  }
}

let BEAM_TEX = null;
/** Le faisceau des phares du joueur : plan posé sur la chaussée devant le véhicule (L, W du véhicule ; une moto a un faisceau étroit). */
export function makeBeam(L, W) {
  BEAM_TEX ??= canvasTex(128, 256, (x, w, h) => {
    // Clair près du véhicule (bas de l'image), éteint au loin (haut) ; bords adoucis ; deux lobes près des phares
    const v = x.createLinearGradient(0, h, 0, 0);
    v.addColorStop(0, 'rgba(255,255,255,0.95)'); v.addColorStop(0.3, 'rgba(255,255,255,0.55)'); v.addColorStop(0.7, 'rgba(255,255,255,0.16)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = v; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-in';
    const u = x.createLinearGradient(0, 0, w, 0);
    u.addColorStop(0, 'rgba(0,0,0,0)'); u.addColorStop(0.2, 'rgba(0,0,0,1)'); u.addColorStop(0.8, 'rgba(0,0,0,1)'); u.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = u; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    for (const cx of W < 1 ? [w / 2] : [w * 0.3, w * 0.7]) {
      const g = x.createRadialGradient(cx, h * 0.94, 0, cx, h * 0.94, w * 0.22);
      g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
  });
  const moto = W < 1, bw = moto ? 3.6 : W + 4.6, len = moto ? 17 : 24;
  const geo = new THREE.PlaneGeometry(bw, len).rotateX(-Math.PI / 2).translate(0, 0.06, -(L / 2 + len / 2 - 0.4));
  const mat = new THREE.MeshBasicMaterial({ map: BEAM_TEX, color: 0xfff0c4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2; m.visible = false; m.frustumCulled = false;
  m.rotation.order = 'YXZ';
  return m;
}
/** Allume le faisceau selon la nuit (k) et la lumière des phares (coupés : 0). */
export function setBeam(m, k) {
  m.visible = k > 0.04;
  m.material.opacity = Math.min(1, k * 1.5) * 0.8;
}
