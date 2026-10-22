export function iniciarCarpincho(personaje) {
    personaje.peso = true;
    personaje.velocidadTierra = 160;

    // ---------- Parámetros de AGUA ----------
    // Relación densidad_agua / densidad_carpincho. > 1 = flota (los carpinchos
    // reales flotan). Con 1.12 queda ~89% sumergido en reposo.
    personaje.flotabilidad = 1.12;
    // Aceleraciones (px/s²) de las patas. La velocidad máxima NO está escrita en
    // ningún lado: sale de equilibrar esta aceleración con el arrastre del agua.
    personaje.aceleracionNado = 370;     // horizontal -> ~135 px/s
    personaje.aceleracionBuceo = 520;    // hacia abajo, vence a la flotabilidad
    personaje.aceleracionEmerger = 460;  // hacia arriba
    personaje.impulsoTrepar = 240;       // px/s al trepar la orilla
    personaje.umbralNado = 0.5;          // desde qué % sumergido pasa de caminar a nadar
    personaje.sumersion = 0;             // 0 a 1, lo escribe Agua cada frame

    // Tamaño visual en pantalla
    personaje.setDisplaySize(48, 48);
    // Hitbox calculada sobre las dimensiones reales del PNG (centrada sobre las patas)
    personaje.body.setSize(personaje.width * 0.65, personaje.height * 0.65);
    personaje.body.setOffset(personaje.width * 0.12, personaje.height * 0.30);

    personaje.mover = function (teclas, teclasWASD, delta) {
        const dt = Math.min(delta / 1000, 1 / 30);

        const izq = teclas.left.isDown || teclasWASD.A.isDown;
        const der = teclas.right.isDown || teclasWASD.D.isDown;
        const arriba = teclas.up.isDown || teclasWASD.W.isDown || teclasWASD.SPACE.isDown;
        const abajo = teclas.down.isDown || teclasWASD.S.isDown;

        const s = this.sumersion;

        if (s >= this.umbralNado) {
            // ==========================================
            // NADANDO (>= 50% del cuerpo en el agua)
            // ==========================================
            // Las patas aplican ACELERACIÓN, no velocidad directa: así hay inercia
            // y el arrastre (en Agua.afectarCuerpo) decide la velocidad máxima.

            // Horizontal
            const dir = (der ? 1 : 0) - (izq ? 1 : 0);
            if (dir !== 0) {
                this.body.velocity.x += dir * this.aceleracionNado * dt;
                this.setFlipX(dir < 0);
            }

            // Vertical
            if (abajo) {
                // Buceo: patas hacia abajo, más fuerte que el empuje de flotación.
                this.body.velocity.y += this.aceleracionBuceo * dt;
            } else if (arriba) {
                // Emerger: la fuerza de las patas se apaga al asomar el cuerpo
                // (sin agua que empujar no hay propulsión): plena con s >= 0.9,
                // nula con s <= 0.5. Así no puede "volar" sobre el agua.
                const empuje = Math.max(0, Math.min(1, (s - 0.5) / 0.4));
                this.body.velocity.y -= this.aceleracionEmerger * empuje * dt;
            }
            // Sin teclas verticales: no hacemos nada. Flotación y frenado
            // los resuelve Agua por física.

        } else {
            // ==========================================
            // EN TIERRA O VADEANDO (< 50% en el agua)
            // ==========================================
            // Al vadear, el agua frena: hasta -45% de velocidad a casi 50% de sumersión.
            const factor = 1 - 0.45 * s;

            if (izq) {
                this.setVelocityX(-this.velocidadTierra * factor);
                this.setFlipX(true);
            } else if (der) {
                this.setVelocityX(this.velocidadTierra * factor);
                this.setFlipX(false);
            } else {
                this.setVelocityX(0);
            }

            // Salto solo si está apoyado sobre suelo sólido
            const enSuelo = this.body.blocked.down || this.body.touching.down;
            if (arriba && enSuelo) {
                this.setVelocityY(-330);
            }
        }

        // ==========================================
        // TREPAR LA ORILLA
        // ==========================================
        // Si está tocando agua (0 < s < 0.9), apretando contra una pared y
        // pidiendo subir, las patas se agarran del barro y lo impulsan hacia
        // arriba. Cuando sale del agua (s = 0) el impulso se corta y la inercia
        // lo termina de subir al borde.
        const contraPared = this.body.blocked.left || this.body.blocked.right;
        if (arriba && contraPared && s > 0 && s < 0.9) {
            if (this.body.velocity.y > -this.impulsoTrepar) {
                this.setVelocityY(-this.impulsoTrepar);
            }
        }
    };
}