// Le rétroviseur (l'auteur, 10/11 : « voir derrière et sur les côtés, en vue intérieure ou pas, savoir si un véhicule est derrière moi ») :
// une petite image de ce qu'il y a derrière le véhicule, en haut de l'écran, dans les deux vues. Elle est rendue à part, à basse
// résolution et une image sur deux ou trois, puis affichée inversée comme dans un miroir, dans le cadre #mirror de la page.
// Les deux onglets ◀ ▶ (A et E au clavier) montrent le côté gauche ou le côté droit tant qu'on appuie (rétroviseurs extérieurs).
import * as THREE from 'three';

export class Retro {
  constructor(renderer) {
    this.renderer = renderer;
    this.cam = new THREE.PerspectiveCamera(52, 3, 0.6, 260);
    this.rt = new THREE.WebGLRenderTarget(352, 118, { depthBuffer: true, stencilBuffer: false });
    // L'image est posée sur un carré plein cadre, retournée de gauche à droite (texture lue à l'envers)
    this.rt.texture.wrapS = THREE.RepeatWrapping;
    this.rt.texture.repeat.x = -1;
    this.rt.texture.offset.x = 1;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.rt.texture, depthTest: false, depthWrite: false }));
    this.view = new THREE.Scene();
    this.view.add(this.quad);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.tick = 0;
    this.every = 2;
    this.on = true;
    this.el = document.getElementById('mirror');
    this.glass = this.el?.querySelector('.glass');
    this.rect = null;
    addEventListener('resize', () => { this.rect = null; });
  }
  /** Qualité : résolution de l'image et cadence (haute : une image sur deux ; basse : une sur trois). */
  setQuality(high) {
    this.rt.setSize(high ? 512 : 352, high ? 171 : 118);
    this.every = high ? 2 : 3;
  }
  /** Le cadre à l'écran (pixels CSS), mesuré une fois par taille de fenêtre. */
  frame() {
    if (!this.rect && this.glass) {
      const r = this.glass.getBoundingClientRect();
      if (r.width < 8) return null;              // (HUD caché : on remesurera)
      this.rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return this.rect;
  }
  /** Montre ou cache le cadre (la page) ; l'image suit. */
  show(on) {
    this.on = on;
    if (this.el) this.el.hidden = !on;
    this.rect = null;
  }
  /**
   * Dessine le rétroviseur par-dessus l'image principale. pos / look : position et point visé de la caméra arrière (monde).
   * hide : objets à cacher pendant cette prise de vue (le poste de conduite accroché à la caméra principale).
   */
  render(scene, pos, look, hide = []) {
    const R = this.renderer, rect = this.frame();
    if (!this.on || !rect || rect.width < 8) return;
    const size = R.getSize(new THREE.Vector2());
    if (this.tick++ % this.every === 0) {
      this.cam.position.copy(pos);
      this.cam.lookAt(look);
      this.cam.aspect = rect.width / rect.height;
      this.cam.updateProjectionMatrix();
      const was = hide.map(o => o.visible);
      for (const o of hide) o.visible = false;
      R.setRenderTarget(this.rt);
      R.clear();
      R.render(scene, this.cam);
      R.setRenderTarget(null);
      hide.forEach((o, i) => { o.visible = was[i]; });
    }
    R.setScissorTest(true);
    R.setViewport(rect.left, size.y - rect.top - rect.height, rect.width, rect.height);
    R.setScissor(rect.left, size.y - rect.top - rect.height, rect.width, rect.height);
    const auto = R.autoClear;
    R.autoClear = false;
    R.clearDepth();
    R.render(this.view, this.ortho);
    R.autoClear = auto;
    R.setScissorTest(false);
    R.setViewport(0, 0, size.x, size.y);
  }
}
