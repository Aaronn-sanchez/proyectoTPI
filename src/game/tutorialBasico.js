import { Scene } from "phaser";
import wachin from "./clases/wachin.js";
import Agua from "./clases/agua.js";
import { iniciarCarpincho } from "./entidades/carpincho.js";

export default class escena1 extends Scene {
    constructor() {
        super("tutorialBasico");
    }

    // ==========================================
    // 1. CARGA DE RECURSOS (PRELOAD)
    // ==========================================
    preload() {
        // Imágenes del nivel y personajes
        this.load.image('carpincho', '/src/assets/sprites-png/carpincho.png');
        this.load.image('cielo', '/src/assets/sprites-png/background-cielo.png');
        this.load.image('pastito_tiles', '/src/assets/sprites-png/pastitio.png');
        this.load.image('pozito_tiles', '/src/assets/sprites-png/pastito-pozito.png');


        // Datos del mapa de LDtk
        this.load.json('nivel_0', '/src/assets/levels/humedal_level.json');

        // Textura procedural para las gotas de salpicadura (la usa la clase Agua)
        const gotaCanvas = this.textures.createCanvas('gota', 6, 6);
        const ctx = gotaCanvas.getContext();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(3, 3, 3, 0, Math.PI * 2);
        ctx.fill();
        gotaCanvas.refresh();
    }

