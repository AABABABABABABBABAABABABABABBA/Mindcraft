package net.minecraft.src;

import net.lax1dude.eaglercraft.EaglerAdapter;
import net.minecraft.client.Minecraft;

/**
 * Settings added by the Heisenberg fork: performance, HUD and gameplay toggles
 */
public class GuiScreenHeisenbergSettings extends GuiScreen {

	private static final String[] HUD_MODES = new String[] { "Off", "FPS + Ping", "Detailed" };
	private static final String[] PRESETS = new String[] { "Potato", "Balanced", "Quality" };

	private final GuiScreen parent;
	private final GameSettings settings;
	private String presetMessage = null;
	private long presetMessageTime = 0L;

	public GuiScreenHeisenbergSettings(GuiScreen parent, GameSettings settings) {
		this.parent = parent;
		this.settings = settings;
	}

	/**
	 * Render scale slider, 25% to 100% in 5% steps
	 */
	private class RenderScaleSlider extends GuiButton {
		private boolean dragging = false;

		private RenderScaleSlider(int id, int x, int y) {
			super(id, x, y, 150, 20, "");
			updateLabel();
		}

		private float sliderValue() {
			return (settings.renderScale - 0.25f) / 0.75f;
		}

		private void setFromMouse(int mouseX) {
			float v = (float) (mouseX - (this.xPosition + 4)) / (float) (this.width - 8);
			v = v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
			settings.renderScale = Math.round((0.25f + v * 0.75f) * 20.0f) / 20.0f;
			EaglerAdapter.setRenderScale(settings.renderScale);
			updateLabel();
		}

		private void updateLabel() {
			this.displayString = "Render Scale: " + Math.round(settings.renderScale * 100.0f) + "%";
		}

		protected int getHoverState(boolean par1) {
			return 0;
		}

		protected void mouseDragged(Minecraft mc, int mouseX, int mouseY) {
			if (this.drawButton) {
				if (this.dragging) {
					setFromMouse(mouseX);
				}
				EaglerAdapter.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
				int knob = this.xPosition + (int) (sliderValue() * (float) (this.width - 8));
				this.drawTexturedModalRect(knob, this.yPosition, 0, 66, 4, 20);
				this.drawTexturedModalRect(knob + 4, this.yPosition, 196, 66, 4, 20);
			}
		}

		public boolean mousePressed(Minecraft mc, int mouseX, int mouseY) {
			if (super.mousePressed(mc, mouseX, mouseY)) {
				setFromMouse(mouseX);
				this.dragging = true;
				return true;
			}
			return false;
		}

		public void mouseReleased(int mouseX, int mouseY) {
			if (this.dragging) {
				this.dragging = false;
				settings.saveOptions();
			}
		}
	}

	private static String onOff(boolean b) {
		return b ? "ON" : "OFF";
	}

	public void initGui() {
		this.buttonList.clear();
		int left = this.width / 2 - 155;
		int right = this.width / 2 + 5;
		int y = this.height / 6 - 12;

		this.buttonList.add(new RenderScaleSlider(1, left, y));
		this.buttonList.add(new GuiButton(2, right, y, 150, 20, ""));
		y += 24;
		this.buttonList.add(new GuiButton(3, left, y, 150, 20, ""));
		this.buttonList.add(new GuiButton(4, right, y, 150, 20, ""));
		y += 24;
		this.buttonList.add(new GuiButton(5, left, y, 150, 20, ""));
		this.buttonList.add(new GuiButton(6, right, y, 150, 20, ""));
		y += 24;
		this.buttonList.add(new GuiButton(7, left, y, 150, 20, ""));
		this.buttonList.add(new GuiButton(8, right, y, 150, 20, ""));
		y += 24;
		this.buttonList.add(new GuiButton(9, left, y, 150, 20, ""));
		this.buttonList.add(new GuiButton(10, right, y, 150, 20, ""));
		y += 24;
		this.buttonList.add(new GuiButton(11, left, y, 100, 20, "Preset: Potato"));
		this.buttonList.add(new GuiButton(12, left + 105, y, 100, 20, "Preset: Balanced"));
		this.buttonList.add(new GuiButton(13, left + 210, y, 100, 20, "Preset: Quality"));

		this.buttonList.add(new GuiButton(200, this.width / 2 - 100, this.height / 6 + 168, StatCollector.translateToLocal("gui.done")));
		updateLabels();
	}

