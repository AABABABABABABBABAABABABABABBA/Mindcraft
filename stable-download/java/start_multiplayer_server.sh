#!/bin/sh
# Starts the Bukkit game server and the EaglercraftBungee websocket proxy together.
# Players connect to ws://<this machine>:25565 from the Multiplayer screen,
# or open the client with ?server=ws://<this machine>:25565 to join directly.
# This terminal becomes the Bukkit console, type "stop" or press Ctrl+C to shut down.
cd "$(dirname "$0")"
DIR="$(pwd)"

# bungee's console busy-loops if its stdin is closed, so give it a pipe that never ends
(cd "$DIR/bungee_command" && tail -f /dev/null | exec java -Xmx128M -Xms32M -jar bungee-dist.jar) &
BUNGEE_PID=$!
trap 'kill $BUNGEE_PID 2>/dev/null; pkill -P $BUNGEE_PID 2>/dev/null' INT TERM EXIT

echo "Eaglercraft server starting, players can join at ws://localhost:25565"

# -DIReallyKnowWhatIAmDoingISwear skips CraftBukkit's 15 second "outdated build" delay
cd "$DIR/bukkit_command"
java -Xmx1G -Xms512M -XX:+UseG1GC -DIReallyKnowWhatIAmDoingISwear=true -jar craftbukkit-1.5.2-R1.0.jar nogui
