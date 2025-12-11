import React, { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  OrbitControls,
  Environment,
  Instances,
  Instance,
  Float,
  Sparkles,
  Text,
  Html,
  useCursor,
  Stars
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';

// --- Configuration & Constants ---
const CONFIG = {
  NEEDLE_COUNT: 1800,
  GOLD_ORNAMENT_COUNT: 45,
  RED_ORNAMENT_COUNT: 35,
  LIGHT_COUNT: 250,
  TREE_HEIGHT: 14,
  TREE_RADIUS: 6,
  SCATTER_RADIUS: 25,
  ANIMATION_SPEED: 2.5,
  COLORS: {
    GOLD: '#FFD700',
    RED_VELVET: '#8A0F0F',
    EMERALD: '#002211',
    NEEDLE: '#0B3B24',
    WARM_LIGHT: '#FFDDaa',
  }
};

// --- Audio System ---
const playChime = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    
    // Main chime
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    // Pentatonic scale-ish random frequency
    const freqs = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
    const freq = freqs[Math.floor(Math.random() * freqs.length)];
    
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.01, t + 1); // slight detune
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 2.5);

    // Sparkle layer
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, t);
    gain2.gain.setValueAtTime(0, t);
    gain2.gain.linearRampToValueAtTime(0.02, t + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t);
    osc2.stop(t + 0.6);

  } catch (e) {
    console.error("Audio error", e);
  }
};

// --- Math Helpers ---
const getRandomPointInSphere = (radius: number) => {
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const r = Math.cbrt(Math.random()) * radius;
  const sinPhi = Math.sin(phi);
  return new THREE.Vector3(
    r * sinPhi * Math.cos(theta),
    r * sinPhi * Math.sin(theta),
    r * Math.cos(phi)
  );
};

const getPointOnCone = (height: number, baseRadius: number) => {
  // Normalized height 0 (bottom) to 1 (top)
  const yNorm = Math.random(); 
  const y = (yNorm - 0.5) * height; // Centered at 0
  const r = (1 - yNorm) * baseRadius; // Radius decreases as we go up
  const theta = Math.random() * Math.PI * 2;
  
  // Add some irregularity
  const rRandom = r * (0.8 + Math.random() * 0.4); 
  
  return {
    pos: new THREE.Vector3(
      rRandom * Math.cos(theta),
      y,
      rRandom * Math.sin(theta)
    ),
    normal: new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)).normalize(), // Rough normal for rotation
    scale: 1 - yNorm * 0.6 // Smaller at top
  };
};

// --- Components ---

// 1. Needles (High count, non-interactive, optimized)
const Needles = ({ mode }: { mode: 'SCATTERED' | 'TREE' }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { positions, rotations, scales } = useMemo(() => {
    const pos = [];
    const rot = [];
    const sca = [];
    for (let i = 0; i < CONFIG.NEEDLE_COUNT; i++) {
      // Tree State
      const { pos: treePos, normal } = getPointOnCone(CONFIG.TREE_HEIGHT, CONFIG.TREE_RADIUS);
      // Scatter State
      const scatterPos = getRandomPointInSphere(CONFIG.SCATTER_RADIUS);
      
      pos.push({ tree: treePos, scatter: scatterPos });
      
      // Orientation
      const quaternion = new THREE.Quaternion();
      // Point outwards from center roughly
      const up = new THREE.Vector3(0, 1, 0);
      quaternion.setFromUnitVectors(up, normal.add(new THREE.Vector3(0, 0.5, 0)).normalize());
      rot.push(quaternion);
      
      sca.push(0.5 + Math.random() * 1.0);
    }
    return { positions: pos, rotations: rot, scales: sca };
  }, []);

  const tempObj = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Smooth transition factor
    const targetT = mode === 'TREE' ? 1 : 0;
    // We use a persistent ref for currentT to damp it
    meshRef.current.userData.t = THREE.MathUtils.damp(
      meshRef.current.userData.t || 0,
      targetT,
      CONFIG.ANIMATION_SPEED,
      delta
    );
    const t = meshRef.current.userData.t;

    // Update instances
    for (let i = 0; i < CONFIG.NEEDLE_COUNT; i++) {
      const { tree, scatter } = positions[i];
      
      // Lerp position
      tempObj.position.lerpVectors(scatter, tree, t);
      
      // Add some floating noise when scattered
      if (t < 0.95) {
        const noiseTime = state.clock.elapsedTime * 0.5;
        tempObj.position.y += Math.sin(noiseTime + i * 0.1) * (1 - t) * 0.5;
        tempObj.position.x += Math.cos(noiseTime + i * 0.1) * (1 - t) * 0.5;
      }

      tempObj.quaternion.copy(rotations[i]);
      // Random rotation while floating
      if (t < 1) {
         tempObj.rotation.x += Math.sin(state.clock.elapsedTime + i) * 0.002 * (1-t);
         tempObj.rotation.z += Math.cos(state.clock.elapsedTime + i) * 0.002 * (1-t);
      }

      tempObj.scale.setScalar(scales[i]);
      tempObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObj.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, CONFIG.NEEDLE_COUNT]}>
      <coneGeometry args={[0.08, 0.6, 4]} />
      <meshStandardMaterial 
        color={CONFIG.COLORS.NEEDLE} 
        roughness={0.8} 
        metalness={0.1} 
      />
    </instancedMesh>
  );
};

