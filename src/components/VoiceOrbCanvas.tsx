import { useEffect, useRef } from 'react';

export type VoiceOrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceOrbCanvasProps {
  state: VoiceOrbState;
  audioLevelRef: { current: number };
  onOrbClick?: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  hueOffset: number;
}

export function VoiceOrbCanvas({ state, audioLevelRef, onOrbClick }: VoiceOrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<VoiceOrbState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const particles: Particle[] = Array.from({ length: 42 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00035,
      radius: 0.9 + Math.random() * 1.8,
      alpha: 0.15 + Math.random() * 0.45,
      hueOffset: Math.random(),
    }));

    let rafId = 0;
    let smoothedLevel = 0;
    let phase = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const drawFrame = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : 400;
      const height = parent ? parent.clientHeight : 400;
      const cx = width / 2;
      const cy = height / 2;
      const minDim = Math.min(width, height);
      const baseRadius = Math.max(58, Math.min(112, minDim * 0.22));

      const currentState = stateRef.current;
      const rawLevel = Math.max(0, Math.min(1, audioLevelRef.current));
      smoothedLevel = smoothedLevel * 0.8 + rawLevel * 0.2;

      const speed =
        currentState === 'thinking'
          ? 0.055
          : currentState === 'speaking'
            ? 0.042 + smoothedLevel * 0.04
            : currentState === 'listening'
              ? 0.028 + smoothedLevel * 0.025
              : 0.015;

      if (!reducedMotion) {
        phase += speed;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Subtle drifting background particles
      for (const p of particles) {
        if (!reducedMotion) {
          const boost =
            currentState === 'speaking'
              ? 1 + smoothedLevel * 2.2
              : currentState === 'thinking'
                ? 1.6
                : 1;
          p.x += p.vx * boost;
          p.y += p.vy * boost;
          if (p.x < -0.05) p.x = 1.05;
          if (p.x > 1.05) p.x = -0.05;
          if (p.y < -0.05) p.y = 1.05;
          if (p.y > 1.05) p.y = -0.05;
        }

        const px = p.x * width;
        const py = p.y * height;
        const dist = Math.hypot(px - cx, py - cy);
        const nearOrbBoost = Math.max(0, 1 - dist / (baseRadius * 3.4));
        const particleColor =
          p.hueOffset < 0.33
            ? `rgba(56, 189, 248, ${p.alpha + nearOrbBoost * 0.25})`
            : p.hueOffset < 0.66
              ? `rgba(129, 140, 248, ${p.alpha + nearOrbBoost * 0.25})`
              : `rgba(167, 139, 250, ${p.alpha + nearOrbBoost * 0.25})`;

        ctx.beginPath();
        ctx.arc(px, py, p.radius + nearOrbBoost * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = particleColor;
        ctx.fill();
      }

      // 2. Outer atmospheric halo
      const breath =
        currentState === 'speaking'
          ? Math.sin(phase * 1.4) * 5 + smoothedLevel * 28
          : currentState === 'listening'
            ? Math.sin(phase) * 4 + smoothedLevel * 22
            : currentState === 'thinking'
              ? Math.sin(phase * 2) * 6
              : Math.sin(phase) * 3;

      const orbRadius = baseRadius + breath;

      const haloGrad = ctx.createRadialGradient(
        cx,
        cy,
        orbRadius * 0.5,
        cx,
        cy,
        orbRadius * 2.45
      );
      if (currentState === 'speaking') {
        haloGrad.addColorStop(0, `rgba(56, 189, 248, ${0.26 + smoothedLevel * 0.24})`);
        haloGrad.addColorStop(0.45, `rgba(139, 92, 246, ${0.16 + smoothedLevel * 0.14})`);
        haloGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      } else if (currentState === 'listening') {
        haloGrad.addColorStop(0, `rgba(34, 211, 238, ${0.24 + smoothedLevel * 0.22})`);
        haloGrad.addColorStop(0.5, 'rgba(59, 130, 246, 0.12)');
        haloGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      } else if (currentState === 'thinking') {
        haloGrad.addColorStop(0, 'rgba(139, 92, 246, 0.28)');
        haloGrad.addColorStop(0.5, 'rgba(59, 130, 246, 0.14)');
        haloGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      } else {
        haloGrad.addColorStop(0, 'rgba(59, 130, 246, 0.16)');
        haloGrad.addColorStop(0.55, 'rgba(99, 102, 241, 0.08)');
        haloGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      }

      ctx.beginPath();
      ctx.arc(cx, cy, orbRadius * 2.45, 0, Math.PI * 2);
      ctx.fillStyle = haloGrad;
      ctx.fill();

      // 3. Animated sound wave rings around the orb
      const waveCount = currentState === 'idle' ? 2 : 4;
      for (let w = 0; w < waveCount; w++) {
        const waveProgress = ((phase * 0.25 + w / waveCount) % 1);
        const expandDist =
          currentState === 'speaking'
            ? baseRadius * (1.08 + waveProgress * (0.85 + smoothedLevel * 0.65))
            : currentState === 'listening'
              ? baseRadius * (1.06 + waveProgress * (0.72 + smoothedLevel * 0.55))
              : currentState === 'thinking'
                ? baseRadius * (1.08 + waveProgress * 0.52)
                : baseRadius * (1.06 + waveProgress * 0.35);

        const fadeAlpha =
          (1 - waveProgress) *
          (currentState === 'speaking'
            ? 0.42 + smoothedLevel * 0.32
            : currentState === 'listening'
              ? 0.32 + smoothedLevel * 0.3
              : currentState === 'thinking'
                ? 0.34
                : 0.16);

        ctx.beginPath();
        const points = 96;
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          let ripple = 0;
          if (currentState === 'speaking') {
            ripple =
              Math.sin(angle * 5 + phase * 3 + w) * (3 + smoothedLevel * 13) +
              Math.cos(angle * 3 - phase * 2.2) * (2 + smoothedLevel * 7);
          } else if (currentState === 'listening') {
            ripple =
              Math.sin(angle * 4 - phase * 2.4 + w) * (2 + smoothedLevel * 11);
          } else if (currentState === 'thinking') {
            ripple = Math.sin(angle * 6 + phase * 3.4 + w * 1.2) * 3.5;
          } else {
            ripple = Math.sin(angle * 3 + phase) * 1.2;
          }

          const r = expandDist + ripple;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        ctx.strokeStyle =
          w % 3 === 0
            ? `rgba(34, 211, 238, ${fadeAlpha})`
            : w % 3 === 1
              ? `rgba(96, 165, 250, ${fadeAlpha})`
              : `rgba(167, 139, 250, ${fadeAlpha})`;
        ctx.lineWidth = currentState === 'speaking' ? 1.8 : 1.35;
        ctx.stroke();
      }

      // 4. Thinking orbital arc
      if (currentState === 'thinking') {
        for (let a = 0; a < 2; a++) {
          const start = phase * (a === 0 ? 1.8 : -1.4) + a * Math.PI;
          ctx.beginPath();
          ctx.arc(cx, cy, orbRadius + 14 + a * 8, start, start + Math.PI * 0.65);
          ctx.strokeStyle = a === 0 ? 'rgba(167, 139, 250, 0.78)' : 'rgba(34, 211, 238, 0.65)';
          ctx.lineWidth = 2.4;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      // 5. 3D-style Volumetric Orb Sphere
      ctx.save();
      ctx.beginPath();
      const spherePoints = 80;
      for (let i = 0; i <= spherePoints; i++) {
        const angle = (i / spherePoints) * Math.PI * 2;
        const deform =
          currentState === 'speaking'
            ? Math.sin(angle * 4 + phase * 3.2) * (1.8 + smoothedLevel * 6.5) +
              Math.cos(angle * 3 - phase * 2.1) * (1.2 + smoothedLevel * 4)
            : currentState === 'listening'
              ? Math.sin(angle * 3 + phase * 2) * (1.2 + smoothedLevel * 4.5)
              : currentState === 'thinking'
                ? Math.sin(angle * 5 - phase * 3) * 2
                : Math.sin(angle * 2 + phase) * 0.8;
        const r = orbRadius + deform;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Base 3D sphere shading (top-left highlight -> deep indigo-cyan core)
      const lightX = cx - orbRadius * 0.34 + Math.cos(phase * 0.7) * 6;
      const lightY = cy - orbRadius * 0.36 + Math.sin(phase * 0.7) * 6;
      const sphereGrad = ctx.createRadialGradient(
        lightX,
        lightY,
        orbRadius * 0.08,
        cx,
        cy,
        orbRadius * 1.08
      );

      if (currentState === 'listening') {
        sphereGrad.addColorStop(0, '#E0F2FE');
        sphereGrad.addColorStop(0.22, '#22D3EE');
        sphereGrad.addColorStop(0.58, '#2563EB');
        sphereGrad.addColorStop(0.88, '#4F46E5');
        sphereGrad.addColorStop(1, '#1E1B4B');
      } else if (currentState === 'thinking') {
        sphereGrad.addColorStop(0, '#EDE9FE');
        sphereGrad.addColorStop(0.24, '#A78BFA');
        sphereGrad.addColorStop(0.6, '#6366F1');
        sphereGrad.addColorStop(0.88, '#0284C7');
        sphereGrad.addColorStop(1, '#1E1B4B');
      } else if (currentState === 'speaking') {
        sphereGrad.addColorStop(0, '#F0F9FF');
        sphereGrad.addColorStop(0.22, '#38BDF8');
        sphereGrad.addColorStop(0.54, '#6366F1');
        sphereGrad.addColorStop(0.84, '#7C3AED');
        sphereGrad.addColorStop(1, '#172554');
      } else {
        sphereGrad.addColorStop(0, '#BAE6FD');
        sphereGrad.addColorStop(0.25, '#38BDF8');
        sphereGrad.addColorStop(0.62, '#2563EB');
        sphereGrad.addColorStop(0.9, '#312E81');
        sphereGrad.addColorStop(1, '#0F172A');
      }

      ctx.fillStyle = sphereGrad;
      ctx.fill();
      ctx.clip();

      // Internal aurora ribbons for 3D glass depth
      for (let k = 0; k < 2; k++) {
        const ribbonGrad = ctx.createRadialGradient(
          cx + Math.cos(phase * (1.1 + k * 0.4) + k * 2) * orbRadius * 0.42,
          cy + Math.sin(phase * (0.9 + k * 0.3) + k * 2) * orbRadius * 0.42,
          2,
          cx,
          cy,
          orbRadius * 0.95
        );
        ribbonGrad.addColorStop(
          0,
          k === 0 ? 'rgba(34, 211, 238, 0.55)' : 'rgba(168, 85, 247, 0.48)'
        );
        ribbonGrad.addColorStop(1, 'rgba(37, 99, 235, 0)');
        ctx.fillStyle = ribbonGrad;
        ctx.fillRect(cx - orbRadius - 10, cy - orbRadius - 10, orbRadius * 2 + 20, orbRadius * 2 + 20);
      }

      // Rim specular highlight
      const rimGrad = ctx.createRadialGradient(
        cx + orbRadius * 0.35,
        cy + orbRadius * 0.38,
        orbRadius * 0.2,
        cx,
        cy,
        orbRadius
      );
      rimGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0)');
      rimGrad.addColorStop(1, 'rgba(186, 230, 253, 0.32)');
      ctx.fillStyle = rimGrad;
      ctx.fillRect(cx - orbRadius - 10, cy - orbRadius - 10, orbRadius * 2 + 20, orbRadius * 2 + 20);

      ctx.restore();

      // Crisp specular ring edge
      ctx.beginPath();
      ctx.arc(cx, cy, orbRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      rafId = window.requestAnimationFrame(drawFrame);
    };

    rafId = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [audioLevelRef]);

  return (
    <div
      onClick={onOrbClick}
      role={onOrbClick ? 'button' : undefined}
      tabIndex={onOrbClick ? 0 : undefined}
      aria-label={onOrbClick ? 'Interact with CHROMO Voice Orb' : undefined}
      onKeyDown={(e) => {
        if (onOrbClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOrbClick();
        }
      }}
      className="relative w-full h-full flex items-center justify-center cursor-pointer select-none focus:outline-none"
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
