import Phaser from "phaser";

export default class wachin extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, X, Y, textura, iniciarEntidad) {

        super(scene, X, Y, textura)

        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.setCollideWorldBounds(true);

        this.peso = false
        this.velocidad = 160


        if (typeof iniciarEntidad === 'function') {
            iniciarEntidad(this);
        }

    }

}