// 2. Interactive Gold Ornaments
const GoldOrnament: React.FC<{ data: any; mode: string; t: number }> = ({ data, mode, t }) => {
  const ref = useRef<THREE.Group>(null);
  const [hovered, setHover] = useState(false);
  const [clicked, setClicked] = useState(false);
  
  useCursor(hovered);

  useFrame((state) => {
    if (!ref.current) return;
    
    // Position Lerp
    ref.current.position.lerpVectors(data.scatterPos, data.treePos, t);
    
    // Hover Animation
    const targetScale = (hovered ? 1.4 : 1.0) * (clicked ? 1.6 : 1.0) * data.scale;
    ref.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    
    // Rotate slightly if hovered
    if (hovered) {
      ref.current.rotation.y += 0.05;
    } else {
        // Return to base rotation slowly? Or just idle spin
        ref.current.rotation.y += 0.01;
    }

    if (clicked && state.clock.elapsedTime % 0.2 < 0.1) {
        // Quick pulse reset logic handled by state toggle or simple math
    }
  });
  
  useEffect(() => {
    if (clicked) {
      const timeout = setTimeout(() => setClicked(false), 200);
      return () => clearTimeout(timeout);
    }
  }, [clicked]);

  return (
    <group ref={ref}>
       <Instance
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); playChime(); }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => { e.stopPropagation(); setClicked(true); playChime(); }}
      />
    </group>
  );
};

const Ornaments = ({ mode }: { mode: 'SCATTERED' | 'TREE' }) => {
  // Prepare data
  const goldData = useMemo(() => new Array(CONFIG.GOLD_ORNAMENT_COUNT).fill(0).map(() => {
    const { pos: treePos } = getPointOnCone(CONFIG.TREE_HEIGHT, CONFIG.TREE_RADIUS * 0.9); // Slightly inside
    return {
      treePos,
      scatterPos: getRandomPointInSphere(CONFIG.SCATTER_RADIUS),
      scale: 0.5 + Math.random() * 0.5
    };
  }), []);

  const redData = useMemo(() => new Array(CONFIG.RED_ORNAMENT_COUNT).fill(0).map(() => {
    const { pos: treePos } = getPointOnCone(CONFIG.TREE_HEIGHT, CONFIG.TREE_RADIUS * 0.85);
    return {
      treePos,
      scatterPos: getRandomPointInSphere(CONFIG.SCATTER_RADIUS),
      scale: 0.4 + Math.random() * 0.4
    };
  }), []);

  // Shared interpolation state for React components
  const [t, setT] = useState(0);
  useFrame((state, delta) => {
    const target = mode === 'TREE' ? 1 : 0;
    const newT = THREE.MathUtils.damp(t, target, CONFIG.ANIMATION_SPEED, delta);
    setT(newT);
  });

  return (
    <>
      {/* Gold Instances */}
      <Instances range={CONFIG.GOLD_ORNAMENT_COUNT}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial 
          color={CONFIG.COLORS.GOLD} 
          metalness={1} 
          roughness={0.15} 
          envMapIntensity={1.5}
        />
        {goldData.map((data, i) => (
           <GoldOrnament key={i} data={data} mode={mode} t={t} />
        ))}
      </Instances>

      {/* Red Instances (Less interactive, just visual) */}
      <Instances range={CONFIG.RED_ORNAMENT_COUNT}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial 
          color={CONFIG.COLORS.RED_VELVET} 
          roughness={0.4} 
          metalness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
        {redData.map((data, i) => (
           <GoldOrnament key={`red-${i}`} data={data} mode={mode} t={t} />
        ))}
      </Instances>
    </>
  );
};

// 3. Fairy Lights
const FairyLights = ({ mode }: { mode: 'SCATTERED' | 'TREE' }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { positions, offsets } = useMemo(() => {
    const pos = [];
    const off = [];
    for (let i = 0; i < CONFIG.LIGHT_COUNT; i++) {
        const { pos: treePos } = getPointOnCone(CONFIG.TREE_HEIGHT, CONFIG.TREE_RADIUS * 1.05); // Outside
        const scatterPos = getRandomPointInSphere(CONFIG.SCATTER_RADIUS * 0.8);
        pos.push({ tree: treePos, scatter: scatterPos });
        off.push(Math.random() * 100);
    }
    return { positions: pos, offsets: off };
  }, []);

  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const targetT = mode === 'TREE' ? 1 : 0;
    meshRef.current.userData.t = THREE.MathUtils.damp(meshRef.current.userData.t || 0, targetT, CONFIG.ANIMATION_SPEED, delta);
    const t = meshRef.current.userData.t;

    for (let i = 0; i < CONFIG.LIGHT_COUNT; i++) {
      const { tree, scatter } = positions[i];
      
      // Position
      tempObj.position.lerpVectors(scatter, tree, t);
      // Floating
      if (t < 0.9) {
          tempObj.position.y += Math.sin(state.clock.elapsedTime * 2 + offsets[i]) * 0.05;
      }
      
      tempObj.scale.setScalar(0.15);
      tempObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tempObj.matrix);

      // Blinking Color
      const blink = Math.sin(state.clock.elapsedTime * 3 + offsets[i]);
      const intensity = blink > 0 ? 1 + blink : 0.2;
      tempColor.set(CONFIG.COLORS.WARM_LIGHT).multiplyScalar(intensity);
      meshRef.current.setColorAt(i, tempColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, CONFIG.LIGHT_COUNT]}>
      <sphereGeometry args={[0.5, 8, 8]} />
      <meshStandardMaterial toneMapped={false} /> {/* toneMapped false for better Bloom */}
    </instancedMesh>
  );
};

