import Phaser from "phaser";

/**
 * AGUA
 * ----
 * Maneja TODO lo relacionado al agua de un nivel:
 *   1. Saber cuánto de un cuerpo está sumergido (0 a 1).
 *   2. Aplicar flotabilidad (Arquímedes) y arrastre (resistencia del fluido).
 *   3. Simular y dibujar la superficie como una ola real (resortes acoplados).
 *   4. Disparar salpicaduras al entrar/salir.
 *
 *
 * DECISIÓN DE DISEÑO: el agua NO usa cuerpos físicos de Arcade. Arcade solo
 * sabe de colisiones rígidas (rebotar/frenar). El agua no frena en seco: aplica
 * FUERZAS continuas. Por eso guardamos las celdas en una grilla y medimos
 * nosotros cuánto se mete cada cuerpo.
 */
export default class Agua {
    constructor(escena, opciones) {
        const {
            intGrid,          // array plano de LDtk (intGridCsv)
            columnas,         // __cWid
            filas,            // __cHei
            tamCelda,         // __gridSize (16)
            valorAgua = 2,    // valor del IntGrid que representa agua
            profundidad = 5   // depth visual del agua (delante del carpincho)
        } = opciones;

        this.escena = escena;
        this.tam = tamCelda;
        this.columnas = columnas;
        this.filas = filas;

        // ---------- Parámetros de FLUIDO (ajustables) ----------
        // Arrastre = resistencia del agua. Se usa una parte lineal (viscosidad,
        // domina a baja velocidad) y una cuadrática (domina a alta velocidad:
        // por eso un zambullido fuerte se frena mucho más rápido que un nado lento).
        this.arrastreLineal = 2.2;        // 1/s
        this.arrastreCuadratico = 0.004;  // 1/px
        // El agua frena más en vertical (el lomo/panza presentan más superficie
        // y además evita que el cuerpo rebote eternamente al flotar).
        this.factorArrastreVertical = 1.8;

        // ---------- Parámetros de OLAS (ajustables) ----------
        this.paso = 4;               // px entre muestras de la superficie
        this.tension = 0.025;        // qué tan fuerte vuelve cada punto a su reposo
        this.amortiguacion = 0.025;  // cuánto se apagan las ondas
        this.propagacion = 0.25;     // cuánto se contagia el movimiento a vecinos
        this.pasadasPropagacion = 8; // repeticiones del contagio por tick
        this.limiteAmplitud = 12;    // px máximos de desplazamiento (seguridad)

        // ---------- Apariencia ----------
        this.colorAgua = 0x3fa9e0;
        this.alphaAgua = 0.3;

        // Grilla de agua: 1 = hay agua en esa celda
        this.esAgua = new Uint8Array(columnas * filas);
        for (let i = 0; i < intGrid.length; i++) {
            if (intGrid[i] === valorAgua) this.esAgua[i] = 1;
        }

        this._construirGeometria();

        this.grafico = escena.add.graphics().setDepth(profundidad);
        this._crearSalpicadura(profundidad + 5);

        // Acumulador para simular las olas a paso fijo (60 Hz)
        this.acumulador = 0;
    }

    // =====================================================
    // GEOMETRÍA: suavizado de superficie Y fondo
    // =====================================================
    _construirGeometria() {
        const tam = this.tam;
        this.corridas = [];
        let primera = -1;
        let ultima = -1;

        for (let c = 0; c < this.columnas; c++) {
            const lista = [];
            let inicio = -1;
            for (let f = 0; f <= this.filas; f++) {
                const agua = f < this.filas && this.celdaEsAgua(c, f);
                if (agua && inicio < 0) {
                    inicio = f;
                } else if (!agua && inicio >= 0) {
                    lista.push({ arriba: inicio * tam, abajo: f * tam });
                    inicio = -1;
                }
            }
            this.corridas.push(lista);
            if (lista.length > 0) {
                if (primera < 0) primera = c;
                ultima = c;
            }
        }

        this.hayAgua = primera >= 0;
        if (!this.hayAgua) return;

        this.xMin = primera * tam;
        this.xMax = (ultima + 1) * tam;
        this.n = Math.round((this.xMax - this.xMin) / this.paso);

        this.altura = new Float32Array(this.n);
        this.velocidad = new Float32Array(this.n);
        this.activo = new Uint8Array(this.n);
        this.base = new Float32Array(this.n);
        this.fondo = new Float32Array(this.n); // 👈 Y del fondo en cada tira
        this.colTira = new Int32Array(this.n);

        for (let i = 0; i < this.n; i++) {
            const xCentro = this.xMin + i * this.paso + this.paso / 2;
            const c = Math.floor(xCentro / tam);
            this.colTira[i] = c;
            if (this.corridas[c] && this.corridas[c].length > 0) {
                this.activo[i] = 1;
                this.base[i] = this.corridas[c][0].arriba;
                this.fondo[i] = this.corridas[c][0].abajo;
            }
        }

        this.dIzq = new Float32Array(this.n);
        this.dDer = new Float32Array(this.n);
        this.alturaVertice = new Float32Array(this.n + 1);
        this.fondoVertice = new Float32Array(this.n + 1); // 👈 Suavizado del lecho
        this.cimaIzq = new Float32Array(this.n);
        this.cimaDer = new Float32Array(this.n);
    }

