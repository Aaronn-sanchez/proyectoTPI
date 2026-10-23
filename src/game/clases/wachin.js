import Phaser from "phaser";

export default class wachin extends Phaser.Physics.Matter.Sprite {
    constructor(scene, x, y, textura, iniciarEntidad) {
        // En Matter se pasa el mundo físico como primer parámetro
        super(scene.matter.world, x, y, textura);

        // Agregarlo a la lista visual de la escena
        scene.add.existing(this);

        // Evita que el personaje gire y ruede como pelota al chocar
        this.setFixedRotation();

        this.peso = false;
        this.velocidad = 5;

        if (typeof iniciarEntidad === 'function') {
            iniciarEntidad(this);
        }
    }
}