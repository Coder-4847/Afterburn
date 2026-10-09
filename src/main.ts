import './ui/style.css';
import { Game } from './core/Game';

const app = document.getElementById('app')!;
const game = new Game(app);

game.init().catch((err) => {
  console.error(err);
  const ui = document.getElementById('ui')!;
  ui.style.pointerEvents = 'auto';
  ui.innerHTML = `<div class="overlay solid"><div class="panel"><p class="brand">AFTERBURN</p><h1 class="title">Could not start</h1><p class="sub">${String(
    err && (err as Error).message ? (err as Error).message : err,
  )}</p><p class="sub">AFTERBURN needs a browser with WebGL2 enabled (current Chrome, Edge, Firefox or Safari).</p></div></div>`;
});

if (import.meta.env.DEV) {
  (window as unknown as { afterburn: unknown }).afterburn = game;
  void import('./core/devtools').then((m) => m.installDevTools(game));
}
