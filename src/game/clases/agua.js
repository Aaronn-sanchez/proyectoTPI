import Phaser from "phaser";

/**
 * AGUA (Adaptada para Matter.js)
 * --------------------------------
 * Maneja:
 *   1. Detección continua de sumersión sobre cuerpos Matter.js.
 *   2. Fuerzas de flotabilidad (Arquímedes) y arrastre hidrodinámico por applyForce.
 *   3. Simulación y dibujo de la superficie de olas con resortes acoplados.
 *   4. Disparo de salpicaduras de partículas al entrar y salir.
 */
export default class Agua {
    constructor(escena, opciones) {
        const {
            intGrid,
            columnas,
            filas,
            tamCelda,
            valorAgua = 2,
            profundidad = 5
        } = opciones;

        this.escena = escena;
        this.tam = tamCelda;
        this.columnas = columnas;
        this.filas = filas;

        // ---------- Parámetros de FLUIDO ----------
        this.arrastreLineal = 1.8;
        this.factorArrastreVertical = 1.5;

        // ---------- Parámetros de OLAS ----------
        this.paso = 4;
        this.tension = 0.025;
        this.amortiguacion = 0.025;
        this.propagacion = 0.25;
        this.pasadasPropagacion = 8;
        this.limiteAmplitud = 12;

        // ---------- Apariencia ----------
        this.colorAgua = 0x3fa9e0;
        this.alphaAgua = 0.5;

        // Grilla lógica de agua
        this.esAgua = new Uint8Array(columnas * filas);
        for (let i = 0; i < intGrid.length; i++) {
            if (intGrid[i] === valorAgua) this.esAgua[i] = 1;
        }

        this._construirGeometria();

        this.grafico = escena.add.graphics().setDepth(profundidad);
        this._crearSalpicadura(profundidad + 5);

        this.acumulador = 0;
    }

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
        this.fondo = new Float32Array(this.n);
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
        this.fondoVertice = new Float32Array(this.n + 1);
        this.cimaIzq = new Float32Array(this.n);
        this.cimaDer = new Float32Array(this.n);
    }

    celdaEsAgua(c, f) {
        if (c < 0 || f < 0 || c >= this.columnas || f >= this.filas) return false;
        return this.esAgua[f * this.columnas + c] === 1;
    }

    _crearSalpicadura(profundidad) {
        this.salpicadura = this.escena.add.particles(0, 0, 'gota', {
            speed: { min: 140, max: 280 },
            angle: { min: 210, max: 330 },
            gravityY: 650,
            lifespan: { min: 400, max: 700 },
            scale: { start: 1.2, end: 0.1 },
            alpha: { start: 0.9, end: 0 },
            tint: [0xffffff, 0x48cae4, 0x90e0ef],
            emitting: false
        }).setDepth(profundidad);
    }

    salpicar(x, y, intensidad) {
        const cantidad = Math.round(Phaser.Math.Clamp(intensidad / 2, 4, 28));
        this.salpicadura.emitParticleAt(x, y, cantidad);
    }

    alturaSuperficie(x) {
        if (!this.hayAgua) return null;
        const i = Math.floor((x - this.xMin) / this.paso);
        if (i < 0 || i >= this.n || !this.activo[i]) return null;
        return this.base[i] + this.altura[i];
    }

    /**
     * Calcula la sumersión continua (0 a 1) usando los límites bounds de Matter.js
     */
    medirSumersion(body) {
        if (!this.hayAgua) return 0;

        const tam = this.tam;
        const izq = body.bounds.min.x;
        const der = body.bounds.max.x;
        const arr = body.bounds.min.y;
        const aba = body.bounds.max.y;

        const ancho = der - izq;
        const alto = aba - arr;
        if (ancho <= 0 || alto <= 0) return 0;

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
        return Math.min(1, area / (ancho * alto));
    }

    /**
     * Aplica flotabilidad y arrastre a un Sprite de Matter.js
     */
    afectarCuerpo(sprite, tiempo, delta) {
        if (!sprite || !sprite.body) return;

        const body = sprite.body;
        const dt = Math.min(delta / 1000, 1 / 30);

        const s = this.medirSumersion(body);
        const previa = sprite.sumersion ?? 0;
        sprite.sumersion = s;

        const cx = sprite.x;
        const vy = body.velocity.y;

        // Disparo de salpicadura al cruzar la superficie
        if (previa < 0.02 && s >= 0.02 && vy > 1.5) {
            const ySup = this.alturaSuperficie(cx) ?? body.bounds.max.y;
            this.salpicar(cx, ySup, vy);
            this.perturbar(cx, Math.min(vy * 0.4, 3));
        } else if (previa >= 0.02 && s < 0.02 && vy < -2) {
            const ySup = this.alturaSuperficie(cx) ?? body.bounds.max.y;
            this.salpicar(cx, ySup, Math.abs(vy) * 0.4);
            this.perturbar(cx, Math.max(vy * 0.2, -2));
        }

        if (s <= 0) return;

        // 1. FLOTABILIDAD (Principio de Arquímedes con applyForce en Matter)
        // Matter aplica la gravedad a cada cuerpo como: masa * gravedad.y * gravedad.scale.
        // El empuje usa EXACTAMENTE la misma fórmula, multiplicada por k * s, para que
        // al sumergirse a s = 1/k empuje y peso se anulen (equilibrio).

        const motor = this.escena.matter.world.engine;
        const gravedad = motor.gravity ?? motor.world?.gravity;   // según versión de Matter
        const gy = gravedad?.y ?? 1;
        const escalaGravedad = gravedad?.scale ?? 0.001;
        const kFlotabilidad = sprite.flotabilidad ?? 1.15;

        const fuerzaEmpuje = body.mass * gy * escalaGravedad * kFlotabilidad * s;
        sprite.applyForce({ x: 0, y: -fuerzaEmpuje });

        // 2. ARRASTRE FLUIDO (Resistencia al avance)
        const factorFrenadoX = 1 / (1 + this.arrastreLineal * s * dt * 2.5);
        const factorFrenadoY = 1 / (1 + this.arrastreLineal * this.factorArrastreVertical * s * dt * 3.0);

        sprite.setVelocity(
            body.velocity.x * factorFrenadoX,
            body.velocity.y * factorFrenadoY
        );

        // 3. Pequeñas ondas al moverse por la superficie
        if (s > 0.02 && s < 0.98) {
            const vertical = body.velocity.y * 0.08;
            const palmeo = Math.sin(tiempo * 0.015) * Math.abs(body.velocity.x) * 0.04;
            this.perturbar(cx, vertical + palmeo);
        }
    }

    perturbar(x, fuerza) {
        if (!this.hayAgua) return;
        const centro = Math.round((x - this.xMin) / this.paso);
        for (let d = -2; d <= 2; d++) {
            const i = centro + d;
            if (i < 0 || i >= this.n || !this.activo[i]) continue;
            this.velocidad[i] += fuerza * (1 - Math.abs(d) / 3);
        }
    }

    _pasoOnda() {
        const { n, altura: h, velocidad: v, activo, dIzq, dDer } = this;

        for (let i = 0; i < n; i++) {
            if (!activo[i]) continue;
            v[i] += -this.tension * h[i] - this.amortiguacion * v[i];
            h[i] += v[i];
        }

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

    _ambiente(x, tiempo) {
        return Math.sin(tiempo * 0.002 + x * 0.05) * 0.8 +
            Math.sin(tiempo * 0.0013 - x * 0.021) * 0.6;
    }

    actualizar(tiempo, delta) {
        if (!this.hayAgua) return;

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

        for (let j = 0; j <= n; j++) {
            const a = j > 0 && activo[j - 1] ? altura[j - 1] : null;
            const b = j < n && activo[j] ? altura[j] : null;
            vh[j] = a !== null && b !== null ? (a + b) / 2 : (a ?? b ?? 0);

            const fa = j > 0 && activo[j - 1] ? fondo[j - 1] : null;
            const fb = j < n && activo[j] ? fondo[j] : null;
            fvh[j] = fa !== null && fb !== null ? (fa + fb) / 2 : (fa ?? fb ?? 0);
        }

        g.fillStyle(this.colorAgua, this.alphaAgua);
        for (let i = 0; i < n; i++) {
            if (!activo[i]) continue;
            const x0 = xMin + i * paso;
            const x1 = x0 + paso;

            const tI = base[i] + vh[i] + this._ambiente(x0, tiempo);
            const tD = base[i] + vh[i + 1] + this._ambiente(x1, tiempo);
            const bI = fvh[i];
            const bD = fvh[i + 1];

            this.cimaIzq[i] = tI;
            this.cimaDer[i] = tD;

            const esBorde = (i === 0 || !activo[i - 1] || i === n - 1 || !activo[i + 1]);
            g.fillStyle(this.colorAgua, esBorde ? this.alphaAgua * 0.4 : this.alphaAgua);

            g.beginPath();
            g.moveTo(x0, tI);
            g.lineTo(x1, tD);
            g.lineTo(x1, bD);
            g.lineTo(x0, bI);
            g.closePath();
            g.fillPath();

            const lista = corridas[colTira[i]];
            for (let r = 1; r < lista.length; r++) {
                g.fillRect(x0, lista[r].arriba, paso, lista[r].abajo - lista[r].arriba);
            }
        }

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