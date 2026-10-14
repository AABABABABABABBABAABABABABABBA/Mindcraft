@echo off
rem Starts the Bukkit game server and the EaglercraftBungee websocket proxy in two windows.
rem Players connect to ws://<this machine>:25565 from the Multiplayer screen.
cd /d "%~dp0bukkit_command"
start "Eaglercraft - Bukkit" java -Xmx1G -Xms512M -XX:+UseG1GC -DIReallyKnowWhatIAmDoingISwear=true -jar craftbukkit-1.5.2-R1.0.jar
cd /d "%~dp0bungee_command"
start "Eaglercraft - Bungee" java -Xmx128M -Xms32M -jar bungee-dist.jar
echo Eaglercraft server starting, players can join at ws://localhost:25565
pause
