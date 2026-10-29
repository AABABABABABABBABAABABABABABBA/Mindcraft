package net.minecraft.src;

import java.util.HashMap;
import java.util.Map;

/**
 * Heisenberg block (server side). Glows, nearly explosion proof, and right
 * clicking it ("say my name") gives a short speed, haste and night vision boost.
 */
public class BlockHeisenberg extends Block {

	/** ticks between uses per player, so the chat can't be spammed */
	private static final long COOLDOWN_TICKS = 200L;
	private static final int EFFECT_TICKS = 600;

	private final Map<String, Long> lastUse = new HashMap();

	public BlockHeisenberg(int id) {
		super(id, Material.rock);
		this.setCreativeTab(CreativeTabs.tabBlock);
	}

	public boolean onBlockActivated(World world, int x, int y, int z, EntityPlayer player, int side, float hitX, float hitY, float hitZ) {
		if (world.isRemote) {
			return true;
		}
		long now = world.getTotalWorldTime();
		Long last = lastUse.get(player.username);
		if (last != null && now - last.longValue() < COOLDOWN_TICKS && now >= last.longValue()) {
			return true;
		}
		lastUse.put(player.username, Long.valueOf(now));

		player.addPotionEffect(new PotionEffect(Potion.moveSpeed.id, EFFECT_TICKS, 1));
		player.addPotionEffect(new PotionEffect(Potion.digSpeed.id, EFFECT_TICKS, 1));
		player.addPotionEffect(new PotionEffect(Potion.nightVision.id, EFFECT_TICKS, 0));
		world.playSoundEffect((double) x + 0.5D, (double) y + 0.5D, (double) z + 0.5D, "random.levelup", 1.0F, 0.8F);

		if (player instanceof EntityPlayerMP) {
			EntityPlayerMP mp = (EntityPlayerMP) player;
			mp.sendChatToPlayer(EnumChatFormatting.GRAY + "Say my name.");
			mp.sendChatToPlayer(EnumChatFormatting.GREEN + "" + EnumChatFormatting.BOLD + "Heisenberg.");
			mp.sendChatToPlayer(EnumChatFormatting.AQUA + "You're goddamn right.");
		}
		return true;
	}
}
