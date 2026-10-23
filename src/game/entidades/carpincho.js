import Phaser from "phaser";

export function iniciarCarpincho(personaje) {
    personaje.peso = true;
    personaje.velocidadTierra = 4.5;
    personaje.fuerzaSalto = -8.5;

    // Parámetros de agua
    personaje.flotabilidad = 1.12;
    personaje.aceleracionNado = 0.25;
    personaje.aceleracionBuceo = 0.35;
    personaje.aceleracionEmerger = 0.30;
    personaje.umbralNado = 0.5;
    personaje.sumersion = 0;

    // Cantidad de superficies sólidas que toca el sensor de los pies en este paso
    personaje.contactosSuelo = 0;

    // Tamaño visual
    personaje.setDisplaySize(48, 48);

    // ==========================================================
    // CUERPO COMPUESTO: hitbox + SENSOR DE SUELO en los pies
    // ==========================================================
    const Matter = Phaser.Physics.Matter.Matter;
    const x = personaje.x;
    const y = personaje.y;
    const ancho = 34;
    const alto = 30;

    // Parte 1: el cuerpo sólido con esquinas redondeadas (igual que antes).
    const cuerpoPrincipal = Matter.Bodies.rectangle(x, y, ancho, alto, {
        chamfer: { radius: 8 },
        friction: 0.08,
        restitution: 0.0
    });

    // Parte 2: sensor fino pegado a la base. No choca con nada (isSensor), solo
    // avisa si toca algo. Es más angosto que el cuerpo (20 vs 34) para que las
    // paredes laterales jamás lo toquen. Sobresale 3 px por debajo de los pies.
    const sensorSuelo = Matter.Bodies.rectangle(x, y + alto / 2 + 1, 20, 4, {
        isSensor: true,
        label: 'sensorSuelo',
        density: 0.0001   // casi sin masa: no desplaza el centro del cuerpo
    });

    const compuesto = Matter.Body.create({
        parts: [cuerpoPrincipal, sensorSuelo],
        // friction: 0.08,
        // frictionAir: 0.02,  
        restitution: 0.0
    });

    personaje.setExistingBody(compuesto);
    personaje.setOrigin(0.5, 0.5);
    personaje.setFixedRotation();
    personaje.setPosition(x, y);

    // ==========================================================
    // DETECCIÓN DE SUELO por eventos de colisión
    // ==========================================================
    const mundo = personaje.scene.matter.world;

    // Antes de cada paso de física: reiniciar el conteo.
    const reiniciarContactos = () => { personaje.contactosSuelo = 0; };

    // Durante el paso: contar cada par donde participa el sensor.
    const contarContactos = (evento) => {
        for (const par of evento.pairs) {
            let otro;
            if (par.bodyA === sensorSuelo) otro = par.bodyB;
            else if (par.bodyB === sensorSuelo) otro = par.bodyA;
            else continue;

            if (otro.isSensor) continue;               // ignorar otros sensores
            if (otro.parent === compuesto) continue;   // ignorar el propio carpincho
            personaje.contactosSuelo++;
        }
    };

    mundo.on('beforeupdate', reiniciarContactos);
    mundo.on('collisionstart', contarContactos);
    mundo.on('collisionactive', contarContactos);

    // Limpieza: si el carpincho se destruye (o se reinicia la escena), soltar los
    // listeners para que no queden escuchando un cuerpo que ya no existe.
    personaje.once('destroy', () => {
        mundo.off('beforeupdate', reiniciarContactos);
        mundo.off('collisionstart', contarContactos);
        mundo.off('collisionactive', contarContactos);
    });

    personaje.mover = function (teclas, teclasWASD, delta) {
        const izq = teclas.left.isDown || teclasWASD.A.isDown;
        const der = teclas.right.isDown || teclasWASD.D.isDown;
        const arriba = teclas.up.isDown || teclasWASD.W.isDown || teclasWASD.SPACE.isDown;
        const abajo = teclas.down.isDown || teclasWASD.S.isDown;

        const s = this.sumersion;

        if (s >= this.umbralNado) {
            // NADANDO EN EL AGUA
            const dir = (der ? 1 : 0) - (izq ? 1 : 0);
            if (dir !== 0) {
                this.setVelocityX(this.body.velocity.x + dir * this.aceleracionNado);
                this.setFlipX(dir < 0);
            }

            if (abajo) {
                this.setVelocityY(this.body.velocity.y + this.aceleracionBuceo);
            } else if (arriba) {
                const empuje = Math.max(0, Math.min(1, (s - 0.5) / 0.4));
                this.setVelocityY(this.body.velocity.y - this.aceleracionEmerger * empuje);
            }
        } else {
            // EN TIERRA O VADEANDO SOBRE CURVAS / RAMPAS
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

            // Salto: solo si el sensor de los pies está tocando algo sólido.
            const enSuelo = this.contactosSuelo > 0;
            if (arriba && enSuelo) {
                this.setVelocityY(this.fuerzaSalto);
            }
        }
    };

    console.log('sprite', personaje.x, personaje.y);
    console.log('body', personaje.body.position.x, personaje.body.position.y);
    console.log('origen', personaje.originX, personaje.originY);
    console.log('tamaño textura', personaje.width, personaje.height);
}