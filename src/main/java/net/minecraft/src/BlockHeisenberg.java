package net.minecraft.src;

import net.lax1dude.eaglercraft.EaglercraftRandom;

/**
 * Heisenberg block (client side). The effects of right clicking it are applied
 * by the server, the client only renders it and its blue glow particles.
 */
public class BlockHeisenberg extends Block {

	public BlockHeisenberg(int id) {
		super(id, Material.rock);
		this.setCreativeTab(CreativeTabs.tabBlock);
	}

	public boolean onBlockActivated(World world, int x, int y, int z, EntityPlayer player, int side, float hitX, float hitY, float hitZ) {
		// handled on the server, returning true stops the held item being used here
		return true;
	}

	public void randomDisplayTick(World world, int x, int y, int z, EaglercraftRandom rand) {
		for (int i = 0; i < 3; ++i) {
			double px = (double) x + rand.nextDouble();
			double py = (double) y + 1.0D + rand.nextDouble() * 0.4D;
			double pz = (double) z + rand.nextDouble();
			// reddust takes its color from the velocity arguments: light blue
			world.spawnParticle("reddust", px, py, pz, 0.01D, 0.75D, 1.0D);
		}
	}
}
