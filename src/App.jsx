import './App.css'

import { useEffect, useRef } from 'react';
import Phaser from 'phaser'
import TutorialBasico from './game/tutorialBasico.js';

export default function App() {

  const contenedorJuego = useRef(null);
  const juegoInstancia = useRef(null);

  useEffect(() => {
    if (juegoInstancia.current) return;

    const config = {
      type: Phaser.AUTO,
      width: 960,
      height: 540,
      parent: contenedorJuego.current,
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { y: 800 },
          debug: false
        }
      },
      scale: {
        mode: Phaser.Scale.ENVELOP,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 540
      },
      scene: [TutorialBasico]
    };

    juegoInstancia.current = new Phaser.Game(config);

    return () => {
      if (juegoInstancia.current) {
        juegoInstancia.current.destroy(true);
        juegoInstancia.current = null;
      }
    };
  }, []);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#1a1a1a',
      margin: 0,
      overflow: 'hidden'
    }}>
      <div ref={contenedorJuego} />
    </div>
  );
}