#!/usr/bin/env bash
# Builds javascript/classes_server.js (the integrated singleplayer/LAN server
# that runs in a web worker) without Gradle. Uses the TeaVM jars that
# tools/build-client.sh downloads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEAVM_DIR="$ROOT/tools/.teavm"
BUILD="$ROOT/build/teavm-server"
MAVEN="https://repo.maven.apache.org/maven2/org/teavm"
mkdir -p "$TEAVM_DIR"
for a in teavm-cli teavm-classlib teavm-platform teavm-jso teavm-jso-apis teavm-interop; do
	[ -f "$TEAVM_DIR/$a-0.6.1.jar" ] || curl -sSfL -o "$TEAVM_DIR/$a-0.6.1.jar" "$MAVEN/$a/0.6.1/$a-0.6.1.jar"
done
CP="$TEAVM_DIR/teavm-classlib-0.6.1.jar:$TEAVM_DIR/teavm-platform-0.6.1.jar:$TEAVM_DIR/teavm-jso-0.6.1.jar:$TEAVM_DIR/teavm-jso-apis-0.6.1.jar:$TEAVM_DIR/teavm-interop-0.6.1.jar"
rm -rf "$BUILD" && mkdir -p "$BUILD/classes"
cd "$ROOT/sp-server"
find src/main/java src/ipc/java ../src/lwjgl/java/com/jcraft -name '*.java' > "$BUILD/sources.txt"
echo "Compiling $(wc -l < "$BUILD/sources.txt") java files..."
javac -nowarn -encoding UTF-8 --release 8 -cp "$CP" -d "$BUILD/classes" @"$BUILD/sources.txt" 2>&1 | grep -v '^Note:' || true
[ -f "$BUILD/classes/net/lax1dude/eaglercraft/sp/IntegratedServer.class" ] || { echo "javac failed"; exit 1; }
echo "Running TeaVM..."
java -Xmx4g -cp "$TEAVM_DIR/teavm-cli-0.6.1.jar:$BUILD/classes" org.teavm.cli.TeaVMRunner \
	-t js -m -G -O 3 -e main -d "$ROOT/javascript" -f classes_server.js net.lax1dude.eaglercraft.sp.IntegratedServer
echo "Wrote javascript/classes_server.js"
