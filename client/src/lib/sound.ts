// Short beeps for the barcode scanner, like a supermarket till: a high blip for "added", a
// low buzz for "unknown code". The cashier is looking at the packet, not the screen.

let ctx: AudioContext | null = null;

export function beep(kind: 'ok' | 'error'): void {
  try {
    // One shared context: browsers limit how many can exist, and a scan can happen every second.
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const length = kind === 'ok' ? 0.09 : 0.3;
    osc.type = kind === 'ok' ? 'sine' : 'square';
    osc.frequency.value = kind === 'ok' ? 1760 : 220;
    gain.gain.setValueAtTime(kind === 'ok' ? 0.15 : 0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length);
  } catch {
    // No audio output: the screen still shows what happened.
  }
}