// --- Main Scene ---
const Scene = ({ mode }: { mode: 'SCATTERED' | 'TREE' }) => {
  return (
    <>
      <PerspectiveCameraWrapper />
      <OrbitControls 
        autoRotate={mode === 'TREE'} 
        autoRotateSpeed={0.5} 
        enablePan={false} 
        maxPolarAngle={Math.PI / 1.4}
        minDistance={8}
        maxDistance={40}
      />
      
      {/* Lights */}
      <ambientLight intensity={0.2} />
      <spotLight position={[10, 20, 10]} angle={0.3} penumbra={1} intensity={1500} color="#ffeedd" castShadow />
      <pointLight position={[-10, 5, -10]} intensity={500} color="#d4af37" />
      <Environment preset="city" />

      {/* Group centering */}
      <group position={[0, -2, 0]}>
        <Needles mode={mode} />
        <Ornaments mode={mode} />
        <FairyLights mode={mode} />
        
        {/* Star Top */}
        <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
            <mesh position={[0, CONFIG.TREE_HEIGHT/2 + 0.5, 0]} scale={mode === 'TREE' ? 1 : 0} visible={mode === 'TREE'}>
              <octahedronGeometry args={[0.8, 0]} />
              <meshStandardMaterial color={CONFIG.COLORS.GOLD} emissive={CONFIG.COLORS.GOLD} emissiveIntensity={2} toneMapped={false} />
            </mesh>
        </Float>
      </group>

      {/* Atmosphere */}
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Sparkles count={200} scale={12} size={2} speed={0.4} opacity={0.5} color={CONFIG.COLORS.GOLD} />

      {/* Effects */}
      <EffectComposer disableNormalPass>
        <Bloom luminanceThreshold={1} mipmapBlur intensity={1.5} radius={0.6} />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
      </EffectComposer>
    </>
  );
};

// --- Camera Logic ---
const PerspectiveCameraWrapper = () => {
  // Just a standard camera setup, but we could animate it if needed
  return null;
}

// --- Main App Component ---
function App() {
  const [mode, setMode] = useState<'SCATTERED' | 'TREE'>('SCATTERED');

  // Initial animation
  useEffect(() => {
      const t = setTimeout(() => setMode('TREE'), 1000);
      return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#020503' }}>
      <Canvas shadows camera={{ position: [0, 0, 25], fov: 45 }} dpr={[1, 2]}>
        <Suspense fallback={null}>
            <Scene mode={mode} />
        </Suspense>
      </Canvas>

      {/* UI Overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '40px',
        boxSizing: 'border-box'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ 
            fontFamily: '"Times New Roman", serif', 
            color: CONFIG.COLORS.GOLD, 
            fontSize: '2rem', 
            margin: 0, 
            textTransform: 'uppercase', 
            letterSpacing: '0.3em',
            textShadow: '0 0 20px rgba(255, 215, 0, 0.5)'
          }}>
            Arix Signature
          </h1>
          <h2 style={{
             fontFamily: 'sans-serif',
             color: 'white',
             fontSize: '0.9rem',
             fontWeight: 300,
             letterSpacing: '0.2em',
             opacity: 0.8,
             marginTop: '10px'
          }}>
             Interactive Collection
          </h2>
        </div>

        <div style={{ pointerEvents: 'auto', alignSelf: 'center', marginBottom: '20px' }}>
          <button 
            onClick={() => setMode(m => m === 'TREE' ? 'SCATTERED' : 'TREE')}
            style={{
              background: 'transparent',
              border: `1px solid ${CONFIG.COLORS.GOLD}`,
              color: CONFIG.COLORS.GOLD,
              padding: '15px 40px',
              fontFamily: 'sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.2em',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(5px)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = CONFIG.COLORS.GOLD;
              e.currentTarget.style.color = '#000';
              e.currentTarget.style.boxShadow = `0 0 30px ${CONFIG.COLORS.GOLD}`;
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = CONFIG.COLORS.GOLD;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            {mode === 'TREE' ? 'Deconstruct' : 'Assemble'}
          </button>
        </div>
      </div>
      
      {/* Quick Audio Hint */}
      <div style={{ position: 'absolute', bottom: 20, right: 40, color: 'rgba(255,255,255,0.3)', fontFamily: 'sans-serif', fontSize: '0.7rem' }}>
          Enable sound & click ornaments
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}