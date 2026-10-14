package net.minecraft.src;

import java.util.List;

import net.lax1dude.eaglercraft.EaglerAdapter;
import net.minecraft.client.Minecraft;

/**
 * Extra in-game HUD elements added by Heisenberg: the simple FPS/ping line,
 * facing direction and the keystrokes + CPS overlay
 */
public class GuiHeisenbergHud extends Gui {

	private static final int CLICK_HISTORY = 64;
	private static final long[] leftClicks = new long[CLICK_HISTORY];
	private static final long[] rightClicks = new long[CLICK_HISTORY];
	private static int leftClickPos = 0;
	private static int rightClickPos = 0;

	/**
	 * Called from the mouse event loop so fast clicks are counted even when the
	 * frame rate is lower than the click rate
	 */
	public static void recordClick(int button) {
		long now = Minecraft.getSystemTime();
		if(button == 0) {
			leftClicks[leftClickPos++ % CLICK_HISTORY] = now;
		}else if(button == 1) {
			rightClicks[rightClickPos++ % CLICK_HISTORY] = now;
		}
	}

	private static int getCPS(long[] clicks) {
		long cutoff = Minecraft.getSystemTime() - 1000L;
		int n = 0;
		for(int i = 0; i < CLICK_HISTORY; ++i) {
			if(clicks[i] > cutoff) {
				++n;
			}
		}
		return n;
	}

	/**
	 * Own round trip time to the server from the tab list, -1 when unknown
	 * (singleplayer, or the server hasn't sent it yet)
	 */
	public static int getOwnPing(Minecraft mc) {
		if(mc.thePlayer == null || mc.isSingleplayerOrLAN()) {
			return -1;
		}
		List list = mc.thePlayer.sendQueue.playerInfoList;
		for(int i = 0, l = list.size(); i < l; ++i) {
			GuiPlayerInfo info = (GuiPlayerInfo) list.get(i);
			if(info.name.equals(mc.thePlayer.username)) {
				return info.responseTime;
			}
		}
		return -1;
	}

	public static String pingColor(int ping) {
		return ping < 150 ? EnumChatFormatting.GREEN.toString() : (ping < 300 ? EnumChatFormatting.YELLOW.toString() : EnumChatFormatting.RED.toString());
	}

	private static final String[] FACING = new String[] { "South (+Z)", "West (-X)", "North (-Z)", "East (+X)" };

	/**
	 * Lines for the compact top-left HUD, drawn at 0.75 scale by GuiIngame
	 */
	public static void drawCompactInfo(Minecraft mc, FontRenderer font) {
		int hudMode = mc.gameSettings.hudMode;
		int y = 2;
		if(hudMode != 0) {
			String line;
			if(hudMode == 2) {
				line = mc.renderGlobal.getDebugInfoShort();
			}else {
				line = Minecraft.debugFPS + " FPS";
			}
			int ping = getOwnPing(mc);
			if(ping >= 0) {
				line += EnumChatFormatting.GRAY + " | " + pingColor(ping) + ping + "ms";
			}
			font.drawStringWithShadow(line, 2, y, 16777215);
			y += 10;
		}

		if(mc.gameSettings.showCoordinates) {
			font.drawStringWithShadow("x: " + MathHelper.floor_double(mc.thePlayer.posX) + ", y: " + MathHelper.floor_double(mc.thePlayer.posY) + ", z: " + MathHelper.floor_double(mc.thePlayer.posZ), 2, y, 16777215);
			y += 10;
			int f = MathHelper.floor_double((double) (mc.thePlayer.rotationYaw * 4.0F / 360.0F) + 0.5D) & 3;
			font.drawStringWithShadow("facing " + FACING[f], 2, y, 0xBBBBBB);
		}
	}

	private void drawKey(FontRenderer font, String label, int x, int y, int w, int h, boolean down) {
		drawRect(x, y, x + w, y + h, down ? 0xAAFFFFFF : 0x66000000);
		font.drawString(label, x + (w - font.getStringWidth(label)) / 2, y + (h - 8) / 2 + 1, down ? 0x000000 : 0xFFFFFF);
	}

	/**
	 * WASD / mouse / space overlay with clicks per second
	 */
	public void drawKeystrokes(Minecraft mc, FontRenderer font, int scaledWidth, int scaledHeight) {
		GameSettings gs = mc.gameSettings;
		int k = 24;
		int gap = 2;
		int total = k * 3 + gap * 2;
		int x = scaledWidth - total - 4;
		int y = scaledHeight / 2 - 40;

		EaglerAdapter.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
		drawKey(font, GameSettings.getKeyDisplayString(gs.keyBindForward.keyCode), x + k + gap, y, k, k, gs.keyBindForward.pressed);
		y += k + gap;
		drawKey(font, GameSettings.getKeyDisplayString(gs.keyBindLeft.keyCode), x, y, k, k, gs.keyBindLeft.pressed);
		drawKey(font, GameSettings.getKeyDisplayString(gs.keyBindBack.keyCode), x + k + gap, y, k, k, gs.keyBindBack.pressed);
		drawKey(font, GameSettings.getKeyDisplayString(gs.keyBindRight.keyCode), x + (k + gap) * 2, y, k, k, gs.keyBindRight.pressed);
		y += k + gap;
		int half = (total - gap) / 2;
		drawKey(font, "LMB " + getCPS(leftClicks), x, y, half, k, gs.keyBindAttack.pressed);
		drawKey(font, "RMB " + getCPS(rightClicks), x + half + gap, y, total - half - gap, k, gs.keyBindUseItem.pressed);
		y += k + gap;
		drawRect(x, y, x + total, y + 10, gs.keyBindJump.pressed ? 0xAAFFFFFF : 0x66000000);
		drawRect(x + total / 2 - 10, y + 5, x + total / 2 + 10, y + 6, gs.keyBindJump.pressed ? 0xFF000000 : 0xFFFFFFFF);
		EaglerAdapter.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
	}

}
