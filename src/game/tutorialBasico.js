import { Scene } from "phaser";
import wachin from "./clases/wachin.js";
import Agua from "./clases/agua.js";
import { iniciarCarpincho } from "./entidades/carpincho.js";

export default class escena1 extends Scene {
    constructor() {
        super("tutorialBasico");
    }

    preload() {
        this.load.image('carpincho', '/src/assets/sprites-png/carpincho.png');
        this.load.image('cielo', '/src/assets/sprites-png/background-cielo.png');
        this.load.image('pastito_tiles', '/src/assets/sprites-png/pastitio.png');
        this.load.image('pozito_tiles', '/src/assets/sprites-png/pastito-pozito.png');
        this.load.json('nivel_0', '/src/assets/levels/humedal_level.json');

        const gotaCanvas = this.textures.createCanvas('gota', 6, 6);
        const ctx = gotaCanvas.getContext();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(3, 3, 3, 0, Math.PI * 2);
        ctx.fill();
        gotaCanvas.refresh();
    }

    create() {
        const datosLDtk = this.cache.json.get('nivel_0');
        const nivel = datosLDtk.levels.find(l => l.identifier === 'Level_0') || datosLDtk.levels[0];

        // Límites físicos del mundo en Matter
        this.matter.world.setBounds(0, 0, nivel.pxWid, nivel.pxHei);

        // ========================================================
        // FONDO DEL CIELO
        // ========================================================
        const imagenCielo = this.textures.get('cielo').getSourceImage();
        const anchoImg = imagenCielo.width;
        const altoImg = imagenCielo.height;

        // Textura espejada (original + copia volteada) para que no se vea costura.
        if (!this.textures.exists('cielo_espejo')) {
            const lienzo = this.textures.createCanvas('cielo_espejo', anchoImg * 2, altoImg);
            const ctx = lienzo.getContext();
            ctx.drawImage(imagenCielo, 0, 0);
            ctx.save();
            ctx.translate(anchoImg * 2, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(imagenCielo, 0, 0);
            ctx.restore();
            lienzo.refresh();
        }

        this.escalaCielo = 1;
        this.fondoCielo = this.add.tileSprite(0, 0, this.cameras.main.width, altoImg * this.escalaCielo, 'cielo_espejo')
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-100);

        // Color de fondo = último píxel del cielo, para que no quede franja negra.
        // Va acá (create) y NO en update: se calcula una sola vez, y anchoImg /
        // altoImg solo existen dentro de este método.
        const colorBorde = this.textures.getPixel(Math.floor(anchoImg / 2), altoImg - 1, 'cielo');
        if (colorBorde) {
            this.cameras.main.setBackgroundColor(colorBorde.color);
        }

        // ========================================================
        // CAPAS VISUALES (Pastito y Pozito)
        // ========================================================
        const capaPastito = nivel.layerInstances.find(l => l.__identifier === 'Pastito');
        if (capaPastito) {
            const texturaPasto = this.textures.get('pastito_tiles');
            capaPastito.gridTiles.forEach((tile) => {
                const nombreFrame = `pasto_${tile.src[0]}_${tile.src[1]}`;
                if (!texturaPasto.has(nombreFrame)) {
                    texturaPasto.add(nombreFrame, 0, tile.src[0], tile.src[1], 16, 16);
                }
                this.add.image(tile.px[0], tile.px[1], 'pastito_tiles', nombreFrame).setOrigin(0, 0);
            });
        }

        const capaPozito = nivel.layerInstances.find(l => l.__identifier === 'Pozito');
        if (capaPozito) {
            const texturaPozito = this.textures.get('pozito_tiles');
            capaPozito.gridTiles.forEach((tile) => {
                const nombreFrame = `pozo_${tile.src[0]}_${tile.src[1]}_${tile.f}`;
                if (!texturaPozito.has(nombreFrame)) {
                    texturaPozito.add(nombreFrame, 0, tile.src[0], tile.src[1], 16, 16);
                }
                const tileImg = this.add.image(tile.px[0], tile.px[1], 'pozito_tiles', nombreFrame).setOrigin(0, 0);
                tileImg.setDepth(7);
                if (tile.f === 1) tileImg.setFlipX(true);
            });
        }

        // ========================================================
        // CAPA DE COLISIONES: cuerpos estáticos en Matter + Agua
        // ========================================================
        const capaColisiones = nivel.layerInstances.find(l => l.__identifier === 'Colisiones');
        if (capaColisiones) {
            const gridSize = capaColisiones.__gridSize;
            const anchoCeldas = capaColisiones.__cWid;
            const altoCeldas = capaColisiones.__cHei ?? Math.ceil(capaColisiones.intGridCsv.length / anchoCeldas);

            capaColisiones.intGridCsv.forEach((valor, indice) => {
                if (valor !== 1) return; // 1 = Piso plano
                const posX = (indice % anchoCeldas) * gridSize + gridSize / 2;
                const posY = Math.floor(indice / anchoCeldas) * gridSize + gridSize / 2;

                // Bloque estático en Matter
                this.matter.add.rectangle(posX, posY, gridSize, gridSize, {
                    isStatic: true,
                    friction: 0.1
                });
            });

            // Agua (celdas con valor 2)
            this.agua = new Agua(this, {
                intGrid: capaColisiones.intGridCsv,
                columnas: anchoCeldas,
                filas: altoCeldas,
                tamCelda: gridSize,
                valorAgua: 2,
                profundidad: 5
            });
        }

        // ========================================================
        // CURVAS REALES LIBRES (Vértices Poligonales)
        // ========================================================
        // Podés crear cualquier rampa o lomada continua definiendo sus esquinas:
        const rampaPoligono = [
            { x: 0, y: 50 },
            { x: 100, y: 0 },
            { x: 100, y: 50 }
        ];
        // this.matter.add.fromVertices(xCentro, yCentro, rampaPoligono, { isStatic: true });

        // ========================================================
        // NACIMIENTO DEL CARPINCHO
        // ========================================================
        const capaEntidades = nivel.layerInstances.find(l => l.__identifier === 'Entidades');
        const spawnCarpincho = capaEntidades?.entityInstances.find(e => e.__identifier === 'Spawn_carpincho');
        const inicioX = spawnCarpincho ? spawnCarpincho.px[0] : 160;
        const inicioY = spawnCarpincho ? spawnCarpincho.px[1] : 288;

        this.carpincho = new wachin(this, inicioX, inicioY, 'carpincho', iniciarCarpincho);

        // ========================================================
        // CÁMARA Y CONTROLES
        // ========================================================
        this.cameras.main.setBounds(0, 0, nivel.pxWid, nivel.pxHei);
        this.cameras.main.startFollow(this.carpincho, true, 0.08, 0.08);
        this.teclas = this.input.keyboard.createCursorKeys();
        this.teclasWASD = this.input.keyboard.addKeys('W,A,S,D,SPACE');
    }

    update(tiempo, delta) {
        if (!this.carpincho) return;

        // 1) Olas + flotabilidad y arrastre sobre el carpincho
        if (this.agua) {
            this.agua.actualizar(tiempo, delta);
            this.agua.afectarCuerpo(this.carpincho, tiempo, delta);
        }

        // 2) Controles del carpincho (leen la sumersión que dejó el agua)
        this.carpincho.mover(this.teclas, this.teclasWASD, delta);

        // 3) Parallax del cielo
        if (this.fondoCielo) {
            this.fondoCielo.tilePositionX = this.cameras.main.scrollX * 0.2;
        }
    }
}