    celdaEsAgua(c, f) {
        if (c < 0 || f < 0 || c >= this.columnas || f >= this.filas) return false;
        return this.esAgua[f * this.columnas + c] === 1;
    }

    // =====================================================
    // SALPICADURA (partículas)
    // =====================================================
    _crearSalpicadura(profundidad) {
        // Usa la textura 'gota' creada en el preload de la escena.
        this.salpicadura = this.escena.add.particles(0, 0, 'gota', {
            speed: { min: 140, max: 280 },       // Mayor impulso
            angle: { min: 210, max: 330 },       // Abanico abierto (hacia los lados y arriba)
            gravityY: 650,                      // Caen con peso realista
            lifespan: { min: 400, max: 700 },    // Viven más tiempo en el aire
            scale: { start: 1.2, end: 0.1 },     // Gotas de distintos tamaños
            alpha: { start: 0.9, end: 0 },
            tint: [0xffffff, 0x48cae4, 0x90e0ef], // Variación entre blanco y celestes
            emitting: false
        }).setDepth(profundidad);
    }

    salpicar(x, y, intensidad) {
        // intensidad = velocidad vertical del impacto en px/s.
        // Más rápido = más gotas (entre 4 y 28).
        const cantidad = Math.round(Phaser.Math.Clamp(intensidad / 12, 4, 28));
        this.salpicadura.emitParticleAt(x, y, cantidad);
    }

    // =====================================================
    // CONSULTAS
    // =====================================================

    /** Y actual de la superficie en la coordenada X (incluye la ola), o null. */
    alturaSuperficie(x) {
        if (!this.hayAgua) return null;
        const i = Math.floor((x - this.xMin) / this.paso);
        if (i < 0 || i >= this.n || !this.activo[i]) return null;
        return this.base[i] + this.altura[i];
    }

    /**
     * Fracción (0 a 1) del AREA del hitbox que está dentro de celdas de agua.
     * Es el "volumen sumergido" del principio de Arquímedes, en 2D.
     * Es continua: al entrar al agua sube suavemente de 0 a 1, sin saltos.
     */
    medirSumersion(body) {
        if (!this.hayAgua) return 0;

        const tam = this.tam;
        const izq = body.x;
        const der = body.x + body.width;
        const arr = body.y;
        const aba = body.y + body.height;

        const c0 = Math.floor(izq / tam);
        const c1 = Math.ceil(der / tam) - 1;
        const f0 = Math.floor(arr / tam);
        const f1 = Math.ceil(aba / tam) - 1;

        let area = 0;
        for (let f = f0; f <= f1; f++) {
            const y0 = Math.max(arr, f * tam);
            const y1 = Math.min(aba, (f + 1) * tam);
            if (y1 <= y0) continue;
            for (let c = c0; c <= c1; c++) {
                if (!this.celdaEsAgua(c, f)) continue;
                const x0 = Math.max(izq, c * tam);
                const x1 = Math.min(der, (c + 1) * tam);
                if (x1 > x0) area += (x1 - x0) * (y1 - y0);
            }
        }
        return Math.min(1, area / (body.width * body.height));
    }

    // =====================================================
    // FÍSICA SOBRE UN SPRITE (se llama una vez por frame)
    // =====================================================

