/* eslint-disable @typescript-eslint/no-explicit-any */
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { parseGlb } from '../aircraft/ModelLoader';
import { JetModel } from '../aircraft/ProceduralJet';
import { AIRCRAFT_LIST } from '../data/aircraft';

/**
 * Development-only helpers (loaded via dynamic import behind `import.meta.env.DEV`, so they are not in production builds).
 * Available in the console as `afterburn.tools`.
 */
export function installDevTools(game: any): void {
  const tools = {
    /** Render every aircraft from one angle into a single overlay canvas (id 'sheet'). */
    async sheet(yaw = 0.85, pitch = 0.28, opts: { ab?: boolean; cols?: number; ids?: string[]; gear?: boolean; animate?: boolean } = {}) {
      const ids = opts.ids ?? AIRCRAFT_LIST.map((a) => a.id);
      const cols = opts.cols ?? 4;
      const W = 1600;
      const rows = Math.ceil(ids.length / cols);
      const cw = W / cols;
      const ch = cw * 0.5625;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = ch * rows;
      cv.id = 'sheet';
      cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:auto;z-index:99999;background:#000';
      const ctx = cv.getContext('2d')!;
      for (let i = 0; i < ids.length; i++) {
        await game.debug.hangarView(ids[i], yaw, pitch, opts.ab ?? false, opts.gear ?? true, false, 0);
        game.hangar.animate = opts.animate ?? false;
        game.hangar.dist = 0;
        for (let k = 0; k < 10; k++) game.hangar.update(0.3);
        game.renderHangar(0.016);
        const img = new Image();
        img.src = game.canvas.toDataURL();
        await img.decode();
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * ch;
        ctx.drawImage(img, 0, 0, img.width, img.height, x, y, cw, ch);
        ctx.fillStyle = '#5fe0ff';
        ctx.font = '22px sans-serif';
        ctx.fillText(ids[i].toUpperCase(), x + 12, y + 28);
      }
      document.getElementById('sheet')?.remove();
      document.body.appendChild(cv);
    },
    /** Scripted handling comparison for the whole roster: prints a table to the console and returns it. */
    handling(): string {
      const out: string[] = ['id        vmax  200>400  turn@220  spd@6s  turn@130  spd@6s  stall'];
      const DEG = 180 / Math.PI;
      for (const ac of AIRCRAFT_LIST) {
        game.setAircraft(ac.id);
        const dbg = game.debug; // re-fetch: its helpers capture the current player
        const f = dbg.player.flight;
        const c = dbg.player.controls;
        const base = (spd: number, thr = 1) => {
          dbg.setup(-9000, 900, -9000, 180, spd, thr);
          c.afterburner = thr >= 1;
          dbg.step(30);
        };
        // top speed
        base(300);
        dbg.step(60 * 100);
        const vmax = f.speed;
        // acceleration 200 -> 400
        base(200);
        let t400 = -1;
        for (let i = 0; i < 60 * 60 && t400 < 0; i++) { dbg.aimAt(180, 0); dbg.step(1); if (f.speed >= 400) t400 = i / 60; }
        // sustained turn at a given entry speed with the reticle held 40 degrees off
        const turn = (spd: number): [number, number] => {
          base(spd);
          const h0 = f.heading();
          let hd = 0;
          let last = h0;
          for (let i = 0; i < 60 * 6; i++) {
            dbg.aimAt(f.heading() * DEG + 40, 0);
            dbg.step(1);
            let dh = f.heading() - last;
            if (dh > Math.PI) dh -= 2 * Math.PI;
            if (dh < -Math.PI) dh += 2 * Math.PI;
            hd += dh;
            last = f.heading();
          }
          return [Math.abs(hd) * DEG / 6, f.speed];
        };
        const [r220, s220] = turn(220);
        const [r130, s130] = turn(130);
        out.push(
          ac.id.padEnd(9) + String(Math.round(vmax * 3.6)).padStart(5) + (t400 < 0 ? '    n/a' : t400.toFixed(1).padStart(7)) + r220.toFixed(1).padStart(10) +
          String(Math.round(s220 * 3.6)).padStart(8) + r130.toFixed(1).padStart(10) + String(Math.round(s130 * 3.6)).padStart(8) + String(Math.round(ac.flight.stallSpeed * 3.6)).padStart(7),
        );
      }
      game.setAircraft('f16c');
      return out.join('\n');
    },
    /** Export a procedural jet to .glb in memory, load it back through the override loader and swap it onto the player. */
    async glbRoundTrip(id = 'f22'): Promise<string> {
      const def = AIRCRAFT_LIST.find((a) => a.id === id)!;
      const src = new JetModel(def, 0x3aa0ff);
      const buf: ArrayBuffer = await new Promise((res, rej) => new GLTFExporter().parse(src.root, (r) => res(r as ArrayBuffer), rej, { binary: true }));
      const handle = await parseGlb(def, buf);
      game.setAircraft(id);
      const ac = game.debug.player;
      ac.object.remove(ac.model.root);
      ac.model.dispose();
      ac.model = handle;
      ac.object.add(handle.root);
      return `glb ${buf.byteLength} bytes, nozzles ${handle.nozzles.length}, children ${handle.root.children.length}`;
    },
    clearSheet() {
      document.getElementById('sheet')?.remove();
    },
  };
  game.tools = tools;
}
