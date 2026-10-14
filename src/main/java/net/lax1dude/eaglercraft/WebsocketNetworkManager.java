package net.lax1dude.eaglercraft;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.LinkedList;

import net.minecraft.src.INetworkManager;
import net.minecraft.src.NetHandler;
import net.minecraft.src.Packet;

public class WebsocketNetworkManager implements INetworkManager {
	
	private NetHandler netHandler;
	private String serverURI;
	
	public WebsocketNetworkManager(String uri, String eagler, NetHandler netHandler) throws IOException {
		this.serverURI = uri;
		this.netHandler = netHandler;
		if(!EaglerAdapter.startConnection(uri)) {
			throw new IOException("websocket to "+uri+" failed");
		}
		EaglerAdapter.setDebugVar("minecraftServer", uri);
	}
	
	public void setNetHandler(NetHandler netHandler) {
		this.netHandler = netHandler;
	}

	private ByteArrayOutputStream sendBuffer = new ByteArrayOutputStream();
	
	public void addToSendQueue(Packet var1) {
		try {
			sendBuffer.reset();
			DataOutputStream yee = new DataOutputStream(sendBuffer);
			Packet.writePacket(var1, yee);
			EaglerAdapter.writePacket(sendBuffer.toByteArray());
		} catch (IOException e) {
			e.printStackTrace();
		}
	}
	
	public void wakeThreads() {
	}
	
	private static class ByteBufferDirectInputStream extends InputStream {
		private ByteBuffer buf;
		private ByteBufferDirectInputStream(ByteBuffer b) {
			this.buf = b;
		}
		
		@Override
		public int read() throws IOException {
			return buf.remaining() > 0 ? ((int)buf.get() & 0xFF) : -1;
		}
		
		@Override
		public int read(byte[] b, int off, int len) throws IOException {
			// bulk copy, the default InputStream impl calls read() once per byte
			// which made readFully() on big chunk packets very slow
			if(len == 0) {
				return 0;
			}
			int r = buf.remaining();
			if(r <= 0) {
				return -1;
			}
			if(len > r) {
				len = r;
			}
			buf.get(b, off, len);
			return len;
		}

		@Override
		public long skip(long n) {
			int s = (int)Math.min(n, (long)buf.remaining());
			if(s <= 0) {
				return 0l;
			}
			buf.position(buf.position() + s);
			return s;
		}
		
		@Override
		public int available() {
			return buf.remaining();
		}
	}

	/**
	 * Max time spent decoding packets per call, leftover packets wait for the
	 * next tick so a burst of chunk data doesn't freeze a whole frame
	 */
	private static final long PACKET_BUDGET_NANOS = 12000000l;

	/**
	 * If this much data is queued, ignore the time budget and catch up so the
	 * client never falls too far behind the server
	 */
	private static final int PACKET_BACKLOG_LIMIT = 2 * 1024 * 1024;
	
	private ByteBuffer oldChunkBuffer = null;
	private LinkedList<ByteBuffer> readChunks = new LinkedList();
	
	public void processReadPackets() {
		readChunks.clear();
		
		if(oldChunkBuffer != null) {
			readChunks.add(oldChunkBuffer);
		}
		
		byte[] packet;
		while((packet = EaglerAdapter.readPacket()) != null) {
			readChunks.add(ByteBuffer.wrap(packet));
		}
		if(!readChunks.isEmpty()) {
			ByteBuffer stream;
			if(readChunks.size() == 1) {
				stream = readChunks.getFirst();
			}else {
				int cap = 0;
				for(ByteBuffer b : readChunks) {
					cap += b.remaining();
				}
				stream = ByteBuffer.allocate(cap);
				for(ByteBuffer b : readChunks) {
					stream.put(b);
				}
				stream.flip();
			}
			readChunks.clear();
			
			boolean budgeted = stream.remaining() < PACKET_BACKLOG_LIMIT;
			long deadline = System.nanoTime() + PACKET_BUDGET_NANOS;
			DataInputStream packetStream = new DataInputStream(new ByteBufferDirectInputStream(stream));
			while(stream.hasRemaining()) {
				if(budgeted && System.nanoTime() > deadline) {
					break;
				}
				stream.mark();
				try {
					Packet pkt = Packet.readPacket(packetStream, false);
					pkt.processPacket(this.netHandler);
				} catch (EOFException e) {
					stream.reset();
					break;
				}  catch (IOException e) {
					continue;
				} catch (Throwable e2) {
					e2.printStackTrace();
				}
			}
			
			if(stream.hasRemaining()) {
				// keep the buffer at its current position rather than slice() it, TeaVM's
				// slice() ignores the existing offset so slicing a slice corrupts the stream
				oldChunkBuffer = stream;
			}else {
				oldChunkBuffer = null;
			}
			
		}
	}
	
	public void serverShutdown() {
		if(EaglerAdapter.connectionOpen()) {
			EaglerAdapter.endConnection();
			EaglerAdapter.setDebugVar("minecraftServer", "null");
		}
	}
	
	public int packetSize() {
		return 0;
	}
	
	public void networkShutdown(String var1, Object... var2) {
		serverShutdown();
	}
	
	public void closeConnections() {
		if(EaglerAdapter.connectionOpen()) {
			EaglerAdapter.endConnection();
			EaglerAdapter.setDebugVar("minecraftServer", "null");
		}
	}
	
	public String getServerURI() {
		return this.serverURI;
	}

}