    /**
     * Aplica flotabilidad y arrastre a cualquier sprite con cuerpo Arcade.
     * Deja el resultado en sprite.sumersion (0 a 1) para que el sprite lo use.
     *
     * Propiedades opcionales del sprite:
     *   flotabilidad (default 0.6): densidad_agua / densidad_cuerpo.
     *       > 1 flota, = 1 queda suspendido, < 1 se hunde.
     *   arrastreLineal / arrastreCuadratico: para pisar los valores del agua.
     */
    afectarCuerpo(sprite, tiempo, delta) {
        const body = sprite.body;
        // Limitamos dt: si la pestaña se congela, un delta gigante rompería la física.
        const dt = Math.min(delta / 1000, 1 / 30);

        const s = this.medirSumersion(body);
        const previa = sprite.sumersion ?? 0;
        sprite.sumersion = s;

        const cx = body.center.x;
        const vyImpacto = body.velocity.y;

        // ---- Eventos de ENTRADA / SALIDA (cruce del umbral 0.02) ----
        if (previa < 0.02 && s >= 0.02 && vyImpacto > 40) {
            const ySup = this.alturaSuperficie(cx) ?? body.bottom;
            this.salpicar(cx, ySup, vyImpacto);
            this.perturbar(cx, Math.min(vyImpacto * 0.004, 3));
        } else if (previa >= 0.02 && s < 0.02 && vyImpacto < -80) {
            const ySup = this.alturaSuperficie(cx) ?? body.bottom;
            this.salpicar(cx, ySup, Math.abs(vyImpacto) * 0.5);
            this.perturbar(cx, Math.max(vyImpacto * 0.002, -2));
        }

        if (s <= 0) return;

        // ---- 1. FLOTABILIDAD (Arquímedes) ----
        // Empuje hacia arriba = g * k * s. La gravedad del mundo ya empujó hacia
        // abajo con g durante el paso de física, así que la aceleración neta es
        // g * (1 - k*s):
        //   k*s < 1 -> se hunde | k*s = 1 -> equilibrio | k*s > 1 -> sube.
        // Con k = 1.12 el equilibrio está en s = 1/1.12 = ~89% sumergido: flota
        // con el lomo y la cabeza afuera, solo.
        if (body.allowGravity) {
            const g = this.escena.physics.world.gravity.y + body.gravity.y;
            const k = sprite.flotabilidad ?? 0.6;
            body.velocity.y -= g * k * s * dt;
        }

        // ---- 2. ARRASTRE ----
        // dv/dt = -(cLin + cCuad*|v|) * s * v. Se resuelve de forma IMPLÍCITA
        // (v / (1 + c*dt)): nunca invierte ni amplifica la velocidad, por alto que
        // sea dt, a diferencia de v -= c*v*dt que explota con pasos grandes.
        const cLin = sprite.arrastreLineal ?? this.arrastreLineal;
        const cCuad = sprite.arrastreCuadratico ?? this.arrastreCuadratico;
        const rapidez = Math.hypot(body.velocity.x, body.velocity.y);
        const c = (cLin + cCuad * rapidez) * s;
        body.velocity.x /= 1 + c * dt;
        body.velocity.y /= 1 + c * this.factorArrastreVertical * dt;

        // ---- 3. Ondas mientras el cuerpo atraviesa la superficie ----
        // Si está a medias (0.02 < s < 0.98): moverse en vertical empuja el agua y
        // el palmeo horizontal genera ondas pequeñas que oscilan.
        if (s > 0.02 && s < 0.98) {
            const vertical = body.velocity.y * 0.0008;
            const palmeo = Math.sin(tiempo * 0.015) * Math.abs(body.velocity.x) * 0.0006;
            this.perturbar(cx, vertical + palmeo);
        }
    }

    // =====================================================
    // OLAS
    // =====================================================

    /** Da un empujón a la superficie en X (fuerza + = hunde, - = levanta). */
    perturbar(x, fuerza) {
        if (!this.hayAgua) return;
        const centro = Math.round((x - this.xMin) / this.paso);
        // Reparte la fuerza en 5 tiras con caída lineal: se ve como una ola
        // suave y no como un pinchazo de un solo punto.
        for (let d = -2; d <= 2; d++) {
            const i = centro + d;
            if (i < 0 || i >= this.n || !this.activo[i]) continue;
            this.velocidad[i] += fuerza * (1 - Math.abs(d) / 3);
        }
    }

    /** Un tick de simulación: resortes + contagio entre vecinos. */
    _pasoOnda() {
        const { n, altura: h, velocidad: v, activo, dIzq, dDer } = this;

        // (a) Cada punto es un resorte amortiguado hacia su altura de reposo (h=0).
        for (let i = 0; i < n; i++) {
            if (!activo[i]) continue;
            v[i] += -this.tension * h[i] - this.amortiguacion * v[i];
            h[i] += v[i];
        }

        // (b) Contagio: cada punto arrastra a sus vecinos hacia su altura.
        // Esto es lo que hace que la onda VIAJE por la laguna.
        for (let p = 0; p < this.pasadasPropagacion; p++) {
            for (let i = 0; i < n; i++) {
                if (!activo[i]) continue;
                if (i > 0 && activo[i - 1]) {
                    dIzq[i] = this.propagacion * (h[i] - h[i - 1]);
                    v[i - 1] += dIzq[i];
                } else dIzq[i] = 0;
                if (i < n - 1 && activo[i + 1]) {
                    dDer[i] = this.propagacion * (h[i] - h[i + 1]);
                    v[i + 1] += dDer[i];
                } else dDer[i] = 0;
            }
            for (let i = 0; i < n; i++) {
                if (!activo[i]) continue;
                if (i > 0 && activo[i - 1]) h[i - 1] += dIzq[i];
                if (i < n - 1 && activo[i + 1]) h[i + 1] += dDer[i];
            }
        }

        for (let i = 0; i < n; i++) {
            h[i] = Phaser.Math.Clamp(h[i], -this.limiteAmplitud, this.limiteAmplitud);
        }
    }