    // ==========================================
    // 2. CONSTRUCCIÓN DEL MUNDO (CREATE)
    // ==========================================
    create() {
        // --- A. Lectura de datos de LDtk ---
        const datosLDtk = this.cache.json.get('nivel_0');
        const nivel = datosLDtk.levels.find(l => l.identifier === 'Level_0') || datosLDtk.levels[0];

        // --- B. Fondo del cielo ---
        const imagenCielo = this.textures.get('cielo').getSourceImage();
        const anchoImg = imagenCielo.width;
        const altoImg = imagenCielo.height;

        // Textura espejada (original + copia volteada). Se crea una sola vez: las
        // texturas viven en el administrador global y al reiniciar la escena ya existen.
        if (!this.textures.exists('cielo_espejo')) {
            const lienzo = this.textures.createCanvas('cielo_espejo', anchoImg * 2, altoImg);
            const ctx = lienzo.getContext();
            ctx.drawImage(imagenCielo, 0, 0);
            ctx.save();
            ctx.translate(anchoImg * 2, 0); // mueve el origen al borde derecho
            ctx.scale(-1, 1);               // invierte el eje X
            ctx.drawImage(imagenCielo, 0, 0);
            ctx.restore();
            lienzo.refresh();
        }

        // 1 = tamaño original. Subilo (1.2, 1.5...) si lo querés más grande.
        this.escalaCielo = 1;

        // Mismo ancho que la pantalla, pero alto = el de la imagen: no se repite en vertical.
        this.fondoCielo = this.add.tileSprite(
            0, 0,
            this.cameras.main.width, altoImg * this.escalaCielo,
            'cielo_espejo'
        )
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(-100);
        this.fondoCielo.setTileScale(this.escalaCielo, this.escalaCielo);

        // Lo que queda debajo del cielo se pinta con el color del borde inferior.
        const colorBorde = this.textures.getPixel(Math.floor(anchoImg / 2), altoImg - 1, 'cielo');
        if (colorBorde) {
            this.cameras.main.setBackgroundColor(colorBorde.color);
        }

        // --- C. Grupo físico estático (Arcade) ---
        // Solo el suelo es un cuerpo rígido. El agua ya NO usa cuerpos de Arcade:
        // la maneja la clase Agua con fuerzas.
        this.sueloGrupo = this.physics.add.staticGroup();

        // --- D. Capa visual: Pastito plano ---
        const capaPastito = nivel.layerInstances.find(l => l.__identifier === 'Pastito');
        if (capaPastito) {
            const texturaPasto = this.textures.get('pastito_tiles');

            capaPastito.gridTiles.forEach((tile) => {
                const posX = tile.px[0];
                const posY = tile.px[1];
                const recorteX = tile.src[0];
                const recorteY = tile.src[1];

                const nombreFrame = `pasto_${recorteX}_${recorteY}`;
                if (!texturaPasto.has(nombreFrame)) {
                    texturaPasto.add(nombreFrame, 0, recorteX, recorteY, 16, 16);
                }

                this.add.image(posX, posY, 'pastito_tiles', nombreFrame).setOrigin(0, 0);
            });
        }

        // --- E. Capa visual: Orillas curvas del pozo ---
        const capaPozito = nivel.layerInstances.find(l => l.__identifier === 'Pozito');
        if (capaPozito) {
            const texturaPozito = this.textures.get('pozito_tiles');

            capaPozito.gridTiles.forEach((tile) => {
                const posX = tile.px[0];
                const posY = tile.px[1];
                const recorteX = tile.src[0];
                const recorteY = tile.src[1];

                const nombreFrame = `pozo_${recorteX}_${recorteY}_${tile.f}`;
                if (!texturaPozito.has(nombreFrame)) {
                    texturaPozito.add(nombreFrame, 0, recorteX, recorteY, 16, 16);
                }

                const tileImg = this.add.image(posX, posY, 'pozito_tiles', nombreFrame).setOrigin(0, 0);
                tileImg.setDepth(7);
                // Volteo horizontal si se usó la tecla X en LDtk
                if (tile.f === 1) {
                    tileImg.setFlipX(true);
                }
            });
        }

        // --- F. Capa lógica: Suelo sólido y Agua ---
        const capaColisiones = nivel.layerInstances.find(l => l.__identifier === 'Colisiones');
        if (capaColisiones) {
            const gridSize = capaColisiones.__gridSize; // 16 px
            const anchoCeldas = capaColisiones.__cWid;
            const altoCeldas = capaColisiones.__cHei ?? Math.ceil(capaColisiones.intGridCsv.length / anchoCeldas);

            // Suelo firme: un bloque estático invisible por celda con valor 1
            capaColisiones.intGridCsv.forEach((valor, indice) => {
                if (valor !== 1) return;

                const posX = (indice % anchoCeldas) * gridSize + gridSize / 2;
                const posY = Math.floor(indice / anchoCeldas) * gridSize + gridSize / 2;

                const bloque = this.sueloGrupo.create(posX, posY, null);
                bloque.setSize(gridSize, gridSize).setVisible(false);
                bloque.refreshBody();
            });

            // Agua: celdas con valor 2. La clase Agua se encarga de TODO
            // (dibujo, olas, flotabilidad, arrastre, salpicaduras).
            this.agua = new Agua(this, {
                intGrid: capaColisiones.intGridCsv,
                columnas: anchoCeldas,
                filas: altoCeldas,
                tamCelda: gridSize,
                valorAgua: 2,
                profundidad: 5
            });
        }

        // --- G. Entidades: Nacimiento del Carpincho ---
        const capaEntidades = nivel.layerInstances.find(l => l.__identifier === 'Entidades');
        const spawnCarpincho = capaEntidades?.entityInstances.find(e => e.__identifier === 'Spawn_carpincho');
        const inicioX = spawnCarpincho ? spawnCarpincho.px[0] : 160;
        const inicioY = spawnCarpincho ? spawnCarpincho.px[1] : 288;

        this.carpincho = new wachin(this, inicioX, inicioY, 'carpincho', iniciarCarpincho);
        this.physics.add.collider(this.carpincho, this.sueloGrupo);

        // ==========================================
        // 3. CÁMARA, LÍMITES Y CONTROLES
        // ==========================================
        this.physics.world.setBounds(0, 0, nivel.pxWid, nivel.pxHei);
        this.cameras.main.setBounds(0, 0, nivel.pxWid, nivel.pxHei);
        this.cameras.main.startFollow(this.carpincho, true, 0.08, 0.08);

        this.teclas = this.input.keyboard.createCursorKeys();
        this.teclasWASD = this.input.keyboard.addKeys('W,A,S,D,SPACE');
    }

    // ==========================================
    // 4. BUCLE EN TIEMPO REAL (UPDATE)
    // ==========================================
    update(tiempo, delta) {
        if (!this.carpincho) return;

        // 1. Simulación y físicas de agua
        if (this.agua) {
            this.agua.actualizar(tiempo, delta);
            this.agua.afectarCuerpo(this.carpincho, tiempo, delta);
        }

        // 2. Control de movimiento del Carpincho
        this.carpincho.mover(this.teclas, this.teclasWASD, delta);

        // 3. Efecto Parallax en el cielo (se desplaza sutilmente al caminar)
        if (this.fondoCielo) {
            this.fondoCielo.tilePositionX = this.cameras.main.scrollX * 0.2;
        }
    }
}