	private void updateLabels() {
		for (int i = 0; i < this.buttonList.size(); ++i) {
			GuiButton b = (GuiButton) this.buttonList.get(i);
			switch (b.id) {
			case 2: b.displayString = "HUD: " + HUD_MODES[settings.hudMode % 3]; break;
			case 3: b.displayString = "Show Coordinates: " + onOff(settings.showCoordinates); break;
			case 4: b.displayString = "Keystrokes + CPS: " + onOff(settings.showKeystrokes); break;
			case 5: b.displayString = "Fullbright: " + onOff(settings.fullbright); break;
			case 6: b.displayString = "Toggle Sprint: " + onOff(settings.toggleSprint); break;
			case 7: b.displayString = "Auto Reconnect: " + onOff(settings.autoReconnect); break;
			case 8: b.displayString = "Ping In Tab List: " + onOff(settings.showPingNumbers); break;
			case 9: b.displayString = "Chunk Updates: " + (settings.chunkUpdatePerFrame + 1); break;
			case 10: b.displayString = "Max Framerate: " + StatCollector.translateToLocal(new String[] { "performance.max", "performance.balanced", "performance.powersaver" }[settings.limitFramerate % 3]); break;
			default: break;
			}
		}
	}

	protected void actionPerformed(GuiButton b) {
		if (!b.enabled) {
			return;
		}
		switch (b.id) {
		case 2: settings.hudMode = (settings.hudMode + 1) % 3; break;
		case 3: settings.showCoordinates = !settings.showCoordinates; break;
		case 4: settings.showKeystrokes = !settings.showKeystrokes; break;
		case 5: settings.fullbright = !settings.fullbright; break;
		case 6:
			settings.toggleSprint = !settings.toggleSprint;
			if (this.mc.thePlayer != null) {
				this.mc.thePlayer.sprintToggled = false;
			}
			break;
		case 7: settings.autoReconnect = !settings.autoReconnect; break;
		case 8: settings.showPingNumbers = !settings.showPingNumbers; break;
		case 9: settings.setOptionValue(EnumOptions.CHUNK_UPDATES, 1); break;
		case 10: settings.setOptionValue(EnumOptions.FRAMERATE_LIMIT, 1); break;
		case 11:
		case 12:
		case 13:
			settings.applyPerformancePreset(b.id - 11);
			presetMessage = "Applied " + PRESETS[b.id - 11] + " preset";
			presetMessageTime = Minecraft.getSystemTime();
			// the slider reads renderScale so rebuild everything to pick up the new values
			this.initGui();
			return;
		case 200:
			settings.saveOptions();
			this.mc.displayGuiScreen(this.parent);
			return;
		default:
			break;
		}
		settings.saveOptions();
		updateLabels();
	}

	public void drawScreen(int mouseX, int mouseY, float partialTicks) {
		this.drawDefaultBackground();
		this.drawCenteredString(this.fontRenderer, "Heisenberg Settings", this.width / 2, 15, 16777215);
		super.drawScreen(mouseX, mouseY, partialTicks);
		int y = this.height / 6 + 133;
		if (presetMessage != null && Minecraft.getSystemTime() - presetMessageTime < 3000L) {
			this.drawCenteredString(this.fontRenderer, presetMessage, this.width / 2, y, 0x55FF55);
		} else {
			this.drawCenteredString(this.fontRenderer, "Lower render scale = more FPS on slow devices", this.width / 2, y, 0x888888);
		}
		this.drawCenteredString(this.fontRenderer, "Hold C to zoom (scroll to adjust)  -  R to sprint", this.width / 2, y + 12, 0x888888);
	}
}