    /** Ondulación suave permanente (solo visual, no entra en la simulación). */
    _ambiente(x, tiempo) {
        return Math.sin(tiempo * 0.002 + x * 0.05) * 0.8 +
            Math.sin(tiempo * 0.0013 - x * 0.021) * 0.6;
    }

    // =====================================================
    // ACTUALIZACIÓN + DIBUJO (una vez por frame)
    // =====================================================
    actualizar(tiempo, delta) {
        if (!this.hayAgua) return;

        // Paso fijo de 1/60 s: la ola se comporta igual a 30, 60 o 144 FPS.
        this.acumulador += Math.min(delta / 1000, 0.1);
        let pasos = 0;
        while (this.acumulador >= 1 / 60 && pasos < 5) {
            this._pasoOnda();
            this.acumulador -= 1 / 60;
            pasos++;
        }

        this._dibujar(tiempo);
    }

    _dibujar(tiempo) {
        const g = this.grafico;
        const { n, paso, xMin, activo, altura, colTira, corridas, base, fondo, alturaVertice: vh, fondoVertice: fvh } = this;
        g.clear();

        // 1. Suavizar tanto la cima como el fondo promediando vértices adyacentes
        for (let j = 0; j <= n; j++) {
            // Superficie
            const a = j > 0 && activo[j - 1] ? altura[j - 1] : null;
            const b = j < n && activo[j] ? altura[j] : null;
            vh[j] = a !== null && b !== null ? (a + b) / 2 : (a ?? b ?? 0);

            // Fondo de la laguna (elimina los escalones cuadrados)
            const fa = j > 0 && activo[j - 1] ? fondo[j - 1] : null;
            const fb = j < n && activo[j] ? fondo[j] : null;
            fvh[j] = fa !== null && fb !== null ? (fa + fb) / 2 : (fa ?? fb ?? 0);
        }

        // 2. Relleno líquido que une los vértices suaves
        g.fillStyle(this.colorAgua, this.alphaAgua);
        // 2. Relleno líquido que une los vértices suaves
        for (let i = 0; i < n; i++) {
            if (!activo[i]) continue;
            const x0 = xMin + i * paso;
            const x1 = x0 + paso;

            const tI = base[i] + vh[i] + this._ambiente(x0, tiempo);
            const tD = base[i] + vh[i + 1] + this._ambiente(x1, tiempo);
            const bI = fvh[i];     // Fondo suave izquierda
            const bD = fvh[i + 1]; // Fondo suave derecha

            this.cimaIzq[i] = tI;
            this.cimaDer[i] = tD;

            // 👉 RETOQUE SUTIL: si es la orilla extrema, desvanece el alfa para que no corte en seco
            const esBorde = (i === 0 || !activo[i - 1] || i === n - 1 || !activo[i + 1]);
            g.fillStyle(this.colorAgua, esBorde ? this.alphaAgua * 0.4 : this.alphaAgua);

            g.beginPath();
            g.moveTo(x0, tI);
            g.lineTo(x1, tD);
            g.lineTo(x1, bD);
            g.lineTo(x0, bI);
            g.closePath();
            g.fillPath();

            // Corridas de agua profunda adicionales (si existieran)
            const lista = corridas[colTira[i]];
            for (let r = 1; r < lista.length; r++) {
                g.fillRect(x0, lista[r].arriba, paso, lista[r].abajo - lista[r].arriba);
            }
        }

        // 3. Línea de brillo en la superficie
        g.lineStyle(2, 0xffffff, 0.75);
        let trazando = false;
        for (let i = 0; i < n; i++) {
            if (activo[i]) {
                const x0 = xMin + i * paso;
                if (!trazando) {
                    g.beginPath();
                    g.moveTo(x0, this.cimaIzq[i]);
                    trazando = true;
                } else {
                    g.lineTo(x0, this.cimaIzq[i]);
                }
                g.lineTo(x0 + paso, this.cimaDer[i]);
            }
            if (trazando && (!activo[i] || i === n - 1)) {
                g.strokePath();
                trazando = false;
            }
        }
    }
}